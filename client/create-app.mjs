// The NextDraw client's page: the mount, and the order its parts are built in.
//
// What this file is:
// - The one boot there is: the surfaces a mount reads, the state the page owns,
//   and the order the parts come into existence in. What each part is lives in
//   its own module beside this one, and the doc comment of `createNextDrawApp`
//   carries the mount's contract.
//
// What this file is not:
// - A drawing tool, an event router, a renderer, or a domain layer. The kernel
//   decides what an `Insert` means; the client tells the kernel when one
//   happened and asks it to paint the result. Geometry, versioning and z-order
//   all live in Rust.

import init, { Session, kernelPanicTag, model_version, wireSchema, vocabulary } from "../pkg/nextdraw_wasm.js";
import { refuseMissingMarkup } from "./app-mount.mjs";
import { startSession } from "./boot.mjs";
import * as multipointMode from "./multipoint.mjs";
import { createStatusLine } from "./status.mjs";
import { createCanvasRect } from "./canvas-rect.mjs";
import { createRenderWiring } from "./render-wiring.mjs";
import { createUiState } from "./ui-state.mjs";
import { createPersistence } from "./persist-wiring.mjs";
import { createLifecycle } from "./lifecycle.mjs";
import { bindDocumentIo } from "./document-io-wiring.mjs";
import { forgetImageFor } from "./paint.mjs";
import { createIdleWaiter } from "./idle.mjs";
import { createCopyDrawing, createInsertLibraryPieces, createSelectAt } from "./library-clipboard.mjs";
import { bindUiCommands } from "./ui-bindings.mjs";
import { createClearCanvasPrompt } from "./clear-canvas-dialog.mjs";
import { createTabConflictPrompt } from "./tab-conflict-dialog.mjs";
import { bindTextEditing } from "./text-editor-wiring.mjs";
import { createClipboardUseCase } from "./clipboard-use.mjs";
import { wireUpdateCheck } from "./update-wiring.mjs";
import { bindCanvasInput } from "./canvas-input-wiring.mjs";
import { bindLinkPopup } from "./link-popup.mjs";
import { commandState } from "./commands.mjs";
import { createPlural, directionOf, labelOf as localizedLabel, localizePage, resolveLocale, textOf } from "./i18n.mjs";
import { CATALOGS, STRINGS } from "./locales.mjs";

/** Screen pixels left around the content when a fit command frames it. */
const VIEW_FIT_PADDING = 32;

// The step the grid toggle turns the grid on with. It is a preference the
// document does not hold — the kernel keeps whatever step it is given, and
// upstream's own `GRID_SIZE` is 20 — so the client names the number once
// and the kernel decides everything the step does to a position.
const GRID_STEP = 20;

