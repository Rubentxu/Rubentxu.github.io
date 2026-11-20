// One frame of a pinch, applied to the kernel.
//
// # Why this is its own module
//
// The pinch is two halves: the arithmetic (`client/pinch.mjs`) and the order in
// which that arithmetic meets the kernel. The order is the whole trick — the
// level changes first, the scene under the fingers is read *after* it, and the
// pan is computed from that reading — and an order that lives inside a pointer
// handler is an order nobody can test against the real kernel.
//
// So the order lives here, and the page and both suites call it. Otherwise the
// page could scale about one point while a suite proved another point works,
// and both would be right.
//
// # What it does not do
//
// It does not know what a finger is, and it does not draw. It takes the points
// and the state the gesture started from, and it leaves everything but the view
// as it found it.

import { pinchCentre, pinchPan, pinchZoom } from "./pinch.mjs";

/**
 * One frame of a pinch: the level changes and the anchor is put back under the
 * fingers.
 *
 * The order is the whole of the trick, and it is the order `client/pinch.mjs`
 * documents: the zoom first, then the scene under the fingers read at the new
 * scale, then the pan that puts the anchor back under them. Reading the scene
 * before the zoom would ask the kernel a question about the old scale and
 * answer it with the new one.
 *
 * @param {Session} session the kernel.
 * @param {{spread: number, zoom: number, anchor: {x: number, y: number}}} start
 *        the state the gesture started from.
 * @param {{x: number, y: number}[]} points the fingers now, in canvas pixels.
 */
export function pinchFrame(session, start, points) {
    session.setZoom(pinchZoom(start, points));
    // The kernel clamps the zoom to what a viewport accepts, so the pan is
    // computed from the zoom the kernel has, not from the one that was asked for.
    const zoom = session.zoom();
    const centre = pinchCentre(points);
    const under = session.screenToScene(centre.x, centre.y);
    const { dx, dy } = pinchPan(start, zoom, { x: under[0], y: under[1] });
    session.pan(dx, dy);
}
