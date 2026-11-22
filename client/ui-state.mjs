// The page's ui state and the gesture spine: what only this mount knows.
//
// What this module is:
// - The state the page owns and the modules rule: the two command views (the
//   context menu and the palette, bound by the page's table), the presentation
//   modes, the keyboard's questions (`pageState`), the view-only gate, the
//   right-click's menu opener, the theme's filter and its repaint, and the
//   three factories that have to exist in order — the gesture pipeline, the
//   frame painter (handed back to the render wiring), and the command runner.
// - The holder of the noop-until-bound refreshers: the paint calls them before
//   the toolbars exist, and `setCommandViews` replaces them with the table's
//   answer.
//
// What this module is not:
// - The owner of the words or the kernel: the locale's words, the clipboard's
//   doors, the library's pieces and the surfaces arrive as dependencies.
//
// The order inside is the order the page had: the pipeline is built with
// `selectAt` and `openContextMenuAt`, the painter is built after the pipeline
// it reads from, and the runner after both, because it is handed the tool
// state, the mode exits and the pointer.

import { TOOLS } from "./tools.mjs";
import { bindThemeToggle, themeFilter } from "./theme.mjs";
import { prepareCanvasMenu } from "./canvas-menu.mjs";
import { commandState, MENUS } from "./commands.mjs";
import {
    createPresentationState, editingAllowed,
} from "./presentation.mjs";
import { createGesturePipeline } from "./gesture-pipeline.mjs";
import { createPenMode } from "./pen-mode.mjs";
import { createSemanticExplorer } from "./semantic-explorer.mjs";
import { createToolLock } from "./tool-lock.mjs";
import { bindTextCreation } from "./text-editor-wiring.mjs";
import { createPaintFrame } from "./paint-frame.mjs";
import { createStaticLayer } from "./static-layer.mjs";
import { createCommandRunner } from "./run-command.mjs";
import { bindShapeSwitchPanel, createShapeSwitch } from "./shape-switch.mjs";
import { createHintPreference } from "./help.mjs";
import { createStylePreferences } from "./style-preferences.mjs";
import { createWelcomeScreen } from "./welcome-screen.mjs";

/** Screen pixels left around the content when a fit command frames it. */
const VIEW_FIT_PADDING = 32;

// The step the grid toggle turns the grid on with. It is a preference the
// document does not hold — the kernel keeps whatever step it is given, and
// upstream's own `GRID_SIZE` is 20 — so the client names the number once
// and the kernel decides everything the step does to a position.
const GRID_STEP = 20;

/**
 * Build the mount's ui state and its gesture spine.
 *
 * @param {object} deps the surfaces the state reads.
 * @param {object} deps.canvas the canvas the pipeline and the painter drive.
 * @param {object} deps.window the window the painter's clock reads.
 * @param {object} deps.document the document the runner's panels are built in.
 * @param {object} deps.root the mount's root.
 * @param {object} deps.lifecycle the mount's lifecycle.
 * @param {object} deps.statusLine the page's failure channel.
 * @param {Function} deps.renderStatus the one place that puts the state on the screen.
 * @param {Function} deps.paint the paint the state asks for.
 * @param {object} deps.frames the render wiring's frame cache.
 * @param {object} deps.canvasRect the canvas's cached box.
 * @param {object} [deps.embeddableLayer] the DOM layer the painter reconciles.
 * @param {object} deps.persistScheduler the autosave's scheduler.
 * @param {Function} deps.eraserTrailAt the render wiring's ink reader.
 * @param {Function} deps.nowMs the render wiring's clock.
 * @param {Function} deps.presencePeers the render wiring's peers reader.
 * @param {Function} deps.selectAt the click's selection change.
 * @param {Function} deps.copyDrawing the copy door.
 * @param {Function} deps.insertLibraryPieces the library's door.
 * @param {Function} deps.pasteFromTheSystem the clipboard's paste door.
 * @param {Function} deps.pastePlainFromTheSystem the clipboard's paste door without the offers.
 * @param {Function} deps.shareWithTheSystem the clipboard's share door.
 * @param {Function} deps.forgetImageFor the pictures' release.
 * @param {Function} deps.say the page's words.
 * @param {object} [deps.linkDialog] the link dialog's element.
 * @param {object} [deps.indexedDB] the IndexedDB the runner's panels use.
 * @param {Function} deps.setPaintNow where the render wiring takes the painter back.
 * @returns {object} the state and the spine the page drives.
 */
