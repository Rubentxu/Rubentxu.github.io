// The history, as the page moves it.
//
// The kernel owns the history; this module owns the one thing the page has
// to do around a step of it that is not "ask the kernel" — and that thing is
// easy to forget, because nothing about it looks like a step of the
// history.
//
// # The pictures the history takes away
//
// An undo swaps whole scenes: no element was deleted, so no id was reported
// to anybody, and the picture cache kept every picture of the elements the
// scene no longer holds. The bytes are memory for pictures nobody can see,
// and the kernel lets an id be inserted again, so an entry that outlived
// its element would paint the old picture under the new one.
//
// The deletion paths do not have this problem: they know the ids they
// deleted and release them one by one (`forgetImageFor`). The history does
// not, so it asks — "which elements are still here?" is the kernel's
// answer — and the client releases the difference.
//
// # Two callers, one step
//
// The keyboard and the toolbar move the history the same way, and they have
// to: a click that undid something the keyboard's undo would not, or a
// keyboard that undid something the toolbar's would not, would be two
// histories wearing one coat. The toolbar's own module says so ("the
// guarantee worth protecting is that the button and the keyboard share ONE
// history"), and this is where that sharing is made literal.

import { imageCacheStats, releaseGonePictures } from "./paint.mjs";

/**
 * Move the history one step, and release what the scene no longer holds.
 *
 * The answer is the kernel's: `true` when the scene moved, `false` when the
 * history had nothing to give. A `false` means nothing was released either
 * — the scene did not move, so nothing left it.
 *
 * @param {{ undo(): boolean, redo(): boolean, sceneIds(): string[] }} session
 * @param {"undo"|"redo"} act which way to move.
 * @returns {boolean} whether the scene moved.
 */
export function stepHistory(session, act) {
    const changed = session[act]();
    // The cache is empty unless the drawing carries pictures, and asking the
    // kernel for the scene's ids is only worth it when there is something to
    // release.
    if (changed && imageCacheStats().ids > 0) {
        releaseGonePictures(session.sceneIds());
    }
    return changed;
}
