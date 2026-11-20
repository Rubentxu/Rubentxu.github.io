// The rotate gesture: one strategy with its four moments, for one element
// and for a whole selection.
//
// # What it is
//
// A turn begins on the rotate handle of a lone selected element — or on the
// dot above a multi-selection's common box — follows the pointer, and on
// release hands the kernel where the pointer is and whether Shift was held on
// the last move. The kernel turns the element to the angle the pointer names
// about its centre, upstream's `rotateSingleElement` and
// `rotateMultipleElements`; nothing here computes an angle or a centre. The
// angle does not depend on where the press was, so a press that never moves
// turns nothing: upstream rotates on a pointer move only. While it lives,
// `preview` asks the kernel for the turned elements with the same arguments
// (`crossing`), so the picture is the release's own. The id tells the doors
// apart: a turn with an id goes to the lone element's door, and a turn
// without one goes to the selection's door, where the kernel resolves the set
// itself.
//
// # Why a module
//
// The four moments used to live in four places of two files, joined only by the kind
// word. Here they are one value, pure and injectable: no moment touches the page, and
// the only thing the commit needs from outside is the session it is given.

import { GESTURES } from "../gesture.mjs";

/**
 * The gesture a press on a rotate handle begins, or `null` when the press is not one.
 *
 * @param {{ kind?: string }} hit What the kernel found under the pointer.
 * @param {string | undefined} id The lone selected element, or `undefined` for the
 *   selection's own dot — the multi-selection's turn names no element.
 * @param {{ x: number, y: number }} startScreen Where the pointer went down.
 * @returns {object | null} The payload for a new gesture, without its owners.
 */
export function start(hit, id, startScreen) {
    if (hit?.kind !== "rotate") {
        return null;
    }
    return {
        kind: GESTURES.ROTATE,
        id,
        startScreen,
        currentScreen: startScreen,
        discrete: false,
        moved: false,
    };
}

/**
 * The gesture with the pointer at its new place, and Shift as this move found it:
 * upstream reads `event.shiftKey` on every pointer move.
 *
 * @param {object} gesture
 * @param {{ x: number, y: number }} next
 * @param {boolean} [discrete] Whether Shift is held, which locks the angle to 15°.
 * @returns {object}
 */
export function move(gesture, next, discrete = false) {
    return { ...gesture, currentScreen: next, discrete: discrete === true, moved: true };
}

/**
 * What the kernel is handed for this turn: where the pointer is and whether Shift
 * locks the angle, with the id in front when the turn is a lone element's.
 *
 * The release and the preview hand over this one list, so the turn a preview shows is
 * the turn the release keeps.
 *
 * @param {object} gesture
 * @returns {Array<string | number | boolean>}
 */
export function crossing(gesture) {
    const turn = [gesture.currentScreen.x, gesture.currentScreen.y, gesture.discrete];
    return gesture.id !== undefined ? [gesture.id, ...turn] : turn;
}

/**
 * Hand the kernel the turn, unless the pointer never moved: the angle is the
 * pointer's, not a turn since the press, so a click on the handle would set one.
 * The id tells the doors apart: with one, the lone element's door; without one, the
 * selection's door, where the kernel resolves the set.
 *
 * @param {{ rotateBy: Function, rotateAll: Function }} session
 * @param {object} gesture
 */
export function commit(session, gesture) {
    if (!gesture.moved) {
        return;
    }
    if (gesture.id !== undefined) {
        session.rotateBy(...crossing(gesture));
        return;
    }
    session.rotateAll(...crossing(gesture));
}

/**
 * What the turn would show if the pointer were released now, as the kernel's preview
 * packet, or `null` before the pointer moves, when the release would keep the
 * committed scene. The document does not change.
 *
 * @param {{ previewRotateBy: Function, previewRotateAll: Function }} session
 * @param {object} gesture
 * @returns {Uint8Array | null}
 */
export function preview(session, gesture) {
    if (!gesture.moved) {
        return null;
    }
    if (gesture.id !== undefined) {
        return session.previewRotateBy(...crossing(gesture));
    }
    return session.previewRotateAll(...crossing(gesture));
}
