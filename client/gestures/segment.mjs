// The segment gesture: dragging the handle of a segment of a turning arrow.
//
// # What it is
//
// The drag pins the segment where the pointer takes it and the kernel builds the chain
// around it (the rule is the kernel's). The client says which segment and where the
// pointer is; the drawing it sees while the pointer is down is the drawing the document
// holds, not a ghost of it.
//
// # The four moments
//
// `start` opens the capture the kernel holds for the whole drag, so the gesture is one
// undo step however many pointermoves it takes. `move` carries the segment to the
// pointer. `commit` closes the capture; a handle that was clicked and not dragged closes
// with the scene as it was and leaves the history alone. `preview` names the handle the
// hand is on, the one thing the drawing cannot say.
//
// Nothing here catches: a refusal from the kernel is the pipeline's to report.

import { GESTURES } from "../gesture.mjs";

/**
 * Open the drag of a segment and return the gesture it begins.
 *
 * @param {{ fixedSegmentDragBegin: Function }} session
 * @param {string} id The arrow being edited.
 * @param {{ index: number }} hit The segment handle under the pointer.
 * @param {{ x: number, y: number }} startScreen Where the pointer went down.
 * @returns {object} The payload for a new gesture, without its owners.
 */
export function start(session, id, hit, startScreen) {
    session.fixedSegmentDragBegin(id, hit.index);
    return {
        kind: GESTURES.SEGMENT,
        id,
        segment: hit.index,
        startScreen,
        currentScreen: startScreen,
    };
}

/**
 * Carry the segment to the pointer and return the gesture with its new place.
 *
 * @param {{ screenToScene: Function, fixedSegmentDragMove: Function }} session
 * @param {object} gesture
 * @param {{ x: number, y: number }} next
 * @returns {object}
 */
export function move(session, gesture, next) {
    const scene = session.screenToScene(next.x, next.y);
    session.fixedSegmentDragMove(scene[0], scene[1]);
    return { ...gesture, currentScreen: next };
}

/**
 * Close the drag. The drawing is already where the pointer left it.
 *
 * @param {{ editDragEnd: Function }} session
 */
export function commit(session) {
    session.editDragEnd();
}

/**
 * The handle the chrome marks while the drag lives, or `null` for any other record.
 *
 * @param {{ id: string, segment: number }} gesture
 * @param {{ id: string }} record One element's chrome.
 * @returns {{ kind: string, index: number } | null}
 */
export function preview(gesture, record) {
    if (record?.id !== gesture.id) {
        return null;
    }
    return { kind: GESTURES.SEGMENT, index: gesture.segment };
}
