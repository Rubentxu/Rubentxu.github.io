// The eraser gesture: a stroke that marks what it crosses and removes it on release.
//
// # The four moments
//
// `start` opens the stroke in the kernel. `move` asks the kernel what the stroke has
// marked so far and returns the gesture with that answer. `commit` closes the stroke in
// the kernel, which removes what was marked in one step of history, and answers with the
// ids it removed. `preview` is the set of marked elements, which the page draws faded.
//
// # What the kernel owns
//
// The rule that decides what a stroke crosses lives in the core, because it has to agree
// with the reference to the pixel. The gesture holds only the kernel's last answer. The ink
// under the pointer is not here either: it decays with the clock, so the paint asks the
// kernel for it at the instant it draws.
//
// # What stays outside
//
// Releasing the pictures of the removed elements and repainting belong to the page. A
// cancelled pointer does not commit: it takes the marks back through `cancelGesture`, and
// ending the stroke on cancel would delete everything it marked.

import { GESTURES } from "../gesture.mjs";

/**
 * @typedef {{ x: number, y: number }} Point
 */

/**
 * Open the stroke in the kernel.
 *
 * @param {{ eraserBegin: (x: number, y: number, now: number) => void }} session
 * @param {Point} startPoint Where the pointer went down.
 * @param {number} now The clock the ink decays with.
 * @returns {object} The payload for a new gesture, without its owners.
 */
export function start(session, startPoint, now) {
    session.eraserBegin(startPoint.x, startPoint.y, now);
    return {
        kind: GESTURES.ERASER,
        startScreen: startPoint,
        currentScreen: startPoint,
        pending: new Set(),
    };
}

/**
 * The gesture with the pointer at its new place and the elements the kernel says the
 * stroke has marked. `alt` is the reference's way to take marks back.
 *
 * @param {{ eraserMove: (x: number, y: number, now: number, alt: boolean) => string }} session
 * @param {object} gesture
 * @param {Point} next
 * @param {number} now
 * @param {boolean} alt
 * @returns {object}
 */
export function move(session, gesture, next, now, alt) {
    const answer = JSON.parse(session.eraserMove(next.x, next.y, now, alt));
    return { ...gesture, currentScreen: next, pending: new Set(answer.pending) };
}

/**
 * Close the stroke. The kernel removes what was marked, as one step of history.
 *
 * @param {{ eraserEnd: () => Iterable<string> }} session
 * @returns {{ removed: string[] }} The ids the kernel removed.
 */
export function commit(session) {
    return { removed: [...session.eraserEnd()] };
}

/**
 * The marked elements the page draws faded, or `undefined` outside an erasing gesture so
 * the painter's fast path is the one that runs.
 *
 * @param {object | null} gesture
 * @returns {Set<string> | undefined}
 */
export function preview(gesture) {
    return gesture?.kind === GESTURES.ERASER ? gesture.pending : undefined;
}
