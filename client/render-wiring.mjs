// The frame clock, the paint and its door, and the viewport the context is made with.
//
// What this module is:
// - The page's rendering machinery: the clock, the kernel-answer helpers the
//   paint reads (the eraser's ink, the embeddable overlays), the viewport that
//   sizes the canvas and answers with a context, the frame scheduler and its
//   per-revision cache, the paint that asks for a frame and the door that
//   survives a panic while painting it.
//
// What this module is not:
// - The paint itself. `paintNow` is the frame painter's (`client/paint-frame.mjs`),
//   built by the page once the gesture pipeline exists; it crosses back through
//   `setPaintNow`, the same late answer the closure used to be.
// - The owner of the boot's answers. The kernel's linear memory, the pending
//   rebuild's frame, the panic doors and the room's peers arrive as setters,
//   because the boot replaces them while the page runs.

import { readFrame, takeFrame } from "./wire.mjs";
import { createFrameCache, createFrameScheduler } from "./frame.mjs";
import { setImageReady, bindScratchCanvas, imageVersion } from "./paint.mjs";
import { createPresenceRoom } from "./presence.mjs";

/**
 * Build the page's rendering machinery.
 *
 * @param {object} deps the surfaces the paint reads.
 * @param {object} deps.canvas the canvas the viewport sizes.
 * @param {object} deps.window the window whose clock and pixel ratio are read.
 * @param {object} deps.document the document the scratch canvas is created in.
 * @param {object} deps.status the status element.
 * @param {object} deps.statusLine the page's failure channel.
 * @param {object} deps.canvasRect the canvas's cached box.
 * @returns {object} the machinery: the helpers, the paint and its door, the
 *   scheduler and the cache, and the setters the boot routes its answers through.
 */
