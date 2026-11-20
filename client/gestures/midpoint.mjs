// The midpoint gesture: dragging the midpoint of a segment of a line or an arrow.
//
// # What it is
//
// A midpoint is the place a vertex is **added**: the gesture puts a new point under the
// pointer and drags it, and the segment it belongs to is what the midpoint names.
//
// # The four moments
//
// `start` opens the insertion the kernel holds for the whole gesture, so the add and the
// drag are one undo step. The vertex is not added yet: upstream adds it when the pointer
// has moved far enough for the gesture to be a drag
// (`packages/element/src/linearElementEditor.ts:1757-1777`), so a click on a midpoint
// adds nothing. `move` measures that travel and, once the pointer is past it, puts the
// vertex under the pointer (`packages/element/src/linearElementEditor.ts:1811-1823`) and
// keeps it there. `commit` closes the capture; a midpoint that was clicked and not
// dragged closes with the scene as it was and leaves the history alone. `preview` names
// the new vertex, but only from the moment it exists.
//
// Nothing here catches: a refusal from the kernel is the pipeline's to report. A move the
// kernel refuses does not count as an add, so the next move tries again.

import { GESTURES } from "../gesture.mjs";

/**
 * How far the pointer has to travel, in screen pixels, before a midpoint grows a vertex.
 *
 * Ten pixels is upstream's own `DRAGGING_THRESHOLD`
 * (`packages/common/src/constants.ts:31`), not the three pixels of a plain drag: a click
 * on a midpoint has to add nothing at all, and the point of the threshold is to tell a
 * click from a drag. It is measured in the space the pointer is in.
 */
export const MIDPOINT_DRAG_THRESHOLD = 10;

/**
 * Open the insertion at a midpoint and return the gesture it begins.
 *
 * @param {{ vertexInsertBegin: Function }} session
 * @param {string} id The line or arrow being edited.
 * @param {{ index: number }} hit The midpoint under the pointer; its index is the segment's.
 * @param {{ x: number, y: number }} startScreen Where the pointer went down.
 * @returns {object} The payload for a new gesture, without its owners.
 */
export function start(session, id, hit, startScreen) {
    session.vertexInsertBegin(id, hit.index);
    return {
        kind: GESTURES.MIDPOINT,
        id,
        segment: hit.index,
        // The index the new vertex takes: the one the segment's second point had, which
        // is the one after it.
        index: hit.index + 1,
        added: false,
        startScreen,
        currentScreen: startScreen,
    };
}

/**
 * Return the gesture with the pointer's new place, putting the vertex under the pointer
 * once the travel is a drag and not a click.
 *
 * @param {{ screenToScene: Function, vertexInsertMove: Function }} session
 * @param {{ added: boolean, startScreen: { x: number, y: number } }} gesture
 * @param {{ x: number, y: number }} next
 * @param {number} [threshold] Screen pixels of travel that make a drag.
 * @returns {object}
 */
export function move(session, gesture, next, threshold = MIDPOINT_DRAG_THRESHOLD) {
    const travelled = Math.hypot(next.x - gesture.startScreen.x, next.y - gesture.startScreen.y);
    if (!gesture.added && travelled < threshold) {
        return { ...gesture, currentScreen: next };
    }
    const scene = session.screenToScene(next.x, next.y);
    session.vertexInsertMove(scene[0], scene[1]);
    return { ...gesture, added: true, currentScreen: next };
}

/**
 * Close the gesture. The drawing is already where the pointer left it.
 *
 * @param {{ editDragEnd: Function }} session
 */
export function commit(session) {
    session.editDragEnd();
}

/**
 * The vertex the chrome marks while the gesture lives. Before the vertex exists the
 * record is still the dragged one, and nothing is marked.
 *
 * @param {{ id: string, added: boolean, index: number }} gesture
 * @param {{ id: string }} record One element's chrome.
 * @returns {{ kind: string, index: number | null } | null}
 */
export function preview(gesture, record) {
    if (record?.id !== gesture.id) {
        return null;
    }
    return { kind: GESTURES.MIDPOINT, index: gesture.added ? gesture.index : null };
}
