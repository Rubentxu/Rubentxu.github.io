// The selection a click makes, the copy the export verbs make, and the pieces a
// library file lays down.
//
// What this module is:
// - Three doors the page hands to the pipeline, the runner and the document's
//   doors: `selectAt` answers a click with the selection change it means,
//   `copyDrawing` puts the drawing on the system clipboard, and
//   `insertLibraryPieces` lays a library file's pieces on the canvas one at a
//   time. Each is built once by the page and holds only what the page handed
//   it.
//
// What this module is not:
// - The pipeline's canvas-point reader. `selectAt` is built before the
//   pipeline exists (the pipeline is handed `selectAt`), so the point reader
//   crosses as a dependency and the page answers it with the pipeline's own.
// - The owner of the words or the history: a refusal is said on the status
//   line the page handed over, and the undo steps are the kernel's.

import { copyAsPng, copyAsSvg } from "./export.mjs";
import { pageFontSource } from "./svg-fonts.mjs";

/**
 * Whether the event carries the platform's command modifier.
 *
 * Upstream reads one flag per platform (`KEYS.CTRL_OR_CMD` is `metaKey` on a Mac and
 * `ctrlKey` elsewhere); the client cannot ask which platform it is on without a second
 * truth, so either flag is the command modifier. On Linux a Meta-click is not Cmd, but a
 * page that receives one has no better reading.
 *
 * @param {object} event the pointer event.
 * @returns {boolean}
 */
function ctrlOrMeta(event) {
    return event.ctrlKey === true || event.metaKey === true;
}

/**
 * The unit a click would select for `id`: its outermost group inside the group being
 * edited, or the element itself.
 *
 * Upstream's `getSelectableUnit` (`App.selectionTool.ts:1476-1492`). The rule lives in the
 * kernel (`selectableUnitOf`) because it reads `editingGroupId` and the innermost-first
 * group list, and a client that re-derived either would be a second truth about nesting.
 * The fallback to the id keeps a stale hit — an element the kernel no longer holds — a unit
 * of its own instead of `undefined`.
 *
 * @param {object} session
 * @param {string} id
 * @returns {string}
 */
function selectableUnitOf(session, id) {
    return session.selectableUnitOf(id) ?? id;
}

/**
 * The topmost element of the unit below the selected one, among the hits under the
 * pointer, wrapping around — or null when the click cannot cycle.
 *
 * Upstream's `getSelectionCycleTarget` (`App.selectionTool.ts:1514-1548`): the gesture
 * cycles only when exactly one selectable unit is selected and that unit is under the
 * pointer. The answer is a hit element, not a unit id, so the caller can select it through
 * its group the way a plain click does.
 *
 * While a group is being edited the cycle never leaves it: upstream filters the hits to the
 * edited group's members first (`App.selectionTool.ts:1526-1531`), so Alt-click inside a
 * group steps through the group's own units and wraps around them.
 *
 * @param {object} session
 * @param {string[]} hits topmost first, the kernel's order.
 * @returns {string|null}
 */
function cycleTarget(session, hits) {
    const selectedUnits = new Set(session.selectedIds().map((id) => selectableUnitOf(session, id)));
    if (selectedUnits.size !== 1) {
        return null;
    }
    const selected = [...selectedUnits][0];
    // Inside the edited group, only its members are units of the cycle. The kernel names
    // the group being edited, and `groupIdsOf` says whether the hit is inside it.
    const editing = session.editingGroupId();
    const pool = editing
        ? hits.filter((id) => session.groupIdsOf(id).includes(editing))
        : hits;
    // The units under the pointer, in topmost-first order, each at its topmost hit
    // element. A group is one unit however many of its members are under the pointer.
    const units = new Map();
    for (const id of pool) {
        const unit = selectableUnitOf(session, id);
        if (!units.has(unit)) {
            units.set(unit, id);
        }
    }
    const order = [...units.keys()];
    const at = order.indexOf(selected);
    if (at === -1) {
        return null;
    }
    return units.get(order[(at + 1) % order.length]);
}

