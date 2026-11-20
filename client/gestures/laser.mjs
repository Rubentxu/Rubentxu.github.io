// The laser gesture: pointing at the drawing without touching it.
//
// # The four moments
//
// `start` puts the first point of the comet down and keeps the place the pointer went
// down. `move` puts the next point down and returns the gesture with the pointer at its
// new place. `commit` has nothing to say: the gesture table says the laser commits
// nothing, and it answers `null` so a caller cannot mistake silence for a value.
// `preview` is the trail itself: the points still alive at the instant the paint asks.
//
// # Why the trail is injected and the kernel is not
//
// The laser never reaches the document, so there is no session to hand it. What it acts
// on is the trail (`client/laser.mjs`), which lives beside the gesture and not inside it:
// the fade runs on the clock, so lifting the hand does not switch the laser off, it only
// stops feeding it. The gesture dies with the pointer; the trail outlives it by up to a
// second.
//
// # Why the preview keeps nothing
//
// The points decay with the clock, so a copy held between frames would draw a moment that
// has already gone. `preview` asks the trail at the instant it is given and returns what
// the trail answers.
//
// The points are screen pixels: the space the pointer reports and the space the paint
// draws in. Panning under a fading trail moves the drawing and not the trail.

import { GESTURES } from "../gesture.mjs";

/**
 * @typedef {{ x: number, y: number }} Point
 * @typedef {{ add: (x: number, y: number, nowMs: number) => void, points: (nowMs: number) => Array<{ x: number, y: number, at: number }> }} Trail
 */

/**
 * The gesture a laser begins, with the first point of the trail already down.
 *
 * @param {Trail} trail
 * @param {Point} at Where the pointer went down.
 * @param {number} now The clock, in milliseconds.
 * @returns {object} The payload for a new gesture, without its owners.
 */
export function start(trail, at, now) {
    trail.add(at.x, at.y, now);
    return { kind: GESTURES.LASER, startScreen: at, currentScreen: at };
}

/**
 * Put the pointer's new place on the trail, and return the gesture with the pointer there.
 * The one it was given is left alone.
 *
 * @param {Trail} trail
 * @param {object} gesture
 * @param {Point} next
 * @param {number} now The clock, in milliseconds.
 * @returns {object}
 */
export function move(trail, gesture, next, now) {
    trail.add(next.x, next.y, now);
    return { ...gesture, currentScreen: next };
}

/** A laser writes nothing to the document: there is no commit. */
export function commit(_gesture) {
    return null;
}

/**
 * The points of the trail that are still alive at `now`, oldest first.
 *
 * @param {Trail} trail
 * @param {number} now The clock, in milliseconds.
 */
export function preview(trail, now) {
    return trail.points(now);
}