export function createUiState(deps) {
    const {
        canvas, window, document, root, lifecycle, statusLine, renderStatus, paint, frames,
        canvasRect, embeddableLayer, persistScheduler, eraserTrailAt, nowMs, dateNowMs,
        presencePeers, localPeerId, selectAt, copyDrawing, insertLibraryPieces, pasteFromTheSystem, pastePlainFromTheSystem,
        shareWithTheSystem, forgetImageFor, say, linkDialog, indexedDB, setPaintNow,
        confirmClearCanvas,
    } = deps;
    let hintStorage = null;
    try {
        hintStorage = window.sessionStorage;
    } catch {
        // The preference remains page-local where browser storage is unavailable.
    }
    const hintPreference = createHintPreference(hintStorage);
    // The drawing preferences of this mount: the style a new element is born with
    // and what the pickers show with no selection. One small JS object per app
    // instance (TASK-294) — never shared between two editors, never in the
    // kernel, never a store framework.
    const stylePreferences = createStylePreferences();
    // The welcome screen, built with the spine because the paint is what
    // knows both halves of upstream's condition: the empty document and the
    // armed tool. Its two rows are doors to surfaces the page already owns —
    // the menu's Open and the help sheet the footer and the menu open — so it
    // needs no new action, only the two buttons already bound.
    const welcomeScreen = createWelcomeScreen({
        document,
        root,
        text: say,
        onOpen: () => root.querySelector("#canvas-menu-open")?.click(),
        onHelp: () => root.querySelector("#canvas-menu-help")?.click(),
        signal: lifecycle.signal,
    });
    let helpDialog = null;
    let hintViewer = { refresh() {} };
    // The text tool's creation editor: the sheet a click opens with no
    // element behind it. The settle is the pipeline's; the sheet, its place
    // on the screen and the hand-off of the body are this mount's, wired
    // beside the double click's editor (the module that owns the sheets).
    const { mountTextEditor } = bindTextCreation({ document, preferences: stylePreferences });

    // The refresher of every button row and the opacity slider. Set by the page
    // once the rows have been bound to the kernel; a noop until then so the very
    // first paint, on a freshly loaded page, does not have to know.
    let syncStyleControls = () => {};
    let syncStrokeColour = () => {};
    let syncBackgroundColour = () => {};
    let syncTextStyle = () => {};
    let syncArrowStyle = () => {};
    // The history pair is a fifth refresher but not a fifth `STYLES` row: it has no
    // vocabulary and no selection, only the kernel's own "can this happen" answers. Same
    // noop-until-bound shape as the four above, so a paint that runs before the page
    // finishes wiring does not have to know.
    let syncHistoryButtons = () => {};
    // The zoom readout is the only refresher that writes text rather than a flag: the
    // middle button is both the label and the reset target. Same noop-until-bound shape.
    let syncZoomButtons = () => {};

    /** The filter the canvas paints with, and the paper it paints on.
     *
     * The dark theme turns the drawing over the way upstream does — every colour it
     * paints goes through `applyDarkModeFilter`
     * (`packages/common/src/colors.ts:86`) — and the filter is upstream's own
     * `invert(93%) hue-rotate(180deg)`.
     *
     * It is applied on the context, and not by the stylesheet, because a
     * page filter reaches everything the page shows and one of the things it showed
     * was an imported image: upstream leaves a raster alone. The image steps out of
     * the filter in `client/paint.mjs`, which is the one thing on the canvas that is
     * not a colour the theme owns.
     *
     * The value comes from the stylesheet — `--theme-filter`, the same variable
     * upstream declares — so the filter is written down once. `none` in the light
     * theme, so the light theme changes nothing at all.
     */
    let themeFilterValue = "none";

    /** Repaint after the theme changed.
     *
     * The canvas is not turned over by the stylesheet any more, so the pixels on it
     * are the ones that have to change: without this, a drawing would keep the
     * colours it was painted with until the next edit. A noop until the page has a
     * session to paint, because before that there is nothing on the canvas.
     */
    let repaintAfterThemeChange = () => {};

    /**
     * The menu, bound by the page's table.
     *
     * It is a handle rather than a direct call because the function that opens it
     * is not where the table is: the pointer handler is here, and a pointer handler
     * that cannot reach the menu would have to ask the table to open it — which is
     * a callback that exists only for this, and a closure over state the caller
     * already has.
     *
     * Before the table runs there is no menu, and `null` says so. The keyboard asks
     * whether one is open before it looks at a key press, and a menu that leaves
     * the page's shortcuts live underneath it is a menu where `v` switches the
     * tool while the user is choosing an item.
     */
    let menu = null;

    /**
     * The command palette, or `null` before it is bound.
     *
     * The palette is the third view of the command registry, and it is bound to
     * the same door the keyboard and the context menu use, so a verb cannot do
     * one thing from the keyboard and another from the palette.
     */
    let palette = null;

    /**
     * The two presentation modes, both off.
     *
     * The state is the module's (`client/presentation.mjs`); what lives here is
     * the fact of it for this mount — the same shape as `menu` and `palette`
     * above, state the page owns and the modules rule. Nothing reads it except
     * the two command bodies that toggle it and the pipeline's view gate, which
     * is fed through the seam when view mode flips.
     */
    const presentation = createPresentationState();

    /**
     * What only the page knows, for the keyboard's questions.
     *
     * The modes come most specific first: a crop that is armed, a panel that is up, a
     * polyline in flight. A polyline only counts while editing is allowed, because the
     * verb that ends it writes the drawing and the gate refuses that in view mode; a
     * mode the gate would deny must not also swallow the Escape that backs out.
     */
    const pageState = Object.freeze({
        modes: () => {
            const up = [];
            if (pendingCrop() !== null) {
                up.push("crop");
            }
            if (statsOpen()) {
                up.push("stats");
            }
            if (liveMultipoint() !== null && !viewOnlyNow()) {
                up.push("multipoint");
            }
            return up;
        },
        selectionTool: () => toolState.currentTool === TOOLS.selection,
    });

    // Pen mode: the stylus draws, the finger pans. The page's own bit, not the
    // document's; the toolbar's toggle and the pipeline's press both read it.
    const penMode = createPenMode();
    // The lock: when it is on, a creation keeps the tool; off, it hands the
    // page back to the selection (upstream's default).
    const toolLock = createToolLock();

    /** Whether the page refuses edits right now: the one question every gate asks. */
    function viewOnlyNow() {
        return !editingAllowed(presentation);
    }

    /**
     * Open the menu for whatever is under a point on the canvas.
     *
     * The hit test decides *which* menu it is: an element under the pointer gets
     * the menu of the selection, empty canvas gets the menu of the document.
     *
     * An element under the pointer that is not selected is selected first, so
     * that the menu acts on what the user pointed at. A selection that is
     * already there is left alone: a right-click that collapsed a five-element
     * selection down to one would be a right-click that changed the document
     * before it offered a menu about it.
     *
     * A *locked* element is not under the pointer as far as the hit test is
     * concerned — the kernel answers an empty list when the topmost hit is
     * locked (`crates/nextdraw-core/src/session.rs`, `hit_test_with`), because a
     * locked element absorbs the click. So a right-click on one lands in the
     * canvas menu, and the canvas menu is where "Unlock all" lives. That is the
     * only way out of a locked element, and it is why that verb is there.
     *
     * The point arrives in canvas coordinates, because that is the space the hit
     * test speaks, and it leaves in viewport coordinates, because that is the
     * space a `position: fixed` menu is placed in. The two are the same on a
     * canvas that fills the window, and the conversion is the difference on one
     * that does not.
     *
     * @param {{ x: number, y: number }} point Where the pointer was, in canvas pixels.
     * @param {Session} session
     * @param {object} ctx the paint context
     */
    function openContextMenuAt(point, session, ctx) {
        if (menu === null) {
            return;
        }
        const hits = session.hitTestAtScreen(point.x, point.y, 0);
        const hitId = hits.length > 0 ? hits[0] : null;
        let where = MENUS.canvas;
        if (hitId !== null) {
            where = MENUS.element;
            const selected = session.selectedIds();
            if (!selected.includes(hitId)) {
                session.setSelection([hitId]);
                paint(session, ctx);
            }
        }
        const rect = canvasRect.get();
        menu.open(where, commandState(session, viewOnlyNow), point.x + rect.left, point.y + rect.top);
    }

    // A drag is pointerdown → pointermove (with movement above a threshold) →
    // pointerup, on the same element. The threshold separates it from a click
    // so the same gesture that selects an element with a quick press turns into
    // a translate when the cursor moves a few pixels. Three pixels is the
    // standard touch / mouse threshold and matches what a desktop editor does.
    // The pointer pipeline is a use case of its own (TASK-26): it owns the live
    // gesture, the touch bookkeeping, the crop and multipoint ghosts, the space
    // key and the tool handle, and the page drives it through this one seam.
    const {
        onPointerDown, onPointerMove, onPointerUp, onPointerCancel, cancelTransform,
        syncCursor, canvasPointFromEvent, transformPictureAt,
        liveMultipoint, pendingGesture, pendingCrop, armCropMode, endMultipoint, exitCropMode, confirmCropMode,
        isSpaceHeld, setSpaceHeld, setToolButtonRefresher, refreshToolButtons,
        laserPoints,
        toolState, pointerAt,
    } = createGesturePipeline({
        canvas, statusLine, renderStatus, paint, selectAt, openContextMenuAt, nowMs, dateNowMs,
        mountTextEditor,
        // The frame cache is the painter's: the hover reads the selection's
        // chrome record out of the same frame the handles were drawn from, so
        // the cursor's angle cannot drift from the square under the pointer.
        frames,
        // A creation reads this instance's drawing preferences once, at the
        // press (TASK-295/296): the style is the same per-instance store the
        // pickers already write, not a parallel one, and the gesture layer
        // never keeps a copy.
        stylePreferences,
        canvasRect,
        isViewOnly: viewOnlyNow,
        penMode: () => penMode.isOn(),
        toolLock: () => toolLock.isOn(),
    });

    /**
     * The paint itself, built once the pipeline has answered what it owns.
     *
     * It is built here and not where `paintOrRecover` is written because it is handed
     * the gesture in flight, the multipoint ghost and the laser's points (the pipeline's),
     * the status line, and the save: none of them exists earlier in this body. The door
     * (`paintOrRecover`) reaches it by name when the scheduler fires, which is after boot.
     * The functions that read a value the page reassigns later are written as thunks, so the
     * paint always sees the page's current one.
     */
    // The static layer the paint carries its picture on, and the measurement
    // door that turns it off. The glass is a canvas the page makes, the same
    // way the faded buffer is; the door is a query flag the e2e measurement
    // reads, because the before/after of AC#4 is the same page painting both
    // ways, and a flag is the honest way to ask one page for both.
    const staticLayer = createStaticLayer({
        createCanvas: () => document.createElement("canvas"),
    });
    const staticLayerOff =
        new URLSearchParams(window.location?.search ?? "").get("static") === "0";

    // Upstream's shape switch: whether its panel is up is the runner's to change
    // (Tab, Escape), and the panel is drawn with every frame beside the selection.
    const shapeSwitch = createShapeSwitch();
    const shapeSwitchPanel = bindShapeSwitchPanel({
        shapeSwitch, document, parent: root ?? document.body, canvas, canvasRect, paint,
        onProblem: (message) => {
            statusLine.setProblem(message);
            renderStatus();
        },
        text: say,
        editable: () => !viewOnlyNow(),
        signal: lifecycle.signal,
    });

    /**
     * Put the welcome screen where the frame and the tool say it belongs.
     *
     * The frame carries the scene it was composed from — `items` is the
     * empty canvas upstream welcomes or the drawing that removes the welcome —
     * and the spine holds the armed tool. The mode attribute is the page's own
     * answer for zen, which upstream includes in the same condition.
     *
     * @param {object} session the session the frame was read from.
     * @param {{items: object[]}} frame the committed frame.
     */
    function syncWelcome(session, frame) {
        welcomeScreen.sync({
            empty: frame.items.length === 0,
            tool: toolState.currentTool,
            zen: root.getAttribute("data-zen") !== null,
        });
    }

    const { paintNow } = createPaintFrame({
        canvas, window, frames, statusLine, renderStatus, embeddableLayer, persistScheduler, paint,
        pendingGesture, pendingCrop, liveMultipoint, laserPoints, transformPictureAt, eraserTrailAt, nowMs,
        localPeerId,
        staticLayer, staticLayerOff,
        themeFilterValue: () => themeFilterValue,
        peersAt: (now) => presencePeers().peers(now),
        syncStyleControls: (styles) => syncStyleControls(styles),
        syncStrokeColour: (styles) => syncStrokeColour(styles),
        syncBackgroundColour: (styles) => syncBackgroundColour(styles),
        syncTextStyle: (styles) => syncTextStyle(styles),
        syncArrowStyle: (styles) => syncArrowStyle(styles),
        syncHistoryButtons: (available) => syncHistoryButtons(available),
        syncZoomButtons: (answer) => syncZoomButtons(answer),
        syncWelcome,
        syncContextHint: () => hintViewer.refresh(),
        syncShapeSwitch: (session, frameCtx) => shapeSwitchPanel.sync(session, frameCtx),
    });
    setPaintNow(paintNow);

    /**
     * The verbs, and the statistics panel they open.
     *
     * The runner is built after the pipeline because it is handed the tool state,
     * the mode exits and the pointer, which the pipeline owns, and the clipboard's
     * doors, which exist once the words do. The panels live in the
     * runner: the page asks `statsOpen()` and holds no handle of its own.
     */
    const helpHandle = { open: () => helpDialog?.open() };
    // The accessible explorer: the panel is the page's, the snapshot and the
    // selection are the caller's (the command's body passes the current
    // session and its paint, so the panel never holds a session of its own).
    const semanticExplorer = createSemanticExplorer({ document, say });
    lifecycle.onDestroy?.(() => semanticExplorer.destroy());
    // The lock the Q key flips and the toolbar's lock button read: the switch
    // is the page's and the key and the button write the same one.
    const { runCommand, toolArmed, statsOpen } = createCommandRunner({
        presentation, statusLine, renderStatus, paint, toolState, refreshToolButtons, syncCursor,
        exitCropMode, confirmCropMode, endMultipoint, armCropMode, cancelTransform, pointerAt, pasteFromTheSystem, pastePlainFromTheSystem, shareWithTheSystem,
        copyDrawing, insertLibraryPieces, forgetImageFor, say, root, document, lifecycle,
        viewOnlyNow, linkDialog, confirmClearCanvas, helpDialog: helpHandle, semanticExplorer,
        indexedDB, GRID_STEP, VIEW_FIT_PADDING, shapeSwitch, canvas, toolLock,
    });

    /**
     * Report a failure of the theme on the status line.
     *
     * The theme is the one part of the page that is bound before the kernel is
     * even asked for, so its failures cannot wait for a session to exist. The
     * status line is the page's failure channel and it works before the kernel
     * does, so the theme says what went wrong there like everything else does.
     *
     * @param {unknown} error The failure to report.
     */
    function reportThemeProblem(error) {
        statusLine.setProblem(`theme: ${error.message ?? error}`);
        renderStatus();
    }

    // The shell menu's rows, built before the theme binder: the theme control
    // is a row of this menu, and this is the first binder that looks one up.
    // The builder is idempotent, so `bindUiCommands` and a panic rebuild find
    // the same rows.
    prepareCanvasMenu(document);

    // The theme, bound here and not by the kernel's boot: the page has to come up
    // in the theme the user chose, and the kernel's load is the slow part of the
    // page's first second. Binding it here puts the theme on the page before the
    // kernel is even asked for.
    //
    // The button's pressed state belongs to `client/theme.mjs` and is written
    // nowhere else — the same rule the tool toolbar follows.
    try {
        bindThemeToggle({
            root: document.documentElement,
            onChange: () => {
                // The filter is read again because the stylesheet is what declares it,
                // and the stylesheet has just been told which theme the page is in.
                themeFilterValue = themeFilter(document.documentElement);
                repaintAfterThemeChange();
            },
            onError: reportThemeProblem,
            signal: lifecycle.signal,
        });
    } catch (error) {
        // A page with no theme button is a page without the theme, not a page
        // without the drawing. The failure is said out loud and the app carries
        // on: the rest of the page does not depend on the theme being there.
        reportThemeProblem(error);
    }

    return {
        viewOnlyNow, pageState, runCommand, toolArmed, mountTextEditor, hintPreference, penMode, toolLock,
        stylePreferences,
        syncCursor, canvasPointFromEvent, toolState, setToolButtonRefresher,
        onPointerDown, onPointerMove, onPointerUp, onPointerCancel,
        pendingGesture, liveMultipoint, isSpaceHeld, setSpaceHeld, pointerAt,
        // What the page asks when a key arrives or the pointer opens the menu.
        menuNow: () => menu,
        paletteNow: () => palette,
        // What the page's table answers: the refreshers the paint calls, and the
        // two handles the keyboard and the right click ask about.
        setCommandViews({ syncStyleControls: styleControls, syncStrokeColour: strokeColour,
            syncBackgroundColour: backgroundColour, syncTextStyle: textStyle, syncArrowStyle: arrowStyle,
            syncHistoryButtons: historyButtons, syncZoomButtons: zoomButtons, menu: boundMenu, palette: boundPalette,
            helpDialog: boundHelpDialog, hintViewer: boundHintViewer }) {
            syncStyleControls = styleControls;
            syncStrokeColour = strokeColour;
            syncBackgroundColour = backgroundColour;
            syncTextStyle = textStyle;
            syncArrowStyle = arrowStyle;
            syncHistoryButtons = historyButtons;
            syncZoomButtons = zoomButtons;
            menu = boundMenu;
            palette = boundPalette;
            helpDialog = boundHelpDialog;
            hintViewer = boundHintViewer;
        },
        // What the session start hands back as it comes up.
        setThemeFilterValue: (value) => { themeFilterValue = value; },
        setRepaintAfterThemeChange: (fn) => { repaintAfterThemeChange = fn; },
    };
}
