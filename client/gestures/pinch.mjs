// The pinch gesture: two fingers scaling and moving the view.
//
// # The four moments
//
// `start` keeps the state the pinch began from: the fingers' middle, their spread, the
// zoom and the scene under the middle. `move` applies one frame to the session it is given
// and returns the gesture with the fingers where they are now. `commit` and `preview` have
// nothing to say: the gesture table says a pinch neither commits nor previews, and both
// answer `null` so a caller cannot mistake silence for a value.
//
// # What stays outside
//
// The arithmetic is `client/pinch.mjs` and the order in which it meets the kernel is
// `client/pinch-frame.mjs`; this module calls the second and does not repeat either. The
// fingers on the glass are not here either: the pipeline counts them because the admission
// of a pointer, the captures and the end of the gesture all read the same count. The gesture
// carries who owns it and where it started from, and the pipeline passes the fingers in.

import { GESTURES } from "../gesture.mjs";
import { pinchStart } from "../pinch.mjs";
import { pinchFrame } from "../pinch-frame.mjs";

/**
 * @typedef {{ x: number, y: number }} Point
 */

/**
 * The gesture a pinch begins.
 *
 * @param {Point[]} points The fingers now, in canvas pixels.
 * @param {number} zoom The zoom at the start.
 * @param {Point} anchor The scene under the middle of the fingers, in scene units.
 * @returns {object} The payload for a new gesture, without its owners.
 */
export function start(points, zoom, anchor) {
    return { kind: GESTURES.PINCH, start: pinchStart(points, zoom, anchor) };
}

/**
 * Apply one frame of the pinch to the view, and return the gesture with the fingers where
 * they are. The one it was given is left alone. Fewer than two fingers measure nothing, so
 * the kernel is not asked and the same gesture comes back.
 *
 * @param {object} session
 * @param {object} gesture
 * @param {Point[]} points The fingers now, in canvas pixels.
 * @returns {object}
 */
export function move(session, gesture, points) {
    if (points.length < 2) {
        return gesture;
    }
    pinchFrame(session, gesture.start, points);
    return { ...gesture, current: points };
}

/** A pinch writes nothing to the document: there is no commit. */
export function commit(_gesture) {
    return null;
}

/** A pinch paints nothing of its own: the view is the preview. */
export function preview(_gesture) {
    return null;
}