export function createRenderWiring({ canvas, window, document, status, statusLine, canvasRect, dateNowMs = () => Date.now() }) {
    /**
     * The clock, in milliseconds.
     *
     * The eraser's ink decays with time, and the decay is measured against this. The kernel
     * does not read the clock — a rule that reads the clock cannot be tested against
     * upstream's own numbers — so the time crosses the frontier as an argument, and this is
     * where it comes from.
     *
     * `performance.now()` and not `Date.now()`: the decay is measured in fractions of a
     * second, and a clock that only ticks every millisecond of *wall* time is a clock that
     * jumps when the machine sleeps.
     */
    function nowMs() {
        return performance.now();
    }

    /**
     * The eraser's ink at this instant, in screen coordinates.
     *
     * The kernel owns the trail's shape and the clock that decays it, so the client asks and
     * paints what it is told. The answer is not cached: the ink changes with every frame, and a
     * copy held by the client would be a second truth about a rule that has to agree with
     * upstream's to the pixel.
     *
     * @param session The kernel session.
     * @returns {number[][]} The contour, in screen coordinates. Empty when there is no stroke.
     */
    function eraserTrailAt(session) {
        return JSON.parse(session.eraserTrail(nowMs())).trail;
    }

    /** Reports a load-time failure to the user and stops the boot. */
    function fail(message) {
        status.textContent = message;
        // A failure is news even when the ready sentence was the last thing
        // the line said: the quiet flag is the ready line's, not the element's.
        status.dataset.quiet = "false";
        status.style.opacity = "0.9";
        status.style.color = "#a40000";
        // Keep the canvas uninitialised so the user can still see the page;
        // a fully white screen on failure hides the error.
        console.error(message);
    }

    /** Read the canvas size in device pixels and tell the session. */
    function syncViewport(session) {
        // devicePixelRatio is read once per resize rather than per frame; the value
        // does not change during a frame, and the cost of asking is not zero.
        const dpr = window.devicePixelRatio || 1;
        // The size is being read to be applied, so it is read fresh.
        canvasRect.invalidate();
        const rect = canvasRect.get();
        const widthCss = rect.width;
        const heightCss = rect.height;
        canvas.width = Math.round(widthCss * dpr);
        canvas.height = Math.round(heightCss * dpr);
        // Scene units are CSS pixels; the kernel does not know about `dpr`. The
        // canvas backing store is scaled by `dpr` so the paint looks crisp on
        // high-DPI displays, but the coordinates the kernel sees are CSS pixels.
        const ctx = canvas.getContext("2d");
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        session.setViewportSize(widthCss, heightCss);
        return ctx;
    }

    /**
     * The session and context the next frame will paint with.
     *
     * `paint` no longer receives them at paint time — it receives them at *request*
     * time and hands them to the scheduler, which may run the paint up to a frame
     * later and with a later `ctx`. The resize path is the reason this is not a
     * detail: `syncViewport` resets `canvas.width`, which is what reallocates the
     * context state, so a frame queued before a resize must paint with the context
     * as it is *after* the resize, and holding the latest one is what makes that
     * true without every call site having to know.
     */
    let pendingSession = null;
    let pendingCtx = null;

    /**
     * The page's answer to a panic, once the boot has built it.
     *
     * The paint asks this, because the paint is the one thing that runs on every
     * frame and a panic there would stop the page from drawing again. Before the
     * boot there is nothing to ask and the answer is "not a panic": the page is
     * not up yet, so there is no session to lose.
     */
    let recoverFromPanic = () => false;

    /**
     * Take the global handlers off, when the page leaves.
     *
     * A handler that outlives the page answers a panic in a page that is going
     * away, and a page that is going away has nothing to rebuild.
     */
    let removeGlobalPanicHandlers = () => {};

    const frame = createFrameScheduler({
        // Reached through `window` inside the arrow rather than captured at module
        // load: this file is the browser entry and a bare `requestAnimationFrame`
        // reference here would be a global read at import time.
        requestFrame: (run) => window.requestAnimationFrame(run),
        paint: () => paintOrRecover(pendingSession, pendingCtx),
    });

    // The module's linear memory, and the only thing `wire.mjs` needs from the host.
    //
    // It arrives with the module — wasm-bindgen's `init` resolves to the instance's
    // exports, and `memory` is one of them — so it cannot be a top-level `await`
    // capture either, and it is `null` until the session start runs. Nothing reads a
    // frame before that: the first `paint()` call is inside the start, after the
    // assignment below, which is the same order the `Session` construction has to
    // respect for the same reason.
    let linearMemory = null;

    // The frame, read once per revision rather than once per paint.
    //
    // A drag asks for a paint on every `pointermove` and commits once, on pointerup, so
    // the sixty paints of a one-second drag all want the same frame. `frame()` at 5 000
    // elements is 1 632 638 bytes of JSON, and asking for it sixty times re-serialises
    // and re-parses sixty megabytes to get an answer nobody changed.
    //
    // The kernel decides *whether* it changed: `session.revision()` counts everything a
    // frame reads and is bumped by the same functions that write it. This cache only asks
    // and compares — a client that decided for itself would carry its own copy of the
    // invalidation rule, which is the duplicated source of truth of H5.29 with its
    // matching failure, a frame that has stopped being true and raises nothing. One line
    // of JavaScript, because the rule is not here.
    //
    // Both readers are `client/wire.mjs`, not `session.frame()`. The cold read
    // (`readFrame`, once per session, at the mount) and the warm ask (`takeFrame`,
    // once per paint) both read postcard bytes in place; there is no JSON string
    // on either crossing, which is the whole of what H8.4 changed, and no revision
    // probe beside them, which is the whole of what TASK-85 changed: the question
    // "has the frame moved?" is answered by the kernel inside the take itself.
    // `session.frame()` still exists and still returns JSON — it is the oracle those
    // bytes are compared against in `client/wire.test.mjs`, and it is deliberately
    // not on the path a paint takes.
    let pendingFooterContext = null;
    const footerTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    function captureFooterContext() {
        const nowMs = dateNowMs();
        const year = new Intl.DateTimeFormat("en", { timeZone: footerTimeZone, year: "numeric" })
            .format(new Date(nowMs));
        return { nowMs, timeZone: footerTimeZone, cacheKey: `${footerTimeZone}/${year}` };
    }

    const frameCache = createFrameCache({
        readFrame: (session, context) => readFrame(session, linearMemory, imageVersion(), context),
        takeFrame: (session, context) => takeFrame(session, linearMemory, imageVersion(), context),
    });
    const frames = { take: (session) => frameCache.take(session, pendingFooterContext) };

    // A decoded image is a reason to paint, and it arrives from outside any event —
    // the `onload` fires between frames. Without this registration the image is
    // decoded, correct, and never drawn, which is the bug `client/frame.mjs`
    // describes. Registered here, beside the scheduler it feeds.
    setImageReady(frame.request);
    // The faded-element buffer composes in a real canvas, and the renderer has no
    // document of its own — the same seam as the image hook above. Without the
    // factory the faded path draws directly, which is what the pure suite records;
    // in the browser the buffer is always there, because a translucent shape drawn
    // directly lands a channel apart from the reference (PAINT-008).
    bindScratchCanvas(() => document.createElement("canvas"));

    /**
     * Ask for a frame. Every caller in the page asks; only the first ask per frame
     * schedules anything, and the paint runs once, after.
     *
     * This is the name the ~35 call sites use, unchanged. The alternative was to
     * rename them all to `schedulePaint`, which would have made the change visible
     * in a diff and would also have meant that a caller added later could reach for
     * `paintNow` and silently opt out of coalescing — the half-applied guarantee is
     * the failure mode worth spending the churn to avoid, and there is only one
     * definition to keep honest.
     *
     * The frame the scheduler runs is `paintOrRecover`, which is the door the
     * paint comes through: the paint itself is `paintNow`, and the door is what
     * happens when the paint does not come back.
     */
    function paint(session, ctx) {
        pendingSession = session;
        pendingCtx = ctx;
        pendingFooterContext = captureFooterContext();
        frame.request();
    }

    // The frame painter, handed back by the page once the pipeline it reads from
    // exists. Before that there is nothing to paint, and the door's answer is the
    // noop: a frame scheduled before the page is up paints nothing.
    let paintNow = () => {};

    /**
     * Paint a frame, and survive a panic while doing it.
     *
     * The paint is the one thing that runs on every frame, so a panic in it is
     * the one failure that stops the page from ever drawing again: the frame dies,
     * the next frame dies the same way, and the canvas keeps showing the last
     * picture the kernel managed to produce. So the panic is caught here, and the
     * session is put back — the same door the boot uses, so the drawing the user
     * was working on is still there.
     *
     * Anything that is **not** a panic is rethrown, exactly as before this catch.
     * A refusal is the kernel answering, and the answer belongs to whoever asked
     * the question.
     *
     * The paint itself is `paintNow` and this is only its door: the frame is
     * painted by one function, and the door is what decides what happens when
     * that function does not come back.
     */
    function paintOrRecover(session, ctx) {
        try {
            paintNow(session, ctx);
        } catch (error) {
            if (!recoverFromPanic(error)) {
                throw error;
            }
        }
    }

    // The remote peers, at module level because the paint reads them: the room
    // block feeds it (the relay's answer, minus this page's own id) and
    // `paintNow` reads what is still alive. Without a room it stays empty and
    // the paint's branch costs one prune.
    let presencePeers = createPresenceRoom();
    let localPeerId = null;

    return {
        nowMs, dateNowMs, eraserTrailAt, fail, syncViewport,
        paint, frame, frames,
        // One paint, now, through the same door the scheduler runs — the
        // measurement door the static layer's before/after asks through. The
        // coalescing ask measures the display's cadence; a caller timing the
        // paint itself wants the paint.
        repaint: (session, ctx) => paintOrRecover(session, ctx),
        // What the page reads when it wires the painter, and what the autosave
        // asks for on its way out: the handlers' remover of the moment.
        presencePeers: () => presencePeers,
        localPeerId: () => localPeerId,
        setLocalPeerId: (id) => { localPeerId = id; },
        removeGlobalPanicHandlers: () => removeGlobalPanicHandlers(),
        // What the boot hands back as it builds the session.
        setLinearMemory: (memory) => { linearMemory = memory; },
        setPendingRebuild: (session, ctx) => { pendingSession = session; pendingCtx = ctx; },
        setRecoverFromPanic: (recover) => { recoverFromPanic = recover; },
        setRemoveGlobalPanicHandlers: (remove) => { removeGlobalPanicHandlers = remove; },
        setPresencePeers: (peers) => { presencePeers = peers; },
        setPaintNow,
    };

    /** The page's answer, once the frame painter exists. */
    function setPaintNow(paintFrame) {
        paintNow = paintFrame;
    }
}
