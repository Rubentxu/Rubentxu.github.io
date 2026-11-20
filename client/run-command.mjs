// The command runner: what every named verb does to the document.
//
// # What this file is
//
// The switch that keyboard, menu and palette all arrive at. The registry
// (`commands.mjs`) is a vocabulary; this module holds the bodies. It was the
// largest function of the page's entry point and it moved here whole, so the
// page keeps the state and this module keeps the verbs.
//
// # What it is handed
//
// Everything the verbs touch that the page owns arrives by name in `deps`: the
// presentation state, the status line, the paint, the tool state, the three
// mode exits, the clipboard doors and the words. Nothing is read from the
// page's scope, so a suite can build a runner over fakes and a real session.
//
// # What it keeps
//
// The statistics and library panels. Each is built on its first ask and lives
// as long as the runner, so the page asks `statsOpen()` instead of holding a
// handle of its own.

import {
    alignOf,
    commandEdits,
    flowchartDirectionOf,
    nudgeOffset,
    toolKeyOf,
    viewActionOf,
} from "./commands.mjs";
import { TOOLS, applyKey as applyToolKey } from "./tools.mjs";
import { stepHistory } from "./history.mjs";
import { DEFAULT_ZOOM, zoomBy } from "./zoom.mjs";
import { downloadText } from "./export.mjs";
import { applyPresentation, editingAllowed, toggleMode } from "./presentation.mjs";
import { noticeText } from "./mode-notices.mjs";
import { openStatsPanel } from "./stats-panel.mjs";
import { openLibraryPanel } from "./library-panel.mjs";
import { CHROME_ICONS } from "./chrome-icons.mjs";
import { createLibraryStore } from "./library-store.mjs";
import { browserIndexedDB, createImageStore } from "./image-store.mjs";
import { askLink } from "./link-dialog.mjs";
import { deleteTarget } from "./vertex-edit.mjs";
import { isRefusal } from "./gesture-pipeline.mjs";

/** The iconary's drawing for a name, as a node the library sidebar can wear. */
function iconNode(document, name) {
    const template = document.createElement("template");
    template.innerHTML = CHROME_ICONS[name] ?? "";
    return template.content?.firstElementChild ?? null;
}

/**
 * @typedef {object} CommandRunnerDeps
 * @property {object} presentation The page's presentation state (zen, view).
 * @property {object} statusLine
 * @property {() => void} renderStatus
 * @property {(session: object, ctx: object) => void} paint
 * @property {object} toolState
 * @property {() => void} refreshToolButtons
 * @property {() => void} syncCursor
 * @property {(session: object, ctx: object) => void} exitCropMode
 * @property {(session: object, ctx: object) => void} confirmCropMode
 * @property {(onConfirm: () => void) => void} [confirmClearCanvas] Ask before clearing; call `onConfirm` to clear.
 * @property {(session: object, ctx: object) => void} endMultipoint
 * @property {(id: string) => void} armCropMode
 * @property {{ x: number, y: number }} pointerAt The pointer's last place, read at the verb.
 * @property {(session: object, ctx: object, at: object) => void} pasteFromTheSystem
 * @property {(session: object, ctx?: object) => void} shareWithTheSystem
 * @property {(id: string, session: object) => void} copyDrawing
 * @property {(session: object, envelope: object) => Promise<void>} insertLibraryPieces
 * @property {(id: string) => void} forgetImageFor
 * @property {(key: string, source?: object) => string} say
 * @property {object} root
 * @property {object} document
 * @property {{ signal: AbortSignal }} lifecycle
 * @property {() => boolean} viewOnlyNow
 * @property {object | null} linkDialog
 * @property {unknown} [indexedDB] The factory the library's database opens on; absent means the browser's.
 * @property {number} GRID_STEP The pitch the grid verb turns the grid on at.
 * @property {number} VIEW_FIT_PADDING The margin the fit verbs leave.
 */

/**
 * @param {CommandRunnerDeps} deps
 * @returns {{ runCommand: (id: string, session: object, ctx: object) => void, statsOpen: () => boolean }}
 */
import { createSemanticFacade } from "./semantic-facade.mjs";
import { exportText } from "./semantic-text-export.mjs";
import { ensureAgentTools } from "./agent-tools.mjs";
import { createSemanticSnapshots } from "./semantic-snapshot.mjs";
let sharedSnapshots = null;
let sharedSession = null;

/** The page's one snapshot cache: a new session gets a new cache. */
function snapshotsFor(session) {
    if (sharedSnapshots === null || sharedSession !== session) {
        sharedSnapshots = createSemanticSnapshots();
        sharedSession = session;
    }
    return sharedSnapshots;
}