/**
 * Build the click's selection change.
 *
 * @param {object} deps the surfaces the click reads.
 * @param {Function} deps.canvasPointFromEvent the pipeline's reader, answered
 *   by the page with the one the pipeline built.
 * @returns {(event: object, session: object) => boolean} whether the click changed the selection.
 */
export function createSelectAt({ canvasPointFromEvent }) {
    /** Hit-test the click and dispatch the right selection change. */
    return function selectAt(event, session) {
        const { x, y } = canvasPointFromEvent(event);
        // `hitTestAtScreen` is the kernel's screen-to-scene conversion, so the
        // client does not need to know the pan/zoom. The first hit is the
        // topmost element, which is the one a user means when they click on
        // an overlap: upstream's `hitTest` returns the same.
        const hits = session.hitTestAtScreen(x, y, 0);
        if (hits.length === 0) {
            // Click on empty space. The empty case is a no-op, not an error;
            // calling it on an already-empty selection is fine.
            if (session.selectedIds().length > 0) {
                session.clearSelection();
                return true;
            }
            return false;
        }
        const topmost = hits[0];
        // Ctrl/Cmd-click selects deep (`WF-SELECT-06`): the element itself, not the group a
        // plain click would expand it through. Upstream's branch is reached before the
        // shift rule and ignores shift (`App.selectionTool.ts:369-382`), so a
        // Ctrl+Shift-click is still the deep one. Ctrl+Alt is upstream's lasso
        // (`WF-SELECT-11`), which this port does not implement; it is left as a plain
        // click rather than turning into a deep selection nobody asked for.
        const ctrl = ctrlOrMeta(event);
        if (ctrl && event.altKey !== true) {
            // The kernel owns what deep means: the element alone, plus the group it
            // belongs to kept as the group being edited, which is the dashed box
            // upstream still draws around a one-element selection.
            session.selectDeep(topmost);
            return true;
        }
        // Alt-click cycles to the next selectable unit below the selected one
        // (`WF-SELECT-12`). It is a plain click when there is nothing to cycle from, or
        // when the selected unit is not under the pointer: the rest of the modifiers then
        // answer the click as they always did.
        if (event.altKey === true && !ctrl && event.shiftKey !== true) {
            const target = cycleTarget(session, hits);
            if (target !== null) {
                // The cycle's answer is a hit element, and the selection it makes is a
                // plain click's: the unit inside the group being edited, not necessarily
                // the whole group around it (`App.selectionTool.ts:1311-1312`).
                session.selectUnit(target);
                return true;
            }
        }
        if (event.shiftKey) {
            // Shift-click: flip a single id. A method that only added would
            // force the client to read the state, branch, and call the right
            // setter, which is three crossings for one gesture; the kernel
            // already has `toggleSelection` for exactly this case. Groups
            // do NOT expand here: shift-click is the way to add a single
            // member of a group to the selection without dragging the
            // whole thing in, and matching plain-click behaviour would
            // erase that distinction.
            session.toggleSelection(topmost);
        } else {
            // Plain click: the kernel owns what the click selects. A member of a group
            // brings its outermost group; inside the group being edited it brings the
            // member alone (or the group just inside), and the group stays the one being
            // edited. A locked or deleted element selects nothing.
            session.selectUnit(topmost);
        }
        return true;
    };
}

/**
 * Build the copy door the export verbs run through.
 *
 * @param {object} deps the surfaces the copy reads.
 * @param {object} deps.canvas the canvas whose paper the picture takes.
 * @param {object} deps.statusLine the page's failure channel.
 * @param {Function} deps.renderStatus the one place that puts the state on the screen.
 * @returns {(id: string, session: object) => Promise<void>} the door `copyPng` and `copySvg` share.
 */