/**
 * Mount the editor into a container, and answer with the handle it is driven by.
 *
 * This is the one boot there is: an embedder gets exactly what the demo page
 * gets, because both run this same function. The container is the mount's
 * root: every element the editor needs is looked up inside it, so a page can
 * carry the demo page's markup wherever it wants it. The theme's attribute
 * stays on the document element — the theme is the page's own state, not one
 * mount's — and an embedder that wants the dark theme sets `data-theme` the
 * way the demo page's head does. What each part of the mount is lives in its
 * own module beside this one.
 *
 * @param {Element} [root] the container the editor mounts into; the document
 *   body when nothing is named, which is what the demo page passes.
 * @param {object} [options] the surface an embedder can listen on.
 * @param {(document: object) => void} [options.onChange] called with the
 *   document, as it is carried, every time a change is persisted. The demo
 *   page passes nothing and pays nothing: the hook is only consulted when it
 *   is there.
 * @param {object} [options.session] the kernel session the page uses, when the
 *   caller already has one. The mount then skips the stored document and
 *   mounts onto the session it was given: that is what lets a test mount the
 *   editor over a real kernel without a browser's storage.
 * @param {object} [options.document] the document the page reads. The mount
 *   looks its nodes up here, and a test that mounts the editor over a fake
 *   document is mounting the same code the browser runs.
 * @param {Function} [options.BroadcastChannel] the channel constructor the tabs use to
 *   warn each other that the drawing is being written. The page passes nothing and the
 *   global one is used.
 * @param {object} [options.indexedDB] the `indexedDB` factory the pictures of the drawing
 *   are kept in, so the stored document only names them. The page passes nothing and the
 *   global one is used; without one the pictures stay in the stored document.
 * @param {object} [options.navigator] the navigator asked to keep the stored
 *   drawing (`storage.persist()`). The page passes nothing and the global one is used.
 * @param {Function} [options.ResizeObserver] the observer constructor that tells the page the
 *   canvas changed size, so its box can be cached. Without one the box is read every time.
 * @param {object} [options.window] the window the page listens on. The frame
 *   clock, the pixel ratio and the keyboard live here.
 * @returns {Promise<{root: Element, session: () => object, whenIdle: () => Promise<void>}>} the handle, once
 *   the kernel is up: the root it mounted into, a reader for the session —
 *   the same object every editor behaviour drives — and the promise that says
 *   the page has caught up with what it was asked to do.
 * @throws {Promise<Error>} the promise **rejects** — it never resolves to a
 *   half-mounted editor — when the boot cannot happen, and the error's
 *   message starts with `nextdraw-boot:` so a consumer can catch it by name:
 *   markup missing names every id the root lacks (`client/app-mount.mjs`
 *   owns the list), and a kernel that failed to load carries the kernel's
 *   own failure. The status line also says the human-readable half when the
 *   root still has one to say it with.
 */