export function createCommandRunner(deps) {
    const {
        presentation, statusLine, renderStatus, paint, toolState, refreshToolButtons, syncCursor,
        exitCropMode, confirmCropMode, confirmClearCanvas = () => {}, endMultipoint, armCropMode,
        cancelTransform = () => false, pointerAt, pasteFromTheSystem, shareWithTheSystem,
        copyDrawing, insertLibraryPieces, forgetImageFor, say, root, document, lifecycle,
        pastePlainFromTheSystem = async () => {},
        viewOnlyNow, linkDialog, helpDialog, semanticExplorer, indexedDB, GRID_STEP, VIEW_FIT_PADDING,
        shapeSwitch = null, canvas = null, toolLock = null,
    } = deps;

    /** The statistics panel, or `null` until the verb first opens it. */
    let statsPanel = null;

    /** The library panel, or `null` until the verb first opens it. */
    let libraryPanel = null;

    /** The styles the copy-styles verb took, as the patch the paste verb applies. */
    let copiedStyles = null;

    /**
     * The writable part of what `stylesOf` answered.
     *
     * The read door and the write door speak the same vocabulary, so copying
     * the styles is copying the tokens; what is left out is what a patch cannot
     * write back — the words `mixed` and the `null` of a row the selection does
     * not carry — because "keep this one as it is" is the absence of a key.
     */
    function stylesPatch(tokens) {
        const patch = {};
        for (const key of [
            "fill", "stroke", "lineWidth", "roughness", "opacity", "edges",
            "strokeColor", "backgroundColor", "fontFamily", "fontSize",
            "textAlign", "verticalAlign", "startArrowhead", "endArrowhead", "arrowType",
        ]) {
            const value = tokens[key];
            if (value === undefined || value === null || value === "mixed") {
                continue;
            }
            patch[key] = value;
        }
        return patch;
    }

    /** The font size the selection agrees on, or `null` when it is not one text size. */
    function selectedFontSize(session) {
        const tokens = JSON.parse(session.stylesOf() ?? "null");
        const size = tokens?.fontSize;
        return typeof size === "number" ? size : null;
    }

    /**
     * What arming a tool does to the page besides the tool, and the paint after it.
     *
     * Upstream's `setActiveTool` drops the selection for every tool but the
     * selection tool, so the drag that follows draws on its own and not beside
     * shapes still wearing their handles; the shape switch's panel hangs from
     * that selection and shuts with it. The keyboard's letters and the
     * toolbar's buttons both arm through here, so the two cannot disagree.
     *
     * @param {Session} session
     * @param {object} ctx the paint context
     */
    function toolArmed(session, ctx) {
        if (toolState.currentTool !== TOOLS.selection) {
            shapeSwitch?.close();
            session.clearSelection();
        }
        paint(session, ctx);
    }

    /**
     * Shut the shape switch, and paint so its panel goes too, for the verbs whose
     * own body does not paint: an Escape that closes another panel (upstream's
     * Escape shuts the switch wherever it lands outside a field), and the turn
     * to a view-only page, where a switch that converts has no place.
     */
    function shutShapeSwitch(session, ctx) {
        if (shapeSwitch === null || !shapeSwitch.isOpen()) {
            return;
        }
        shapeSwitch.close();
        paint(session, ctx);
    }

    /** Change the selection's size by a step, inside the editor's own range. */
    function stepFontSize(session, ctx, step) {
        const size = selectedFontSize(session);
        if (size === null) {
            return;
        }
        const next = Math.min(96, Math.max(8, size + step));
        if (next === size) {
            return;
        }
        session.setStyle(session.selectedIds(), JSON.stringify({ fontSize: next }));
        paint(session, ctx);
    }

    /**
     * Do what a command says.
     *
     * The bodies live here and not in the registry, because the registry is a
     * *vocabulary*: it says which verbs exist, what they are called and which key
     * names them. What a verb does to the document is the client's business, and
     * the kernel's — this function is the seam between the two, and it is the only
     * place that reaches the kernel on behalf of a named verb.
     *
     * All three affordances come through here. The keyboard asks the registry
     * which verb a key names and calls this; the menu asks the registry which
     * verbs are available and calls this; the palette asks the registry which
     * verbs a query names and calls this. One set of bodies, so the three
     * affordances cannot do the same thing differently.
     *
     * @param {string} id The verb's name, as the registry spells it.
     * @param {Session} session
     * @param {object} ctx the paint context
     */
    function runCommand(id, session, ctx) {
        // The one gate for editing. Keyboard, menu and palette all arrive here, so
        // a verb that edits is refused here once, for all three, while the page is
        // view-only. A verb added to the registry edits unless the registry says
        // it does not, so this gate fails closed.
        if (commandEdits(id) && !editingAllowed(presentation)) {
            return;
        }
        const nudge = nudgeOffset(id);
        if (nudge !== null) {
            // The arrows move the selection in screen space, y down. The refusal is
            // caught, not swallowed: a selection the kernel does not recognise has
            // nothing to move. An empty selection is a kernel noop.
            try {
                session.nudge(nudge.dx, nudge.dy);
            } catch (error) {
                statusLine.setProblem(`nudge failed: ${error.message ?? error}`);
                renderStatus();
                return;
            }
            paint(session, ctx);
            return;
        }
        const toolKey = toolKeyOf(id);
        if (toolKey !== null) {
            // A tool letter arms its tool, whatever is selected: upstream's R, D and O
            // never touch the document, and turning a selected shape into another is
            // Tab's (`shapeSwitchNext`). The kernel does not know what a tool is. The
            // cursor tracks the tool, so a crosshair over the canvas says "drag to draw".
            applyToolKey(toolState, toolKey);
            refreshToolButtons();
            syncCursor();
            toolArmed(session, ctx);
            return;
        }
        const viewAction = viewActionOf(id);
        if (viewAction !== null) {
            try {
                if (viewAction === "fit-content") {
                    session.fitContent(VIEW_FIT_PADDING);
                } else if (viewAction === "fit-selection") {
                    session.fitSelection(VIEW_FIT_PADDING);
                } else if (viewAction === "zoom-reset") {
                    session.zoomAtCentre(DEFAULT_ZOOM);
                } else {
                    session.zoomAtCentre(zoomBy(session.zoom(), viewAction === "zoom-in" ? 1 : -1));
                }
                paint(session, ctx);
            } catch (error) {
                statusLine.setProblem(`view failed: ${error.message ?? error}`);
                renderStatus();
            }
            return;
        }
        const alignment = alignOf(id);
        if (alignment !== null) {
            // One atomic transition, the same reason `reorderAll` is one: a twelve-element
            // alignment that pushed a history entry per element would take twelve undos to
            // walk back. The kernel resolves the reference box from the selection's own
            // bounds, so there is no per-element arithmetic for the client to get wrong.
            if (session.selectedIds().length === 0) {
                return;
            }
            // The refusal is caught, not swallowed: an alignment that quietly did nothing
            // would leave the shapes where they were and the user looking for the reason.
            try {
                session.alignAll(alignment.axis, alignment.mode);
            } catch (error) {
                statusLine.setProblem(`alignAll failed: ${error.message ?? error}`);
                renderStatus();
                return;
            }
            paint(session, ctx);
            return;
        }
        const flowchartDirection = flowchartDirectionOf(id);
        if (flowchartDirection !== null) {
            // The diagram gesture: the kernel picks the neighbouring node — tiers,
            // tie-breaks and all — and answers with the selection it leaves behind.
            // A quiet key (no node in the selection, nothing that way) changes
            // nothing, which is the answer, not a failure; the paint follows anyway
            // so the ring follows the selection whichever way it went. The refusal
            // is caught, not swallowed: only a bad direction word can raise, and
            // the registry spells those, so one here is a defect.
            try {
                session.navigateFlowchart(flowchartDirection);
            } catch (error) {
                statusLine.setProblem(`navigateFlowchart failed: ${error.message ?? error}`);
                renderStatus();
                return;
            }
            paint(session, ctx);
            return;
        }
        switch (id) {
            case "toggleToolLock": {
                // The page's lock switch flips, and the toolbar's lock button
                // follows it: the button's pressed state is the same reading
                // the key wrote, the way every tool button's state is
                // (`App.tsx:5387-5388`, `toggleLock("keyboard")`).
                if (toolLock !== null) {
                    toolLock.toggle();
                    refreshToolButtons();
                }
                return;
            }
            case "help":
                helpDialog?.open();
                return;
            case "clearCanvas": {
                // Whole-scene deletion has its own explicit confirmation step:
                // opening the prompt is the only effect until the user confirms.
                // The deletion and the release of every picture it drops are this
                // branch's, so a cancelling user loses nothing.
                confirmClearCanvas(() => {
                    const going = session.sceneIds();
                    try {
                        session.clearScene();
                    } catch (error) {
                        statusLine.setProblem(`clearScene failed: ${error.message ?? error}`);
                        renderStatus();
                        return;
                    }
                    // The cut's own rule: an id the kernel lets anyone reuse must
                    // not keep painting the picture the removed element held.
                    for (const id of going) {
                        forgetImageFor(id);
                    }
                    paint(session, ctx);
                });
                return;
            }
            case "clearSelection":
            case "escape":
                // Same outcome through two gestures: "drop everything I had selected", with the
                // repaint a click on empty space would do. And Escape carries the tool home:
                // upstream's Escape returns to the selection tool from an armed draw tool, and the
                // tool table's own row for "Escape" says the same. A draw tool armed with the mouse
                // that stayed armed through Escape made the next drag draw over everything.
                //
                // A move, a resize or a turn in flight is the one thing Escape takes first:
                // the transform is thrown away and the document is the one the press found.
                // The selection stays, so the user sees what they were about to change.
                if (id === "escape" && cancelTransform(session, ctx)) {
                    return;
                }
                // Upstream's Escape shuts the shape switch's panel with the rest.
                shapeSwitch?.close();
                // Escape inside a group leaves the group before it drops the selection
                // (`WF-SELECT-08`): the group just left becomes the selection and its
                // dashed box stays, the parent group becomes the edited one when nested,
                // and a second Escape drops the selection the way it always did
                // (`actionDeselect.ts:68-112`). `clearSelection` is the second Escape.
                if (id === "escape" && session.editingGroupId() != null) {
                    session.leaveGroup();
                } else {
                    session.clearSelection();
                }
                if (id === "escape" && toolState.currentTool !== TOOLS.selection) {
                    applyToolKey(toolState, "escape");
                    refreshToolButtons();
                    syncCursor();
                }
                paint(session, ctx);
                return;
            case "cropConfirm":
                confirmCropMode(session, ctx);
                return;
            case "cropExit":
                // Escape cancels the transient crop selection without creating history.
                // The crop and the line below paint on their way out, which takes the
                // shape switch's panel with them.
                shapeSwitch?.close();
                exitCropMode(session, ctx);
                return;
            case "statsClose":
                statsPanel.close();
                shutShapeSwitch(session, ctx);
                return;
            case "multipointEnd":
                shapeSwitch?.close();
                endMultipoint(session, ctx);
                return;
            case "cropArm": {
                const [chosen] = session.selectedIds();
                armCropMode(chosen);
                syncCursor();
                paint(session, ctx);
                return;
            }
            case "shapeSwitchNext":
            case "shapeSwitchPrevious": {
                // Upstream's Tab: the first press opens the panel beside the selection
                // and seeds its conversion cache, each press while it is up turns the
                // selected shapes or linears into the next variant of their family (the
                // previous one with Shift), one undo step each. The order and the family
                // are the kernel's; whether the panel is up is the switch's.
                if (shapeSwitch === null) {
                    return;
                }
                try {
                    shapeSwitch.press(session, id === "shapeSwitchPrevious");
                } catch (error) {
                    statusLine.setProblem(`cycleSelectedShape failed: ${error.message ?? error}`);
                    renderStatus();
                    return;
                }
                paint(session, ctx);
                return;
            }
            case "enableTextAutoResize": {
                // The menu can outlive the selection that opened it. Recheck the
                // kernel-owned predicate at dispatch so a stale menu cannot act
                // on a different or now-auto-sized element.
                const selected = session.selectedIds();
                if (selected.length !== 1 || !session.isTextFixed(selected[0])) {
                    return;
                }
                try {
                    session.enableTextAutoResize(selected[0]);
                } catch (error) {
                    statusLine.setProblem(`enableTextAutoResize failed: ${error.message ?? error}`);
                    renderStatus();
                    return;
                }
                paint(session, ctx);
                return;
            }
            case "undo":
            case "redo": {
                // The same step the toolbar's buttons take: the kernel moves the
                // history, and the pictures of the elements the scene no longer
                // holds are released. The step is one function because the button,
                // the key, the menu and the palette must move the same history.
                if (stepHistory(session, id)) {
                    paint(session, ctx);
                }
                return;
            }
            // The distributions: the free space shared out evenly, one atomic
            // transition and one undo entry for the whole selection — the same
            // contract the alignment above carries. The refusal is caught, not
            // swallowed: a distribution that quietly did nothing would leave the
            // shapes where they were and the user looking for the reason.
            case "distributeHorizontally":
            case "distributeVertically": {
                try {
                    session.distributeAll(id === "distributeHorizontally" ? "horizontal" : "vertical");
                } catch (error) {
                    statusLine.setProblem(`distributeAll failed: ${error.message ?? error}`);
                    renderStatus();
                    return;
                }
                paint(session, ctx);
                return;
            }
            case "paste": {
                // The place is the pointer's place in the scene, taken now: the
                // pointer is where the user was when they pressed the key, and a
                // pointer that moved while the browser was thinking is not where
                // they asked to paste.
                //
                // The paste reads the system clipboard, because that is the
                // surface this application shares with the rest of the machine:
                // what another application left there is what lands on the
                // canvas, in the shape the kernel knows how to read.
                //
                // The read is asynchronous — the browser answers when it
                // answers — so the verb returns before anything is put down and
                // the canvas is repainted when the paste lands.
                //
                // The paste is a refusal the user is never going to notice when
                // it has nothing to put down: an empty clipboard is not an
                // error, it is nothing to paste. Every other refusal is a
                // defect and is raised, because a `catch (_)` would swallow a
                // defect in this file or in the kernel with exactly the same
                // silence as the one refusal nobody would have noticed anyway.
                const at = session.screenToScene(pointerAt.x, pointerAt.y);
                pasteFromTheSystem(session, ctx, at);
                return;
            }
            case "pastePlain": {
                // The plain paste is the same door as paste with the offers
                // taken out: the clipboard's text is put down as the text it is.
                const at = session.screenToScene(pointerAt.x, pointerAt.y);
                pastePlainFromTheSystem(session, ctx, at);
                return;
            }
            case "showStrokeColour": {
                document.getElementById("stroke-colour")?.focus();
                return;
            }
            case "showBackgroundColour": {
                document.getElementById("background-colour")?.focus();
                return;
            }
            case "showFontFamily": {
                document
                    .getElementById("text-family-row")
                    ?.querySelector("button[data-text-choice]")
                    ?.focus();
                return;
            }
            case "copyStyles": {
                const tokens = JSON.parse(session.stylesOf() ?? "null");
                if (tokens === null) {
                    return;
                }
                copiedStyles = stylesPatch(tokens);
                return;
            }
            case "pasteStyles": {
                if (copiedStyles === null) {
                    return;
                }
                const ids = session.selectedIds();
                if (ids.length === 0) {
                    return;
                }
                session.setStyle(ids, JSON.stringify(copiedStyles));
                paint(session, ctx);
                return;
            }
            case "fontSizeIncrease": {
                stepFontSize(session, ctx, 2);
                return;
            }
            case "fontSizeDecrease": {
                stepFontSize(session, ctx, -2);
                return;
            }
            case "toggleTheme": {
                // The theme is the page's, not the drawing's, and the page's
                // own switch already knows how to turn it over and remember it;
                // the verb asks that switch instead of repeating its rule.
                document.querySelector("button[data-theme-toggle]")?.click();
                return;
            }
            case "editSelected": {
                // Enter is the keyboard's double click: the canvas already owns
                // the rule (`text-editor-wiring.mjs`: a text gets edited, a
                // container gets a label, a vertex or a frame title gets its
                // own editor), so the verb hands it the same event instead of
                // keeping a second copy of the decision. The point is the
                // selected element's centre, in the canvas's own coordinates.
                if (canvas === null) {
                    return;
                }
                const ids = session.selectedIds();
                if (ids.length !== 1) {
                    return;
                }
                const [x1, y1, x2, y2] = session.boundsOf(ids[0]);
                const [screenX, screenY] = session.sceneToScreen((x1 + x2) / 2, (y1 + y2) / 2);
                const rect = canvas.getBoundingClientRect?.() ?? { left: 0, top: 0 };
                const at = {
                    clientX: rect.left + screenX,
                    clientY: rect.top + screenY,
                    bubbles: true,
                    cancelable: true,
                };
                if (typeof MouseEvent === "function") {
                    canvas.dispatchEvent(new MouseEvent("dblclick", at));
                } else {
                    canvas.dispatchEvent("dblclick", at);
                }
                return;
            }
            case "insertImage": {
                // The import button owns the file picker and the door the bytes
                // land through; the verb is the keyboard's way to that button.
                document.querySelector("button[data-import]")?.click();
                return;
            }
            case "agentTools": {
                // The accessible switch for the optional WebMCP adapter: it
                // enables with the user's consent or revokes and unregisters.
                const tools = ensureAgentTools({ session });
                if (!tools.adapter.supported) {
                    statusLine.setProblem("WebMCP no está disponible en este navegador");
                    return;
                }
                const answer = tools.adapter.isEnabled() ? tools.revoke() : tools.enable();
                if (answer.status !== "enabled" && answer.status !== "revoked") {
                    statusLine.setProblem(`agent tools: ${answer.status}`);
                }
                return;
            }
            case "exportText": {
                // The readable description: the same projection the explorer
                // reads, never `toJson`, and the browser's download door. A
                // selection exports the selection; no selection, the document.
                const snapshot = JSON.parse(snapshotsFor(session).snapshot(session));
                const selected = session.selectedIds?.() ?? [];
                downloadText(
                    exportText(snapshot, { selection: selected.length > 0 ? selected : null }),
                    "drawing.md",
                    document,
                    globalThis.URL,
                    "text/markdown",
                );
                return;
            }
            case "saveLibrary": {
                // The drawing as a library file: the whole scene, one piece, the
                // reference's own envelope. The download goes through the same
                // door the SVG export uses, under the extension the reference
                // names for its libraries.
                downloadText(
                    session.saveLibrary(),
                    "nextdraw.excalidrawlib",
                    document,
                    globalThis.URL,
                    "application/json",
                );
                return;
            }
            case "copyPng":
            case "copySvg": {
                copyDrawing(id, session);
                return;
            }
            case "selectAll": {
                // The empty-scene case is a noop on the kernel side
                // too, so we always paint to keep behaviour uniform.
                session.selectAll();
                paint(session, ctx);
                return;
            }
            case "unlockAll": {
                // One keystroke, one transition, one history entry: the kernel
                // pushes a single entry for the whole scene, so one undo
                // puts the elements back the way they were.
                //
                // This is the door out of a locked element. A locked element
                // cannot be selected, so the toggle could never unlock one;
                // the canvas menu's "Unlock all" is the only way back, and
                // that is why the predicate does not also require an empty
                // selection.
                session.unlockAll();
                paint(session, ctx);
                return;
            }
            case "zenMode": {
                // Zen hides the control panel and nothing else: the drawing is
                // the page for a while. The kernel is never asked — a drawing
                // with its controls hidden is the same drawing — and the notice
                // is the way back, because the panel that would have said so is
                // the panel that just went away. It says the key, which is the
                // one affordance the hidden bar cannot carry about itself.
                const on = toggleMode(presentation, "zen");
                applyPresentation(root, presentation);
                statusLine.setNotice(
                    noticeText(say, on ? "notice.zen.on" : "notice.zen.off"),
                    true,
                );
                renderStatus();
                return;
            }
            case "viewMode": {
                // View takes the document out of the pointer's reach: the
                // pipeline refuses every editing press while the mode is on, and
                // the pan, the pinch and the wheel zoom keep working above that
                // gate. The kernel is never asked, for the same reason zen's
                // body never asks it — this is a fact about the page, not about
                // the drawing.
                //
                // The toolbar stays visible and honest: its buttons still arm
                // their tools, and a drag simply does nothing until the mode is
                // off. Upstream hides the editing surfaces instead
                // (`App.tsx:2300`); keeping them and refusing at the gesture is
                // the port's own answer, recorded in `docs/PARITY.md`.
                const on = toggleMode(presentation, "view");
                applyPresentation(root, presentation);
                if (on) {
                    shutShapeSwitch(session, ctx);
                }
                statusLine.setNotice(
                    noticeText(say, on ? "notice.view.on" : "notice.view.off"),
                    true,
                );
                renderStatus();
                return;
            }
            case "toggleGrid": {
                // Turning on either presentation mode clears the other one,
                // matching the reference's grid/object-snap actions. The kernel
                // still owns both settings; the command keeps their UI modes
                // mutually exclusive.
                const on = session.gridStep() === undefined;
                session.setSnapGuides(false);
                session.setGridStep(on ? GRID_STEP : undefined);
                paint(session, ctx);
                statusLine.setNotice(
                    noticeText(say, on ? "notice.grid.on" : "notice.grid.off", { step: GRID_STEP }),
                    true,
                );
                renderStatus();
                return;
            }
            case "toggleMidpoint": {
                const on = !session.midpointSnapping();
                session.setMidpointSnapping(on);
                paint(session, ctx);
                statusLine.setNotice(
                    noticeText(say, on ? "notice.midpoint.on" : "notice.midpoint.off"),
                    true,
                );
                renderStatus();
                return;
            }
            case "toggleSnap": {
                // Alignment is decided at the commit and painted before it, so
                // this body is the kernel's flag and nothing else: the preview,
                // the ghost and `translateAll` all consult the same pure plan.
                // Object snapping and grid snapping are exclusive presentation
                // modes in the reference; the command clears grid before it
                // changes the kernel's guide flag.
                const on = !session.snapGuides();
                session.setGridStep(undefined);
                session.setSnapGuides(on);
                paint(session, ctx);
                statusLine.setNotice(
                    noticeText(say, on ? "notice.snap.on" : "notice.snap.off"),
                    true,
                );
                renderStatus();
                return;
            }
            case "semanticExplorer": {
                // The explorer reads the projection when it opens and not
                // before: a command that is never asked costs nothing, and
                // the panel never holds a session of its own.
                try {
                    // The panel's view is the snapshot; its actions go through
                    // the typed facade, the same door a reader or an agent uses.
                    const snapshots = snapshotsFor(session);
                    const facade = createSemanticFacade({ session, viewOnly: viewOnlyNow, snapshots });
                    semanticExplorer?.open(snapshots.snapshot(session), (id) => {
                        const answer = facade.selectElements([id]);
                        if (answer.status === "ok") {
                            paint(session, ctx);
                            renderStatus();
                        }
                        return answer;
                    }, (id, relation) => {
                        const answer = facade.navigate(id, relation);
                        return answer.status === "ok" ? answer.data : { targets: [], freeEnd: false };
                    }, (operation, args) => {
                        const { id: metaId, ...meta } = args;
                        const answer = operation === "place"
                            ? facade.placeRelative(args)
                            : operation === "connect"
                                ? facade.connectElements(args)
                                : facade.setElementMeta(metaId, meta);
                        if (answer.status !== "ok") {
                            return answer;
                        }
                        paint(session, ctx);
                        renderStatus();
                        return { ...answer, snapshot: snapshots.snapshot(session) };
                    });
                } catch (error) {
                    statusLine.setProblem(`semanticSnapshot failed: ${error.message ?? error}`);
                    renderStatus();
                }
                return;
            }
            case "stats": {
                // The panel is built on the first ask, and every render derives
                // its numbers from one `toJson` — the rule is the panel module's;
                // what this body contributes is the one source it is allowed to
                // ask. Toggling asks nothing when it closes: a closed panel has
                // no render, so a closed panel costs no crossing.
                if (statsPanel === null) {
                    statsPanel = openStatsPanel({
                        host: root,
                        createElement: (tag) => document.createElement(tag),
                        text: say,
                        source: () => ({
                            json: session.toJson(),
                            revision: session.documentRevision(),
                        }),
                        selection: () => session.selectedIds?.() ?? [],
                        onResize: (elementId, box) => {
                            try {
                                session.resize(elementId, box.x, box.y, box.width, box.height);
                            } catch (error) {
                                statusLine.setProblem(`stats resize failed: ${error.message ?? error}`);
                                renderStatus();
                                return;
                            }
                            paint(session, ctx);
                            statsPanel.refresh();
                        },
                        onRotate: (elementId, delta) => {
                            try {
                                session.rotate(elementId, delta);
                            } catch (error) {
                                statusLine.setProblem(`stats rotate failed: ${error.message ?? error}`);
                                renderStatus();
                                return;
                            }
                            paint(session, ctx);
                            statsPanel.refresh();
                        },
                        onFontSize: (elementId, fontSize) => {
                            try {
                                session.setStyle([elementId], JSON.stringify({ fontSize }));
                            } catch (error) {
                                statusLine.setProblem(`stats font size failed: ${error.message ?? error}`);
                                renderStatus();
                                return;
                            }
                            paint(session, ctx);
                            statsPanel.refresh();
                        },
                        signal: lifecycle.signal,
                    });
                }
                statsPanel.toggle();
                return;
            }
            case "library": {
                // Built on the first ask, like the statistics panel, so a page that
                // never opens the library never opens its database either. The store
                // has a database of its own: the pictures' store keeps pictures.
                //
                // The pieces are the kernel's. Reading the selection is a copy, so the
                // elements come out of the kernel in the shape it would paste them
                // back; that copy also fills the kernel's internal clipboard, which is
                // what Ctrl+C does anyway, and drops `files`: a piece that holds a
                // picture is kept without it. Laying a piece is the same call that lays
                // a library file, and the paint that follows is the frame's own.
                if (libraryPanel === null) {
                    libraryPanel = openLibraryPanel({
                        host: root,
                        createElement: (tag) => document.createElement(tag),
                        text: say,
                        icon: (name) => iconNode(document, name),
                        signal: lifecycle.signal,
                        store: createLibraryStore(
                            createImageStore(indexedDB ?? browserIndexedDB(), { database: "nextdraw.library" }),
                        ),
                        isViewOnly: viewOnlyNow,
                        readSelectionPiece: () => {
                            const ids = session.selectedIds();
                            if (ids.length === 0) {
                                return { elements: [], files: {} };
                            }
                            session.copy(ids);
                            const payload = JSON.parse(session.clipboardText());
                            return { elements: payload.elements ?? [], files: payload.files ?? {} };
                        },
                        insertPiece: async (piece) => {
                            await insertLibraryPieces(session, { libraryItems: [piece] });
                            paint(session, ctx);
                        },
                        onProblem: (message) => {
                            statusLine.setProblem(message);
                            renderStatus();
                        },
                        onNotice: (message) => {
                            statusLine.clearProblem();
                            statusLine.setNotice(message, false);
                            renderStatus();
                        },
                        // The file is chosen on an input the page builds for the occasion, and
                        // its size goes through the kernel's fence before its text is read, as
                        // an opened document's does. Nothing here reads the pieces.
                        readFile: async () => {
                            const file = await new Promise((resolve) => {
                                const input = document.createElement("input");
                                input.type = "file";
                                input.accept = ".excalidrawlib,application/json";
                                input.addEventListener("change", () => resolve(input.files?.[0] ?? null));
                                input.addEventListener("cancel", () => resolve(null));
                                input.click();
                            });
                            if (file === null) {
                                return null;
                            }
                            // A refusal of the fence rejects here and reaches the panel, which says it.
                            session.checkDocumentBytes(file.size);
                            return file.text();
                        },
                        saveFile: (fileText, name) => {
                            downloadText(fileText, name, document, globalThis.URL, "application/json");
                        },
                    });
                }
                libraryPanel.toggle();
                return;
            }
            case "openLink": {
                // The one verb that leaves the drawing: the address goes through an
                // anchor the page itself builds — `target="_blank"` with
                // `rel="noopener noreferrer"`, the door upstream's own render uses
                // (`Hyperlink.tsx:363`) — so the open carries no reference from this
                // page and no script access back to it. The address was sanitized
                // when it was stored; the anchor is the second half of the same
                // line of defence.
                const ids = session.selectedIds();
                const link = ids.map((id) => session.linkOf(id)).find((l) => l);
                if (link) {
                    const anchor = document.createElement("a");
                    anchor.href = link;
                    anchor.target = "_blank";
                    anchor.rel = "noopener noreferrer";
                    document.body.appendChild(anchor);
                    anchor.click();
                    anchor.remove();
                }
                return;
            }
            case "editLink": {
                // The editor is a sheet, not a prompt: the page carries it, the
                // kernel carries the guard, and the refusal comes back as the
                // frontier's own `bad_link` for the status line — a stored
                // `javascript:` address is a stored hazard, so the write refuses
                // and says so.
                const ids = session.selectedIds();
                if (ids.length === 0) {
                    return;
                }
                const current = ids.map((id) => session.linkOf(id)).find((l) => l) ?? "";
                askLink({
                    host: linkDialog,
                    createElement: (tag) => document.createElement(tag),
                    current,
                    text: say,
                }).then((answer) => {
                    if (answer === null) {
                        return;
                    }
                    try {
                        session.setLink(ids, answer);
                    } catch (error) {
                        statusLine.setProblem(error.message ?? String(error));
                        renderStatus();
                        return;
                    }
                    paint(session, ctx);
                });
                return;
            }
            case "removeLink": {
                session.setLink(session.selectedIds(), "");
                paint(session, ctx);
                return;
            }
            case "cut": {
                // `Cmd+X` is one atomic transition that removes the selection
                // and leaves it in the clipboard. It lays nothing down: the
                // copies are what a paste makes, and a cut that inserted them
                // would have two ways of saying the same thing. An immediate
                // `Cmd+V` lays the selection down again, and an immediate
                // `Cmd+Z` undoes the whole thing in one step. Empty selection
                // is a noop, same as copy.
                const ids = session.selectedIds();
                if (ids.length === 0) {
                    return;
                }
                // `cut` refuses an id the scene does not hold and an empty
                // selection; both are defects rather than something the user
                // asked for, and a `catch (_)` here would make a cut that
                // deleted the originals and then failed to write the
                // clipboard look exactly like a `Cmd+X` on an empty canvas.
                let removed;
                try {
                    removed = session.cut(ids);
                } catch (error) {
                    if (isRefusal(error, "empty_clipboard")) {
                        return;
                    }
                    throw error;
                }
                if (removed.length > 0) {
                    // The cut is a deletion path, so it owes the same release:
                    // the bytes the removed elements were holding are theirs no
                    // more. Nothing is released for the clipboard — the paste
                    // that follows will ask for its own bytes under the new
                    // identities it mints.
                    for (const id of removed) {
                        forgetImageFor(id);
                    }
                    // The selection is emptied by the cut itself: the elements it
                    // named are gone, so there is nothing left to select.
                    //
                    // The removed elements go to the system clipboard as well,
                    // so another application can paste what was cut here.
                    shareWithTheSystem(session);
                    paint(session, ctx);
                }
                return;
            }
            case "copy": {
                // Copy the current selection, group-expanded. An empty
                // selection is a noop because the kernel would throw on a
                // zero-length list, and the user expects "Cmd+C on nothing
                // does nothing" — not a red flash from a tagged error.
                const ids = session.selectedIds();
                if (ids.length === 0) {
                    return;
                }
                session.copy(ids);
                // The same payload goes to the system clipboard, so another
                // application can paste what was copied here — and a selection
                // that holds a picture goes as the picture it is.
                shareWithTheSystem(session, ctx);
                // No paint: the clipboard is a kernel concern, not a
                // visual one, and the selection did not change.
                return;
            }
            case "duplicate": {
                // One atomic transition: a multi-selection of N elements
                // would otherwise push 3N history entries (one duplicate
                // + two translates per id) and a single Cmd+Z would walk
                // them back one at a time. The clones arrive with an
                // identity nobody else holds, their own seed, their own
                // groups and their references pointing at the copies of
                // what they were bound to, and the fresh ids come back so
                // the clones can be re-selected without a second scene
                // round-trip. The copies land half a grid step from what
                // they were copied from, so the original and its copy are
                // both on screen and neither is hidden under the other.
                const newIds = session.duplicateAll(10, 10);
                // The duplicates are now selected, so a drag or resize
                // gesture immediately after a duplicate moves the copies,
                // not the originals.
                if (newIds.length > 0) {
                    session.setSelection(newIds);
                }
                paint(session, ctx);
                return;
            }
            case "toggleArrowBinding": {
                try {
                    if (!session.toggleSelectedArrowBinding()) {
                        return;
                    }
                } catch (error) {
                    statusLine.setProblem(`toggleArrowBinding failed: ${error.message ?? error}`);
                    renderStatus();
                    return;
                }
                paint(session, ctx);
                return;
            }
            case "toggleWrap": {
                const selected = session.selectedIds();
                if (selected.length === 0) {
                    return;
                }
                const boxes = selected.map((id) => session.boundsOf(id));
                const left = Math.min(...boxes.map(([x]) => x));
                const top = Math.min(...boxes.map(([, y]) => y));
                const right = Math.max(...boxes.map(([, , x]) => x));
                const bottom = Math.max(...boxes.map(([, , , y]) => y));
                const padding = 16;
                const frame = {
                    id: crypto.randomUUID(),
                    type: "frame",
                    x: left - padding,
                    y: top - padding,
                    width: right - left + padding * 2,
                    height: bottom - top + padding * 2,
                    name: null,
                    seed: 1,
                    version: 1,
                };
                try {
                    // The kernel answers with the ids the transition leaves
                    // standing — the frame it built, or the children it
                    // released — and the page selects exactly those:
                    // upstream's wrap hands its result back with the new
                    // frame in the selection and its unwrap with the freed
                    // children (`actionFrame.ts:259-267`, `:199-205`). A
                    // drag right after the wrap then moves the frame, not
                    // the members it swallowed.
                    const ids = session.toggleWrap(JSON.stringify(frame), selected);
                    if (Array.isArray(ids) && ids.length > 0) {
                        session.setSelection(ids);
                    }
                } catch (error) {
                    statusLine.setProblem(`toggleWrap failed: ${error.message ?? error}`);
                    renderStatus();
                    return;
                }
                paint(session, ctx);
                return;
            }
            case "group": {
                // One kernel call, one history entry. The selected ids are
                // the membership; a fresh UUID is the group id, for the
                // same reason duplicate uses one: it is unique-by-construction
                // and a server-side / collaborative path can mint the same
                // way. The kernel throws on an empty list, which our
                // `ids.length === 0` short-circuit already prevents, so a
                // bug here would surface as a missing-paint, not as a crash.
                const ids = session.selectedIds();
                if (ids.length === 0) {
                    return;
                }
                session.group(ids, `grp-${crypto.randomUUID()}`);
                paint(session, ctx);
                return;
            }
            case "ungroup": {
                // The selection may straddle several groups (a user who
                // shift-clicked widely) and several ungrouped singletons
                // (which are noops). One Set dedups the affected group_ids,
                // and a single `ungroupAll` makes the multi-group release
                // one undo. The kernel's per-id "unknown id is a noop" rule
                // means the ungrouped set does not throw on missing groups.
                const ids = session.selectedIds();
                if (ids.length === 0) {
                    return;
                }
                const groupIds = new Set();
                for (const id of ids) {
                    const gid = session.groupIdOf(id);
                    if (gid !== undefined && gid !== null) {
                        groupIds.add(gid);
                    }
                }
                if (groupIds.size === 0) {
                    return;
                }
                session.ungroupAll([...groupIds]);
                paint(session, ctx);
                return;
            }
            case "front":
            case "back":
            case "forward":
            case "backward": {
                // One atomic transition for the whole multi-selection. The
                // per-id loop the previous code emitted pushed N history
                // entries for a N-element selection, so a single Cmd+Z
                // after a `bring to front` on three elements would walk
                // them back one at a time. `reorderAll` routes the whole
                // multi-reorder through one entry, so a single undo
                // restores the original z-order.
                //
                // The four moves are one verb with four arguments, so they
                // are four cases of one branch rather than four branches —
                // and the id *is* the argument, because these four words are
                // the kernel's own vocabulary and there is no table to
                // translate them.
                if (session.selectedIds().length === 0) {
                    return;
                }
                // The kernel refuses a selection that names nothing it holds, and
                // the refusal is named: a verb that quietly did nothing would
                // leave the user looking at a z-order that did not move.
                try {
                    session.reorderAll(id);
                } catch (error) {
                    statusLine.setProblem(`reorderAll failed: ${error.message ?? error}`);
                    renderStatus();
                    return;
                }
                paint(session, ctx);
                return;
            }
            case "rotate90cw":
            case "rotate90ccw": {
                // The quarter turn is the kernel's RotateEach over the selection:
                // one crossing, one history entry, every chosen element turned
                // about its own centre. Upstream has no such command — the
                // promise is this port's own, and it is deliberately the other
                // rotation from the selection's spin: turning every shape where
                // it stands is not spinning the set about a shared pivot (that
                // is the rotate dot's gesture). An empty selection is a no-op
                // there, and the keystroke is still consumed so the browser
                // does not scroll the page under a shortcut the app has claimed.
                // The refusal is caught, not swallowed: the turn is one verb over
                // the selection, and a selection the kernel does not recognise has
                // nothing to turn.
                try {
                    session.nudgeRotate(id === "rotate90cw" ? Math.PI / 2 : -Math.PI / 2);
                } catch (error) {
                    statusLine.setProblem(`nudgeRotate failed: ${error.message ?? error}`);
                    renderStatus();
                    return;
                }
                paint(session, ctx);
                return;
            }
            case "flipHorizontal":
            case "flipVertical": {
                // The mirror is the kernel's: the client says which axis and
                // nothing else. The anchor is the centre of the selection's
                // common box and the geometry is in the kernel's `flip`
                // module, so there is no arithmetic here to get wrong.
                //
                // An empty selection is a no-op in the kernel, and the
                // keystroke is still consumed: the browser must not scroll
                // the page under a shortcut the app has claimed.
                session.flip(id === "flipHorizontal", id === "flipVertical");
                paint(session, ctx);
                return;
            }
            case "lock": {
                // One keystroke, one transition, one history entry: the kernel
                // pushes a single entry for the whole selection, so one undo
                // puts the elements back the way they were.
                //
                // Locking empties the selection — a locked element cannot be
                // selected, and a selection of elements that cannot be
                // selected is a lie the client would then paint as a ring —
                // and unlocking selects the elements it freed, so the user
                // sees what came loose.
                session.toggleLocked();
                paint(session, ctx);
                return;
            }
            case "delete": {
                // The picked point comes first, because while the edit mode is on
                // the `Supr` takes the point the user picked and not the element.
                // That is upstream's rule
                // (`packages/excalidraw/actions/actionDeleteSelected.tsx:225-270`):
                // the element is the thing that is being edited, and deleting it
                // whole is most likely a mistake.
                //
                // The decision is asked of the kernel and not taken here: the mode
                // ends when the element leaves the selection, and the picked
                // point is a point of the element being edited. Neither is a fact
                // this file owns.
                const target = deleteTarget(session);
                if (target.index !== undefined) {
                    try {
                        // The kernel re-anchors the element and moves the
                        // selection to the point before the one that went, which
                        // is upstream's rule too.
                        session.removeVertex(target.id, target.index);
                    } catch (error) {
                        statusLine.setProblem(`vertex removal failed: ${error.message ?? error}`);
                        renderStatus();
                        return;
                    }
                    paint(session, ctx);
                    return;
                }
                if (!target.elements) {
                    // The edit mode is on and no point is picked: upstream does
                    // nothing at all here, because the user most likely meant to
                    // take a point out and did not pick one
                    // (`packages/excalidraw/actions/actionDeleteSelected.tsx:236-240`).
                    // It says so rather than deleting the element under the mode.
                    statusLine.setNotice(noticeText(say, "notice.vertex-delete.edit-mode"));
                    renderStatus();
                    return;
                }
                // One keystroke, one undo. The kernel's `Session::delete_all`
                // validates every id before mutating, and pushes a single
                // history entry for the whole selection. The user that
                // picks three elements and presses `Delete` expects a
                // single `Cmd+Z` to bring all three back, not to count
                // heads. The empty-selection case is a noop at the
                // kernel and a noop at the call site, so the guard is
                // here only to skip the paint and the return value is
                // already cleared by `delete_all` itself.
                const going = session.selectedIds();
                // The kernel refuses a selection that names nothing it holds. The
                // refusal is caught and said out loud: a `Supr` that silently
                // deletes nothing is the worst kind of nothing.
                try {
                    session.deleteAll();
                } catch (error) {
                    statusLine.setProblem(`deleteAll failed: ${error.message ?? error}`);
                    renderStatus();
                    return;
                }
                // The pictures go with the elements. Two reasons, one call: the
                // bytes are memory for something nobody can see, and the kernel
                // lets an id be inserted again, so an entry left under this id
                // would paint the old picture under the new element.
                //
                // Read *before* the delete, not after: `deleteAll` clears the
                // selection, so asking afterwards answers with an empty array and
                // the loop releases nothing — a release that looks like it ran.
                for (const id of going) {
                    forgetImageFor(id);
                }
                paint(session, ctx);
                return;
            }
            default:
                // A verb the registry named and this function does not know.
                // That is a defect in the client, not something the user did:
                // the registry and the bodies are two halves of one thing, and a
                // half that is missing shows up here rather than as a menu item
                // that does nothing.
                throw new Error(`unknown command: ${id}`);
        }
    }

    return { runCommand, toolArmed, statsOpen: () => statsPanel !== null && statsPanel.isOpen() };
}
