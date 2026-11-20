// The translate gesture: dragging chosen elements across the canvas.
//
// # What it is
//
// A press on an element, or on the body of a multi-selection, followed by a drag moves
// everything the drag targets. The targets are a set, because the page asks "does this
// record move with the drag?" once per record on every pointermove.
//
// # The four moments
//
// `start` keeps the two pointer positions, the element that was grabbed and the targets.
// `move` returns the gesture with the pointer at its new place. `commit` hands the kernel
// the two screen positions and the targets in one call, so the whole drag is one step of
// history and the kernel measures the travel itself: the zoom is the only part of the view
// that scales a difference, and a client dividing by a zoom of its own would hold a second
// truth about where the scene is. `preview` asks the kernel what the release would keep, with
// the same arguments (`crossing`), so the moved elements are painted where they will land.
//
// # The two modifiers
//
// Shift locks the drag to one axis, as upstream reads it on every move
// (`App.selectionTool.ts`: the smaller of the two travels is zeroed). The lock is
// applied to the travel, not to a stored point, so letting Shift go frees the drag
// again on the next move and the release commits the same raw pointer position.
//
// Alt duplicates. Upstream duplicates the selection on the first move that sees Alt
// and keeps dragging the copies, and the whole alt-drag is one step of history
// (`App.duplicate.ts`, `duplicateDraggedSelection`; `regressionTests.test.tsx`,
// "alt-drag duplicates an element"). The duplicate is therefore latched for the rest
// of the gesture and handed to the kernel as one action — copy and travel together —
// so one undo takes the copies away and leaves the originals where they were. The
// kernel snaps the travel the same way it snaps a plain drag.
//
// # What stays outside
//
// Whether the pointer moved far enough to be a drag, and the click that follows when it
// did not, belong to the pipeline. The snap to the grid is the kernel's: the preview and
// the commit apply the same plan, and the page only draws the guides the plan locked onto.
// Nothing here catches: a refusal is the pipeline's to report.

import { GESTURES } from "../gesture.mjs";

/**
 * @typedef {{ x: number, y: number }} Point
 */

/**
 * The gesture a press on a draggable element begins.
 *
 * @param {Point} startScreen Where the pointer went down.
 * @param {string | null} hitId The element under the pointer, or the first chosen one for
 *   the body of a multi-selection.
 * @param {Set<string>} targets Every element the drag moves.
 * @returns {object} The payload for a new gesture, without its owners.
 */
export function start(startScreen, hitId, targets) {
    return {
        kind: GESTURES.TRANSLATE,
        startScreen,
        currentScreen: startScreen,
        hitId,
        targets,
        // The axis lock is read on every move and never latched: it belongs to the
        // pointer's current state, not to the gesture's history.
        axisLocked: false,
        // The duplicate is latched: upstream copies on the first move that sees Alt
        // and the copy stays even if Alt is let go before the release.
        duplicate: false,
    };
}

/**
 * The gesture with the pointer at its new place. The start never moves.
 *
 * The modifiers are the ones the move arrived with. Shift is read on every move,
 * as upstream reads it: it is a fact about the drag right now, so a move without
 * it frees the axis again. Alt is latched because the duplication it starts is a
 * fact about the document, and letting the key go does not put the copy back.
 *
 * @param {object} gesture
 * @param {Point} next
 * @param {{ shift?: boolean, alt?: boolean }} [modifiers] what the pointer held.
 * @returns {object}
 */
export function move(gesture, next, modifiers = {}) {
    return {
        ...gesture,
        currentScreen: next,
        axisLocked: modifiers.shift === true,
        duplicate: gesture.duplicate === true || modifiers.alt === true,
    };
}

/**
 * What the kernel is handed for this drag: the targets and the two screen positions.
 *
 * The release and the preview hand over this one list, so the scene a preview shows is
 * the scene the release keeps: the kernel measures the travel, snaps it and applies it
 * the same way for both.
 *
 * @param {{ targets: Set<string>, startScreen: Point, currentScreen: Point }} gesture
 * @returns {[string[], number, number, number, number]}
 */
export function crossing(gesture) {
    // The frontier takes a list and the gesture holds a set: it is opened here, once, at
    // the one crossing that needs an order.
    const { startScreen, currentScreen } = gesture;
    let toX = currentScreen.x;
    let toY = currentScreen.y;
    if (gesture.axisLocked === true) {
        // Upstream zeroes the smaller travel, and only the smaller: a tie keeps both
        // components (`lockX = distanceX < distanceY`, `lockY = distanceX > distanceY`).
        const travelX = Math.abs(toX - startScreen.x);
        const travelY = Math.abs(toY - startScreen.y);
        if (travelX > travelY) {
            toY = startScreen.y;
        } else if (travelY > travelX) {
            toX = startScreen.x;
        }
    }
    return [[...gesture.targets], startScreen.x, startScreen.y, toX, toY];
}

/**
 * Move every target by the drag, as one step of history.
 *
 * With Alt held the drag is a copy-and-move instead: the originals stay where the
 * gesture found them, the copies land at the travel, and the kernel records the
 * two as one step. The copies become the selection, as upstream's do, so a second
 * gesture on what the user is looking at moves it.
 *
 * @param {{ translateBy: Function, duplicateTranslateBy?: Function, setSelection?: Function }} session
 * @param {{ targets: Set<string>, startScreen: Point, currentScreen: Point }} gesture
 */
export function commit(session, gesture) {
    if (gesture.duplicate === true) {
        const copies = session.duplicateTranslateBy(...crossing(gesture));
        if (copies.length > 0) {
            session.setSelection(copies);
        }
        return;
    }
    session.translateBy(...crossing(gesture));
}

/**
 * What the drag would show if the pointer were released now, as the kernel's preview
 * packet. The document does not change.
 *
 * @param {{ previewTranslateBy: Function }} session
 * @param {{ targets: Set<string>, startScreen: Point, currentScreen: Point }} gesture
 * @returns {Uint8Array}
 */
export function preview(session, gesture) {
    return session.previewTranslateBy(...crossing(gesture));
}