export function createNextDrawApp(root, options = {}) {
// The three surfaces the mount reads, injected so that the editor can be
// mounted outside a browser: a test holds the same document, window and
// kernel a page has, and the mount is the same code either way. The session
// is the third one — a page has none to give (the mount builds it from the
// stored document), and a test does, so the session is what the caller passes.
const document = options.document ?? globalThis.document;
const window = options.window ?? globalThis.window;
// The mount's root: the body when the caller names none, which is what the
// demo page's own call used to say with a default parameter.
root = root ?? document.body;

// What this mount listens to on surfaces that outlive it, and how it lets go.
// The signal goes to every listener put on the window or the document, so
// `destroy` takes them all off in one abort.
const lifecycle = createLifecycle({
    report: (error) => console.error(`the editor could not let go of a resource: ${error?.message ?? error}`),
});

// The markup check is the first thing the boot does, before the kernel is
// asked for and before anything binds: a root that lacks a node is a bug in
// the page, and the refusal names what is missing (`client/app-mount.mjs`).
const refusal = refuseMissingMarkup(root);
if (refusal !== null) {
    return Promise.reject(new Error(refusal));
}
const canvas = root.querySelector("#canvas");
// The canvas's box, read once and kept until the page resizes or scrolls it.
const canvasRect = createCanvasRect({
    element: canvas,
    window,
    ResizeObserver: options.ResizeObserver ?? globalThis.ResizeObserver,
});
const status = root.querySelector("#status");
const embeddableLayer = root.querySelector("#embeddable-layer");
const chartDialog = root.querySelector("#chart-dialog");
const linkDialog = root.querySelector("#link-dialog");
const clearCanvasDialog = root.querySelector("#clear-canvas-dialog");
const tabConflictDialog = root.querySelector("#tab-conflict-dialog");
// The offline worker, asked for by every mount that runs on a secure
// context: it is the origin's worker, not one mount's, and registering it
// twice is answered by the browser with the same registration. A page on
// an insecure origin (or a worker-less one) simply never goes offline.
//
// The registration is also how the page learns that a new build exists. The
// browser compares the worker it has with the one the server publishes, and
// it installs the new one when they differ; because the worker carries the
// build's identity, that comparison is the comparison of the build with
// itself. The page asks for the comparison when it starts and every time the
// user comes back to it, and offers to reload when the browser says there is
// a new one.
// The words come from the locale in use: `?lang=` first, then the browser's
// own language. It is resolved before everything that says a word — the update
// offer and the tab watch were among them even when they lived here — because
// the dialogs build their DOM when they open and so take their words by
// function rather than by a pass over the page at boot.
const requestedLocale =
    new URLSearchParams(window.location.search).get("lang") ?? navigator.language;
const locale = resolveLocale(requestedLocale, Object.keys(CATALOGS));
const say = (key, source) => textOf(STRINGS, locale, key, source);

// The status line's state lives in `client/status.mjs`, and it is three kinds of
// message rather than one: a *ready* line, a *notice* about the document, and a
// *problem* the user has to act on.
//
// The notice and the problem used to be the same flag, and that is what broke the
// notice. A file that had to be repaired has to be announced in red, and the only
// way to be announced in red was to claim that flag — which is the flag a
// successful save clears. The autosave runs one frame after the file opens, so
// the notice lasted less than a frame and the user never read it. The two are
// separate now: a notice is a fact about the document, and a successful save does
// not make it untrue.
// The page's failure channel. It is created before the offline worker is wired
// because the update offer says what happened on it, and the line's state is the
// module's (`client/status.mjs`); `renderStatus` is what puts it on the screen.
const statusLine = createStatusLine();

// The frame clock, the paint and its door, and the viewport, wired by their own
// module. The paint itself (`paintNow`) is the frame painter's, and the page
// hands it back once the pipeline it reads from exists.
const render = createRenderWiring({ canvas, window, document, status, statusLine, canvasRect });
const {
    nowMs, dateNowMs, eraserTrailAt, fail, syncViewport, paint, frame, frames,
    presencePeers, localPeerId, setLocalPeerId, setLinearMemory, setPendingRebuild, setRecoverFromPanic,
    setRemoveGlobalPanicHandlers, setPresencePeers, setPaintNow,
} = render;
// The handlers' remover of the moment: the boot replaces it once the global
// handlers are installed, and the autosave asks for it when the page leaves.
const removeGlobalPanicHandlers = () => render.removeGlobalPanicHandlers();

/**
 * Put the status line's current state on the screen.
 *
 * The page owns the element and the module owns the state; this is the one place
 * that joins them, so the line always shows what the state says.
 */
function renderStatus() {
    const { text, color } = statusLine.current();
    status.textContent = text;
    status.style.color = color;
    // The live region keeps the sentence; only news is drawn (no persistent footer status).
    status.dataset.quiet = String(statusLine.isQuiet());
}


/** Hit-test the click and dispatch the right selection change. */
const selectAt = createSelectAt({
    // The point reader is the pipeline's, and the pipeline does not exist yet:
    // it is handed `selectAt`. The page answers the dependency with the one the
    // pipeline will build, the same late answer the closure used to be.
    canvasPointFromEvent: (event) => canvasPointFromEvent(event),
});
const copyDrawing = createCopyDrawing({ canvas, statusLine, renderStatus });

// The pieces a library file lays down, from their own module.
const insertLibraryPieces = createInsertLibraryPieces({ canvas, window, statusLine, renderStatus });

// The clipboard is a use case of its own (TASK-26): paste and share are the
// two verbs this page shares with the rest of the machine, and the module
// beside this one owns them. Everything it answers back is bound here, so the
// registry dispatches by the same names it always did.
//
const { pasteFromTheSystem, pastePlainFromTheSystem, shareWithTheSystem } = createClipboardUseCase({
    canvas, statusLine, renderStatus, paint, chartDialog, text: say,
});

// The save, the tabs, the pictures' store, the recovery offer and the stored
// document's door, wired by their own module. The embedder's surfaces cross
// inside `options`; the kernel's constructor crosses because this page is the
// one module that imports the glue.
const {
    persistScheduler, seedRevision, recovery, restore, setTabConflictHandler, bindSessions,
} = createPersistence({
    options, document, window, canvasRect, lifecycle, statusLine, renderStatus, say, Session,
    pendingGesture: () => pendingGesture(),
    removeGlobalPanicHandlers: () => removeGlobalPanicHandlers(),
});

// The ui state and the gesture spine, from their own module: the pipeline, the
// frame painter (handed back to the render wiring) and the runner have to exist
// in that order, and the state they read — the menu, the palette, the theme's
// filter, the refreshers the paint calls — lives with them. `selectAt` crosses
// in because the pipeline is handed it, and answers with the point reader the
// pipeline will build, the same late answer the closure used to be.
const uiState = createUiState({
    canvas, window, document, root, lifecycle, statusLine, renderStatus, paint, frames,
    canvasRect, embeddableLayer, persistScheduler, eraserTrailAt, nowMs, dateNowMs,
    presencePeers, selectAt, copyDrawing, insertLibraryPieces, pasteFromTheSystem, pastePlainFromTheSystem,
    shareWithTheSystem, forgetImageFor, say, linkDialog, indexedDB: options.indexedDB,
    confirmClearCanvas: createClearCanvasPrompt({
        host: clearCanvasDialog,
        createElement: (tag) => document.createElement(tag),
        owner: document,
        text: say,
    }),
    localPeerId,
    setPaintNow,
});
const {
    viewOnlyNow, pageState, runCommand, toolArmed, syncCursor, canvasPointFromEvent, toolState, hintPreference, penMode, toolLock,
    setToolButtonRefresher, onPointerDown, onPointerMove, onPointerUp, onPointerCancel,
    pendingGesture, liveMultipoint, isSpaceHeld, setSpaceHeld, menuNow, paletteNow, pointerAt,
} = uiState;
// The offline worker, wired after the shell menu exists and before the kernel's load.
const reloadButton = document.querySelector("[data-reload-page]");
wireUpdateCheck({
    document, navigator, lifecycle, statusLine, renderStatus, say, reloadButton,
});

async function boot() {
    // The session start: the kernel up, the wire's vocabulary mounted, the
    // stored document read, the room joined and the panic recovery wired.
    // `client/boot-session.mjs` owns the block; the page hands it the glue's
    // exports — this file is the one module that imports the kernel — and the
    // setters of the state the page keeps, then reads back the session and the
    // context everything below drives.
    const {
        session, sessionNow, rawSessionNow, ctx, collabLink, problem, notice, unreadable,
    } = await startSession({
        document, window, canvas, lifecycle,
        init, panicTag: kernelPanicTag, modelVersion: model_version, wireSchema, vocabulary,
        room: options.room, sessionOption: options.session,
        restore, seedRevision, holdUnreadable: (bytes) => recovery.hold(bytes),
        paint, statusLine, renderStatus, syncViewport, fail, nowMs,
        setLinearMemory, setPendingRebuild, setRecoverFromPanic, setRemoveGlobalPanicHandlers,
        setThemeFilterValue: uiState.setThemeFilterValue,
        setRepaintAfterThemeChange: uiState.setRepaintAfterThemeChange,
        setPresencePeers,
        setLocalPeerId,
        text: say,
    });
    bindSessions({ session: sessionNow, rawSession: rawSessionNow, context: ctx, paint });
    setTabConflictHandler(createTabConflictPrompt({
        host: tabConflictDialog, owner: document, text: say, statusLine, renderStatus,
    }));
    // The file-drop veil's surface is the paper the drawing is on (TASK-145).
    bindDocumentIo({
        document, window, canvas, canvasRect, lifecycle, statusLine, renderStatus, paint, ctx,
        currentSession: sessionNow, recovery, persistScheduler, say, insertLibraryPieces,
        viewOnlyNow, surface: root.querySelector("#paper"), plural: createPlural(STRINGS, locale),
    });
    // Every toolbar, the context menu and the palette, bound from one table in
    // `client/ui-bindings.mjs`. The page's `lang` and `dir` follow the locale
    // resolved above the clipboard use case, because a right-to-left locale
    // that left `dir` alone would mirror nothing; the words stay here, since
    // this page is the one module allowed to import the catalogues.
    document.documentElement.lang = locale;
    document.documentElement.dir = directionOf(locale);
    const commandLabel = localizedLabel(CATALOGS, locale);
    uiState.setCommandViews(bindUiCommands({
        document, session, ctx, paint, statusLine, renderStatus, lifecycle,
        viewOnlyNow, runCommand, toolArmed, commandState, toolState, syncCursor,
        setToolButtonRefresher, labelOf: commandLabel,
        emptyText: textOf(STRINGS, locale, "palette.empty", "No matching command"),
        say, pendingGesture, hintPreference, penMode, toolLock,
        theme: () => document.documentElement.dataset.theme ?? "light",
    }));
    const paletteInput = document.getElementById("palette-input");
    paletteInput.placeholder = textOf(STRINGS, locale, "palette.placeholder", paletteInput.placeholder);
    localizePage(document, STRINGS, locale);
    // H5.11 inline editing and the vertex edit mode: the double click.
    bindTextEditing({
        canvas, document, session, ctx, frames, viewOnlyNow, canvasPointFromEvent,
        paint, statusLine, renderStatus, lifecycle,
        mountTextEditor: uiState.mountTextEditor,
        theme: () => document.documentElement.dataset.theme ?? "light",
        platform: window.navigator?.userAgentData?.platform ?? window.navigator?.platform ?? "",
    });
    // The popup is a non-modal view of the scene's link; its pointer listeners
    // share the canvas and lifecycle, while `linkOf` remains the kernel's answer.
    bindLinkPopup({
        canvas,
        host: document.getElementById("link-popup"),
        createElement: (tag) => document.createElement(tag),
        currentSession: sessionNow,
        canvasRect,
        window,
        text: say,
        signal: lifecycle.signal,
    });
    // The canvas's input: the wheel, the pointer, the browser's own menu, the resize,
    // the pan key and the keyboard. The menu and the palette are bound above, so the
    // keyboard can ask whether either is up; both are thunks because the page, not this
    // call, decides when they exist.
    bindCanvasInput({
        canvas, window, lifecycle, ctx, currentSession: sessionNow, canvasRect, paint, statusLine,
        renderStatus, syncViewport, syncCursor, viewOnlyNow, pageState, runCommand,
        menu: menuNow, palette: paletteNow, persistScheduler,
        onPointerDown, onPointerMove, onPointerUp, onPointerCancel,
        pendingGesture, liveMultipoint, isSpaceHeld, setSpaceHeld, pointerAt,
    });

    // The promise that says the page has caught up: the frame is on the screen
    // (`client/frame.mjs` knows when one has been painted) and the revision is
    // written down (the autosave's own `client/persist.mjs` knows what is
    // owed), asked of the two halves that own them instead of guessed with a
    // number of milliseconds.
    const whenIdle = createIdleWaiter({
        requestFrame: (run) => window.requestAnimationFrame(run),
        paintedFrames: () => frame.painted(),
        framePending: () => frame.pending(),
        save: () => {
            // The session on screen *now*, and not the one the scheduler was
            // last handed: a session that was replaced (a document loaded, a
            // panic rebuilt the page) would otherwise be written over the new
            // one when the old wake-up arrived.
            persistScheduler.request(sessionNow());
            persistScheduler.flush();
        },
    });

    // The mount is up: the handle says what it mounted and hands over the
    // session, which is the one object every editor behaviour drives. The
    // failure paths above returned earlier — a mount that failed to start has
    // no session to hand over, and its failure is already on the page's
    // status line.
    return {
        root,
        session: sessionNow,
        // The room's link, or `null` for a page that mounted without one.
        // An embedder that hosts a room can read who is here without
        // reaching into the canvas; the factory keeps the painting.
        link: () => collabLink,
        // One paint, now, through the scheduler's door: the static layer's measure.
        repaint: () => render.repaint(sessionNow(), canvas.getContext("2d")),
        // The promise that says the page has caught up: the frame is on the
        // screen and the revision is written down. A caller that waits for it
        // instead of for a number of milliseconds is waiting for the
        // application and not for the machine.
        whenIdle,
        // Take the editor down: its listeners on the window and the document
        // come off, what is owed is saved, and its channels close. Calling it
        // again does nothing.
        destroy: lifecycle.destroy,
    };
}

    return boot();
}
