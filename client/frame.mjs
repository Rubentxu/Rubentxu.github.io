import { mergeFramePacket } from "./wire.mjs";

/**
 * One paint per animation frame, however many ask.
 *
 * Before this existed, every `pointermove` during a drag painted synchronously:
 * `paint()` ran to completion inside the event handler, so a mouse reporting at
 * 125 Hz asked the kernel for a full render list 125 times a second and the
 * browser painted 125 frames a second — more than the display can show, and
 * more than the frame budget is for. The kernel was measured on that path in
 * `nextdraw-wasm/examples/selection_cost.rs`, so the cost was real; it was just
 * being spent on frames nobody sees.
 *
 * Two things live here because the second only exists once the first is in
 * place:
 *
 * 1. **Coalesce.** Many asks within one frame become one paint. This is not a
 *    throttle and carries no timing of its own — the browser's frame cadence
 *    is the clock, which is why `requestFrame` is injected rather than reaching
 *    for a global: the same scheduler then runs under a fake in the tests.
 *
 * 2. **Ask again from outside an event.** The image cache decodes a data URL
 *    asynchronously. When the first paint missed it, the comment in
 *    `paint.mjs` claimed "the next frame will see `complete === true`" — and
 *    there was no next frame, because nothing requested one. An imported image
 *    stayed invisible until the user happened to move the mouse. That is the
 *    same missing tick as the coalescing above, and it is closed by the same
 *    mechanism: the decode calls `request()` and the scheduler makes the frame
 *    that exists.
 *
 * `paint` is a thunk with no arguments. The caller closes over whatever it
 * needs; the scheduler's only job is to decide *when*, and giving it the
 * session and the context as parameters would make it a second renderer.
 */
export function createFrameScheduler({ requestFrame, paint }) {
    // `0` is not a frame handle — browsers return a positive integer, so it is
    // a safe "nothing pending" that needs no `null` and no separate boolean.
    let handle = 0;
    // How many frames have been painted. The number is the only way to tell
    // "a frame has been on the screen since you asked" from "a frame is on its
    // way": the second is a fact about the future, the first is a fact about the
    // past, and a waiter that cannot tell them apart either waits for a frame
    // that will never come or stops one frame too early.
    let painted = 0;

    function run() {
        // Cleared BEFORE the paint, not after. An `onload` that lands while the
        // paint is running calls `request()`; if the handle were still set, that
        // ask would be swallowed by the frame already in flight and the resource
        // would wait for an interaction that may never come. Clearing first means
        // a request raised during a paint schedules a real follow-up frame, and
        // the loop terminates because the second paint finds nothing new.
        handle = 0;
        paint();
        painted += 1;
    }

    return {
        /**
         * Ask for a frame. Safe to call any number of times per frame; only the
         * first one schedules anything.
         */
        request() {
            if (handle !== 0) {
                return;
            }
            handle = requestFrame(run);
        },

        /**
         * Whether a frame has been asked for and has not run yet.
         *
         * The number is the handle itself: `0` means nothing is on its way, and
         * anything else means a frame is coming. A page that keeps painting —
         * a room with peers in it, a laser trail that has not faded — has a
         * frame on its way almost always, which is why this is a question and
         * not a way to say "the application is quiet".
         *
         * @returns {boolean}
         */
        pending() {
            return handle !== 0;
        },

        /**
         * How many frames have been painted.
         *
         * The count moves when a paint has finished, not when it was asked
         * for: a paint in flight has not reached the screen yet, and a waiter
         * that counted it would stop one frame early.
         *
         * @returns {number}
         */
        painted() {
            return painted;
        },
    };
}

