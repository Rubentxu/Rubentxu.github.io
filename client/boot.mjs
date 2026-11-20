// The session start: the kernel up, the wire's vocabulary mounted, the stored
// document read, the room joined and the panic recovery wired.
//
// What this module is:
// - The one place the page's kernel session is born. `create-app.mjs` awaits
//   `startSession` where the block used to live, and reads back the session
//   the page draws with, the reader that answers with the one on screen (a
//   panic replaces it), the paint context the viewport made, the room's link
//   and the three answers the status line has to give about the stored
//   document.
//
// What this module is not:
// - The owner of the kernel glue. The page is the only module that imports
//   `pkg/nextdraw_wasm.js`, so the exports cross as dependencies: the loader,
//   the panic tag, the model version and the wire schema text. A test that
//   mounts this module injects its own answers and never touches a build.
// - The owner of the page's mutable state. The values the page reassigns
//   (the linear memory, the pending rebuild's frame, the panic doors, the
//   theme's filter, the presence peers) arrive as setters, so the page keeps
//   its single copy and this module never races it.
//
// The order is the boot's: memory before the schema, the schema before any
// frame is read, the stored document before the room adopts it, the room
// before the viewport exists, and the panic doors before the first paint.

import { mountWireSchema } from "./wire.mjs";
import { VOCABULARY } from "./vocabulary.mjs";
import { instrumentSession } from "./collab.mjs";
import { joinRoom } from "./room-wiring.mjs";
import { createPanicRecovery, createSessionRebuild, installGlobalHandlers } from "./panic.mjs";
import { themeFilter } from "./theme.mjs";

/**
 * Bring the kernel session up, and answer with what the rest of the page drives.
 *
 * @param {object} deps the surfaces the start reads.
 * @param {object} deps.document the document the page reads.
 * @param {object} deps.window the window the global panic handlers listen on.
 * @param {object} deps.canvas the canvas the room paints on.
 * @param {object} deps.lifecycle the mount's lifecycle.
 * @param {Function} deps.init the glue's loader; it answers the wasm instance's exports.
 * @param {Function} deps.panicTag the glue's panic tag, asked of the artifact.
 * @param {Function} deps.modelVersion the glue's model version, asked of the artifact.
 * @param {Function} deps.wireSchema the glue's wire schema text.
 * @param {Function} deps.vocabulary the glue's published vocabulary, asked of the artifact.
 * @param {object} [deps.room] the room configuration, when the embedder asked for one.
 * @param {object} [deps.sessionOption] the kernel session the caller already holds.
 * @param {Function} deps.restore the stored document's door.
 * @param {Function} deps.seedRevision the autosave's revision seeder.
 * @param {Function} deps.holdUnreadable where bytes nobody could open wait to be taken away.
 * @param {Function} deps.paint the paint.
 * @param {object} deps.statusLine the page's failure channel.
 * @param {Function} deps.renderStatus the one place that puts the state on the screen.
 * @param {Function} deps.syncViewport the viewport the context is made with.
 * @param {Function} deps.fail the boot's failure display.
 * @param {Function} deps.nowMs the clock.
 * @param {Function} deps.setLinearMemory where the page keeps the kernel's memory.
 * @param {Function} deps.setPendingRebuild the frame a rebuild paints as pending.
 * @param {Function} deps.setRecoverFromPanic the door the paint escapes through.
 * @param {Function} deps.setRemoveGlobalPanicHandlers the page's way to take the global handlers off.
 * @param {Function} deps.setThemeFilterValue where the page keeps the theme's filter.
 * @param {Function} deps.setRepaintAfterThemeChange what a theme change repaints.
 * @param {Function} deps.setPresencePeers where the page keeps the room's peers.
 * @returns {Promise<{session: object, sessionNow: () => object, ctx: object, collabLink: object|null,
 *   problem: string|null, notice: string|null, unreadable: string|null}>} the session the page
 *   starts with, the reader that always answers with the one on screen, the context, the
 *   room's link (or `null`), and what the stored document said.
 * @throws {Error} rejects — never resolves to a half-started session — when the kernel, its
 *   wire schema or its published vocabulary fail to load, and the error's message starts
 *   with `nextdraw-boot:`.
 */
