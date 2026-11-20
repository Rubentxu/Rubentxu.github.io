// The resize gesture: dragging a handle of the selection's box.
//
// # The four moments
//
// `start` keeps the handle that was taken, the two pointer positions and the box the drag
// begins from, in the screen pixels the chrome is drawn in. `move` returns the gesture with
// the pointer at its new place. `commit` hands the kernel the handle, the box and the
// pointer's travel in one call, so the whole drag is one step of history. `preview` asks
// the kernel what the release would keep, with the same arguments (`crossing`), so the
// resized elements are painted at the size they will land at.
//
// # What the kernel owns
//
// Which edge a handle drags, the scale a group takes and the refusal of a box with no area
// are the kernel's. The gesture holds no copy of those rules. The floor under which the
// client will not shrink a box is a number a person chose, so it comes in as a parameter
// and stays declared where the pipeline declares it.
//
// # What stays outside
//
// Repainting and reporting a refusal belong to the caller: nothing here catches.

import { GESTURES } from "../gesture.mjs";

/**
 * @typedef {{ x: number, y: number }} Point
 * @typedef {{ left: number, top: number, right: number, bottom: number }} Box
 */

/**
 * The gesture a press on a handle begins.
 *
 * @param {string} handle The handle the press took.
 * @param {Point} startScreen Where the pointer went down.
 * @param {Box} startBox The box the handle belongs to, on the screen.
 * @param {{ id: string } | { targets: Set<string> }} owner One element, or the group.
 * @returns {object} The payload for a new gesture, without its owners.
 */
export function start(handle, startScreen, startBox, owner) {
    return {
        kind: GESTURES.RESIZE,
        handle,
        ...owner,
        startScreen,
        currentScreen: startScreen,
        startBox: { ...startBox },
    };
}

/**
 * The gesture with the pointer at its new place. The one it was given is left alone.
 *
 * @param {object} gesture
 * @param {Point} next
 * @returns {object}
 */
export function move(gesture, next) {
    return { ...gesture, currentScreen: next };
}

/**
 * What the kernel is handed for this drag: the ids, the handle, the box the drag began
 * from, the pointer's travel since the press and the floor.
 *
 * A lone element and a group are one door: the kernel reads from the number of ids which
 * rule applies. The release and the preview hand over this one list, so the box a preview
 * shows is the box the release keeps.
 *
 * @param {object} gesture
 * @param {number} minSize The floor, in screen pixels, a box may not go below.
 * @returns {[string[], string, number, number, number, number, number, number, number]}
 */
export function crossing(gesture, minSize) {
    const ids = gesture.targets ? [...gesture.targets] : [gesture.id];
    return [
        ids,
        gesture.handle,
        gesture.startBox.left,
        gesture.startBox.top,
        gesture.startBox.right,
        gesture.startBox.bottom,
        gesture.currentScreen.x - gesture.startScreen.x,
        gesture.currentScreen.y - gesture.startScreen.y,
        minSize,
    ];
}

/**
 * Resize what the gesture holds, once.
 *
 * @param {{ resizeBy: Function }} session
 * @param {object} gesture
 * @param {number} minSize The floor, in screen pixels, a box may not go below.
 */
export function commit(session, gesture, minSize) {
    session.resizeBy(...crossing(gesture, minSize));
}

/**
 * What the drag would show if the pointer were released now, as the kernel's preview
 * packet. The document does not change.
 *
 * @param {{ previewResizeBy: Function }} session
 * @param {object} gesture
 * @param {number} minSize
 * @returns {Uint8Array}
 */
export function preview(session, gesture, minSize) {
    return session.previewResizeBy(...crossing(gesture, minSize));
}