export function createCopyDrawing({ canvas, statusLine, renderStatus }) {
    /**
     * Put the drawing on the system clipboard as a picture (`copyPng`) or as SVG text (`copySvg`).
     *
     * The elements and the paper are the export's own: the selection when there is one, the
     * drawing in full otherwise, on the canvas's transparent paper. The write is asynchronous,
     * so the verb returns first and the status line says what became of it; a refusal by the
     * browser is told, not thrown.
     */
    return async function copyDrawing(id, session) {
        const ids = session.selectedIds();
        const options = { ids: ids.length > 0 ? ids : null, background: null };
        try {
            const outcome =
                id === "copyPng"
                    ? { copied: await copyAsPng(session, canvas.width, canvas.height, options, pageFontSource()) }
                    : await copyAsSvg(session, options, pageFontSource());
            if (!outcome.copied) {
                statusLine.setProblem("copy failed: the browser refused the clipboard");
            } else if (outcome.fontError) {
                statusLine.setProblem(`copied without embedded fonts: ${outcome.fontError.message ?? outcome.fontError}`);
            } else {
                statusLine.clearProblem();
            }
        } catch (error) {
            statusLine.setProblem(`copy failed: ${error.message ?? error}`);
        }
        renderStatus();
    };
}

/**
 * Build the door a library file's pieces come in through.
 *
 * @param {object} deps the surfaces the pieces land on.
 * @param {object} deps.canvas the canvas whose middle a lay without a point names.
 * @param {object} deps.window the window whose pixel ratio scales the middle.
 * @param {object} deps.statusLine the page's failure channel.
 * @param {Function} deps.renderStatus the one place that puts the state on the screen.
 * @returns {(session: object, envelope: object, where?: number[] | null) => Promise<number>}
 *   how many pieces landed.
 */
export function createInsertLibraryPieces({ canvas, window, statusLine, renderStatus }) {
    /**
     * Lay a library file's pieces down on the drawing, one at a time.
     *
     * The pieces arrive in the order the file carried them, and each is centred
     * where the client says: the middle of the view, stepped down by half a view
     * for every piece before it, so three pieces read as three pieces and not as
     * one pile. Where the pieces land is the client's question; the identities,
     * the placement arithmetic inside each piece and the history are the
     * kernel's.
     *
     * @param {object} session the kernel session.
     * @param {object} envelope The library file, as the open read it.
     * @param {number[] | null} [where] The scene point to lay the first piece at; the middle of the view when absent.
     * @returns {Promise<number>} How many pieces landed.
     */
    return async function insertLibraryPieces(session, envelope, where = null) {
        const items = envelope.libraryItems ?? envelope.library ?? [];
        // Where the pieces go: the point a drop named, in scene units, or the middle of the view.
        const centre =
            where ??
            session.screenToScene(
                canvas.width / (window.devicePixelRatio || 1) / 2,
                canvas.height / (window.devicePixelRatio || 1) / 2,
            );
        let landed = 0;
        for (const [index, item] of items.entries()) {
            if (!Array.isArray(item?.elements) || item.elements.length === 0) {
                continue;
            }
            const at = {
                x: centre[0],
                y: centre[1] + index * 60,
            };
            try {
                if (item.files && Object.keys(item.files).length > 0) {
                    const destination = JSON.parse(session.toJson()).files ?? {};
                    const sourceIds = new Set(Object.keys(item.files));
                    const files = {};
                    const remapped = new Map();
                    for (const [fileId, file] of Object.entries(item.files)) {
                        let nextId = fileId;
                        if (Object.hasOwn(destination, nextId)) {
                            do {
                                nextId = crypto.randomUUID();
                            } while (Object.hasOwn(destination, nextId) || Object.hasOwn(files, nextId) || sourceIds.has(nextId));
                        }
                        remapped.set(fileId, nextId);
                        files[nextId] = file;
                    }
                    const elements = item.elements.map((element) =>
                        remapped.has(element.fileId) ? { ...element, fileId: remapped.get(element.fileId) } : element,
                    );
                    const ids = JSON.parse(session.pasteClipboard(
                        JSON.stringify({ type: "excalidraw/clipboard", elements, files }),
                        at.x,
                        at.y,
                    ));
                    session.setSelection(ids);
                    landed += 1;
                    continue;
                }
                const ids = JSON.parse(
                    session.insertLibraryItem(
                        JSON.stringify(item.elements),
                        at.x,
                        at.y,
                    ),
                );
                session.setSelection(ids);
                landed += 1;
            } catch (error) {
                statusLine.setProblem(`a piece did not land: ${error.message ?? error}`);
                renderStatus();
            }
        }
        return landed;
    };
}