export async function startSession(deps) {
    const {
        document, window, canvas, lifecycle,
        init, panicTag, modelVersion, wireSchema, vocabulary,
        room, sessionOption,
        restore, seedRevision, holdUnreadable,
        paint, statusLine, renderStatus, syncViewport, fail, nowMs,
        setLinearMemory, setPendingRebuild, setRecoverFromPanic, setRemoveGlobalPanicHandlers,
        setThemeFilterValue, setRepaintAfterThemeChange, setPresencePeers, setLocalPeerId,
        text = (_key, source) => source,
    } = deps;
    let module;
    try {
        // The module the browser loads. The memory the wire reads and the
        // session the page draws with belong to this instance, and both have
        // to: a frame written by one instance and read from another's memory
        // is nonsense, and nothing would throw.
        module = await init();
    } catch (error) {
        const message = `WASM failed to load: ${error.message ?? error}`;
        fail(message);
        // The promise rejects, and it rejects by name: a page that catches
        // `nextdraw-boot:` owns the failure display, the same contract the
        // markup check above keeps. Resolving to nothing would leave the
        // consumer holding `undefined` where the handle was promised.
        throw new Error(`nextdraw-boot: ${message}`);
    }
    // Before the first `paint()` and before anything else touches a frame. See
    // the declaration for why it cannot be captured at the top level.
    setLinearMemory(module.memory);
    // The wire's vocabulary, published by the kernel and mounted before anything
    // reads a frame. postcard does not say what a byte means, so the reader needs
    // the names and the order before it reads one — and the order is the kernel's,
    // because postcard numbers a variant by the position it is declared in.
    //
    // The schema and the artifact have to be the same build's. A reader that holds
    // one build's vocabulary with another build's bytes reads every frame wrong
    // without anything throwing, so `mountWireSchema` refuses the mismatch and the
    // page says so instead of drawing nonsense.
    //
    // The schema is read through the **module** and not through `module`. `await init()`
    // hands back the wasm instance's exports — the raw ABI, where a function that
    // returns a string takes a pointer to write into and returns nothing. The glue's
    // own wrappers, which know how to hand a string back to JavaScript, live in the
    // module's namespace, and that is where `wireSchema` is imported from. Calling
    // the raw export instead returns `undefined` rather than the schema, and the
    // failure would be a parse error about nothing.
    try {
        mountWireSchema(JSON.parse(wireSchema()), modelVersion());
    } catch (error) {
        const message = `WASM wire schema failed to load: ${error.message ?? error}`;
        fail(message);
        throw new Error(`nextdraw-boot: ${message}`);
    }
    try {
        // The frozen vocabulary and the artifact's live answer have to say the
        // same words, for the same reason the schema and the reader have to be
        // one build's: the client's tables were written by
        // `scripts/gen-vocabulary.mjs` from one build, and this page may have
        // just loaded another. A toolbar that offered a token the kernel no
        // longer takes would light up, take the user's click and refuse it —
        // a lie nothing in that round trip throws on. So boot refuses first,
        // and refuses by name: the first table that disagrees is said, the
        // way the schema mount says whose version moved.
        const drift = publishedVocabularyDrift(JSON.parse(vocabulary()), VOCABULARY);
        if (drift !== null) {
            throw new Error(drift);
        }
    } catch (error) {
        const message = `WASM published vocabulary failed to load: ${error.message ?? error}`;
        fail(message);
        throw new Error(`nextdraw-boot: ${message}`);
    }
    // The session the page uses. A page has none to give, so the mount builds
    // it from the stored document; a caller that hands one over gets exactly
    // that one, and nothing is read from a storage it never mentioned.
    const restored = sessionOption === undefined
        ? await restore()
        : { session: sessionOption, problem: null, notice: null, unreadable: null };
    // The session the page uses, and the session the room adopts with. They
    // are the same kernel object until a room is configured; with one, the
    // page holds the *instrumented* wrapper (every user edit reports itself
    // to the link) while remote adoption goes through the raw one — a
    // document the room sent is not this client's edit, and recording it
    // would re-send the page's own view as the next batch: the echo eating
    // the room (`client/collab.test.mjs` caught exactly that shape).
    let session = restored.session;
    // The raw session is a `let` and not a `const` because the panic recovery
    // replaces it: the session that panicked is in a state nobody knows, and
    // the room's view of the document has to be the new one.
    let rawSession = restored.session;
    const { problem, notice, unreadable } = restored;
    // A drawing that could not be opened and could not be put aside is still
    // in the one place the live drawing lives. The offer has to know it, or the
    // autosave would write over the only copy of it.
    if (unreadable !== null) {
        holdUnreadable(unreadable);
    }
    // The stored document, if any, is already the session's current state, so
    // the first paint must not count as a change to write back. Seeding the
    // document's revision here is what stops a plain reload from rewriting what
    // it just read.
    seedRevision(session.documentRevision());
    // The room, when the embedder asked for one (`options.room`). Everything
    // collaboration is this block and nothing else: without it the page runs
    // exactly as it did — one editor, one kernel, no network.
    //
    // The two names matter. The page keeps using `session`, the instrumented
    // wrapper, so every user edit reports itself to the link; the room's
    // documents are adopted through `rawSession`, because adoption is not an
    // edit. The link answers `sync`/`presence`; the interval is the page's
    // own choice of when to ask — a polling relay by design (ADR-007), not
    // a socket, and the poll interval is this page's policy.
    let collabLink = null;
    // The recorder the instrumented session reports to. It is named out here
    // and not inside the room's block because the panic recovery has to be
    // able to instrument the session it rebuilds, and the room may not be
    // there.
    let record = null;
    if (room !== undefined) {
        ({ collabLink, record, session } = joinRoom({
            room, session, currentRawSession: () => rawSession, currentCtx: () => ctx,
            canvas, lifecycle, paint, statusLine, renderStatus, nowMs,
            setPresencePeers, setLocalPeerId,
            fetch: (...args) => fetch(...args),
        }));
    }
    const ctx = syncViewport(session);
    // The panic recovery. The policy lives in `client/panic.mjs`; what is
    // here is the wiring: the tag comes from the artifact — the kernel owns
    // it and the page asks for it — the console and the status line are this
    // page's, and the rebuild is the boot's own door.
    //
    // The rebuild is the boot's door because the drawing the user was working
    // on is the last one that was saved, and the session that panicked is in
    // a state nobody knows. The page's own session and the room's view of it
    // are both replaced, the autosave's revision is re-seeded — so the
    // restored document is not written back as if it were a change — and the
    // new session is painted.
    const rebuild = createSessionRebuild({
        restore,
        instrument: (candidate) =>
            record === null ? candidate : instrumentSession(candidate, record),
        seed: (candidate) => {
            seedRevision(candidate.documentRevision());
        },
        repaint: (candidate) => {
            setPendingRebuild(candidate, ctx);
            paint(candidate, ctx);
        },
    });
    const panicRecovery = createPanicRecovery({
        panicTag: panicTag(),
        consoleError: (message) => console.error(message),
        statusLine,
        renderStatus,
        rebuild: () => {
            const rebuilt = rebuild();
            session = rebuilt.session;
            rawSession = rebuilt.rawSession;
            // Bytes that could not be opened and could not be put aside are
            // still in the one place the live drawing lives: the offer has to
            // know it, or the autosave would write over the only copy.
            if (rebuilt.unreadable !== null) {
                holdUnreadable(rebuilt.unreadable);
            }
            return rebuilt;
        },
    });
    setRecoverFromPanic(panicRecovery.recover);
    // The window hears about the failures nobody caught — one that escaped a
    // listener, one that escaped a promise — and the page answers them the
    // same way it answers the ones the paint caught. They come off when the
    // page leaves.
    setRemoveGlobalPanicHandlers(installGlobalHandlers({
        target: window,
        recover: (error) => panicRecovery.recover(error),
    }));
    // The theme's filter, read from the stylesheet now that the theme is on the page.
    // The theme is bound before `boot()` runs — the page has to come up in the theme
    // the user chose — so the attribute is already there to be read.
    setThemeFilterValue(themeFilter(document.documentElement));
    // A theme change repaints the canvas, and the canvas is the only thing that
    // changes: the drawing itself is the same picture in two themes.
    setRepaintAfterThemeChange(() => paint(sessionNow(), ctx));
    paint(session, ctx);
    // `model_version` is an exported *function* in the WASM glue, so interpolating
    // the export itself printed `function 612() { [native code] }` here instead of
    // the number. The `?? "?"` was meant to cover a missing export, and it is why
    // the mistake survived: the fallback made the line look guarded.
    //
    // There is no fallback now, and there is no optional call: the export is
    // imported by name, so an artifact without it fails to load the module at all,
    // which is louder than a question mark on the status line. The import is the
    // glue's wrapper and not the wasm instance's raw export — see the boot, where
    // the same distinction decides where the wire's schema is read from.
    statusLine.setReady(
        text("status.ready", "WASM model v{version} loaded, session ready.").replace(
            /\{version\}/g,
            String(modelVersion()),
        ),
    );
    // Seeded here, not on a failed save: a drawing that could not be read is
    // also a status the user needs to see.
    //
    // The kind of status depends on where the bytes ended up. When they were
    // put aside, the drawing on screen is in no danger and the fact stays true
    // through every edit that follows — so it is a notice, and a successful
    // autosave does not make it untrue. When they could not be put aside, the
    // autosave is standing still and the user has to act: that is a problem.
    if (problem !== null) {
        statusLine.setProblem(problem);
    } else if (notice !== null) {
        statusLine.setNotice(notice, true);
    }
    renderStatus();
    // The reader the page asks instead of holding the session itself: a panic
    // replaces it, and every late reader gets the one on screen.
    const sessionNow = () => session;
    const rawSessionNow = () => rawSession;
    return {
        // The session the page's binders hold — the instrumented wrapper when
        // a room was joined, the kernel's own otherwise — read once, at the
        // same moment the block used to hand it over.
        session: sessionNow(),
        sessionNow,
        rawSessionNow,
        ctx,
        collabLink,
        problem,
        notice,
        unreadable,
    };
}

