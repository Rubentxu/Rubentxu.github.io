// The pan gesture: dragging the view itself.
//
// # The four moments
//
// `start` keeps the place the pointer went down. `move` feeds the pointer's own travel
// into the kernel's scroll on the spot and returns the gesture with the pointer at its new
// place. `commit` and `preview` have nothing to say: the gesture table says a pan neither
// commits nor previews, and both answer `null` so a caller cannot mistake silence for a
// value.
//
// # Why the move acts
//
// A view that does not move under the hand while the hand is moving is not a pan. The
// scroll is applied on every move rather than gathered and applied on release, and it is
// applied by the delta since the last event rather than since the press: a pointer capture
// can deliver a move for a coordinate the pointer already passed through, and summing from
// the start would count it twice. The delta is in CSS pixels and is not scaled here; the
// kernel divides by the zoom, because the scroll lives in scene units.

import { GESTURES, panBy } from "../gesture.mjs";

/**
 * @typedef {{ x: number, y: number }} Point
 */

/**
 * The gesture a pan begins.
 *
 * @param {Point} at Where the pointer went down.
 * @returns {object} The payload for a new gesture, without its owners.
 */
export function start(at) {
    return { kind: GESTURES.PAN, startScreen: at, currentScreen: at };
}

/**
 * Move the view by the pointer's travel since the last event, and return the gesture with
 * the pointer at its new place. The one it was given is left alone.
 *
 * @param {{ pan: (dx: number, dy: number) => void }} session
 * @param {object} gesture
 * @param {Point} next
 * @returns {object}
 */
export function move(session, gesture, next) {
    const delta = panBy(gesture, next);
    if (delta !== null) {
        session.pan(delta.x, delta.y);
    }
    return { ...gesture, currentScreen: next };
}

/** A pan writes nothing to the document: there is no commit. */
export function commit(_gesture) {
    return null;
}

/** A pan paints nothing of its own: the view is the preview. */
export function preview(_gesture) {
    return null;
}