/**
 * A frame worth having, or the one already in hand.
 *
 * ## What this saves
 *
 * `paint()` is asked for on every pointer move. During a drag the session's scene
 * does not change until the pointer comes up — the client moves the drag ghost with
 * the gesture's delta and commits with `translateAll` on pointerup — so for the ~60
 * paints of a one-second drag the render list is byte-for-byte the string the
 * client already parsed. At 5 000 elements that string is 1 632 638 bytes: about
 * 98 MB/s of serialisation and parsing spent re-deriving an answer nobody changed.
 *
 * ## Why the client is allowed to ask
 *
 * The kernel owns the criterion, and this module only reads it: `readRevision()`
 * returns the counter `Session` keeps over the scene, the viewport and the
 * selection, bumped by the same functions that write them. The client never decides
 * *whether* something expired — it has no copy of that rule to drift. That is the
 * H5.29 rule one layer up: if the client decided, there would be two invalidation
 * criteria and the failure mode of the wrong one is a frame that has stopped being
 * true and raises nothing.
 *
 * ## Why the scope argument
 *
 * Two sessions both start their counter at zero. Loading a new document builds a new
 * session, so a cache holding the old session's `0` would call the new one's `0`
 * unchanged and serve the previous drawing forever. The scope is the session itself,
 * which makes the two comparable without the kernel having to invent a global
 * generation nobody asked for.
 *
 * ## What the two readers are, and why there are two
 *
 * The cold read, `readFrame`, always encodes: it is what a mount pays once per
 * session, when the cache has nothing in hand. The warm ask, `takeFrame`, is
 * what every paint after that pays: the kernel answers `0` when the frame the
 * cache holds is still the frame, and the packed location of fresh bytes when
 * it is not. The question "has the frame moved?" is answered on the Rust side,
 * against the session's own counter, in the same call that would encode it —
 * so a quiet paint costs one crossing, where the revision probe, the pointer
 * and the length used to cost three.
 *
 * `null` from the warm ask is the kernel's "unchanged", and the cache answers
 * with the frame it holds. That answer is about *this session's takes*: a cache
 * that never took one — a remount over a live session — would be told
 * "unchanged" and have nothing to hand back, which is why a scope change is a
 * cold read by contract, not an optimisation.
 *
 * Both readers are injected rather than reached for, for the same reason
 * `requestFrame` is: the same cache then runs under a fake in the tests, and
 * the tests are the only place the "did it re-read?" question is answerable.
 * Both take the scope, so the cache itself never has to know what a session is.
 */
export function createFrameCache({ readFrame, takeFrame }) {
    // `null` is not a scope — a session is an object — so the first take always
    // reads cold without a separate "cold" flag that could outlive its reason.
    // `cold` covers the other direction: the kernel commits its take before this
    // side decodes the bytes, so a throw in between leaves the kernel remembering
    // a frame this cache never received. The next take is sent through the cold
    // read, which encodes regardless of what the kernel remembers, and the two
    // halves meet again instead of the page showing a drawing that stopped moving.
    let heldScope = null;
    let heldContextKey = null;
    let cold = false;
    let frame = null;

    return {
        /**
         * The current frame, re-read only when the kernel says it moved.
         *
         * @param scope the session the frame belongs to; see the note above.
         * @returns the frame object, the same object across takes while it holds.
         */
        take(scope, context = null) {
            const contextKey = context?.cacheKey ?? null;
            if (scope !== heldScope || cold || contextKey !== heldContextKey) {
                // The frame is read before anything is committed. A read that
                // throws must leave the cache exactly as it was — and cold, so
                // the ask that follows does not trust a frame nobody received.
                const next = readFrame(scope, context);
                heldScope = scope;
                heldContextKey = contextKey;
                frame = next;
                cold = false;
                return next;
            }
            // One crossing. `null` is the kernel saying the frame in hand still
            // is the frame; anything else is the packed location of fresh bytes,
            // already decoded on this side of the boundary before it gets here.
            cold = true;
            const next = takeFrame(scope, context);
            if (next !== null) {
                frame = next?.protocolVersion === undefined ? next : mergeFramePacket(frame, next);
                heldContextKey = contextKey;
            }
            cold = false;
            if (next === null) {
                return frame;
            }
            return frame;
        },
    };
}