/**
 * The first place the artifact's live vocabulary and the client's frozen copy
 * disagree, worded to say which table moved — or `null` when they agree.
 *
 * Object keys compare sorted, because key order is not a fact about the
 * vocabulary; lists compare in order, because it is: the fill tokens number
 * the wire's variants by position, so a reordering is a change, not a
 * formatting choice. A table one side carries and the other does not is a
 * disagreement of its own — the kernel grew a table the frozen copy never
 * heard of, which is the shape a stale build actually takes.
 *
 * @param {object} live the artifact's answer, parsed.
 * @param {object} file the frozen copy the client boots with.
 * @returns {string|null} the words for the first disagreement, or `null`.
 */
function publishedVocabularyDrift(live, file) {
    const canonical = (value) =>
        Array.isArray(value)
            ? `[${value.map(canonical).join(",")}]`
            : value !== null && typeof value === "object"
                ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`
                : JSON.stringify(value);

    for (const table of new Set([...Object.keys(live ?? {}), ...Object.keys(file ?? {})])) {
        if (canonical(live?.[table]) !== canonical(file?.[table])) {
            // styles and hitKinds are tables of lists: name the list that
            // moved rather than the table that holds it.
            if (table === "styles" || table === "hitKinds") {
                for (const list of new Set([
                    ...Object.keys(live?.[table] ?? {}),
                    ...Object.keys(file?.[table] ?? {}),
                ])) {
                    if (canonical(live?.[table]?.[list]) !== canonical(file?.[table]?.[list])) {
                        return `the ${list} ${table === "styles" ? "tokens" : "kinds"} the artifact answers with ` +
                            `(${canonical(live?.[table]?.[list])}) are not the ones the client's frozen copy ` +
                            `carries (${canonical(file?.[table]?.[list])}): the tables were frozen from another build`;
                    }
                }
            }
            return `the ${table} table the artifact answers with is not the one the client's frozen copy carries`;
        }
    }
    return null;
}
