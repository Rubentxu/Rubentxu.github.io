// The crop gesture: the drag that chooses which part of a picture an image shows.
//
// # What it is
//
// In the crop mode a drag anywhere names a region of the bitmap. The rectangle is clipped
// to the image's own box, so a press that starts off the picture still ends inside it, and
// the region is written once, when the pointer is released. Nothing in the document moves
// while the pointer is down.
//
// # The four moments
//
// `start` keeps the image, its box and where the pointer went down. `move` returns the
// gesture with the pointer at its new place. `commit` asks the kernel what the image
// already shows, maps the drag into that region and writes it with `setCrop`, so the
// change is one step of history. `preview` is the rectangle the page paints as the ghost.
//
// The ghost and the region come from the same drag: `rectOf` is the clipped rectangle in
// screen pixels, and `commit` hands the same two corners to `cropFromDrag`, so the page
// cannot promise a rectangle the commit does not keep.
//
// # What stays outside
//
// Leaving the mode, the cursor, the repaint and the status line belong to the pipeline.
// `commit` says what happened — `tap`, `unavailable` or `written` — and a refusal from the
// kernel is thrown for the pipeline to report. The size of a bitmap nobody has cropped yet
// is the decoder's knowledge, so it comes in as `naturalSize`.

import { GESTURES } from "../gesture.mjs";
import { clipToBox, cropFromDrag } from "../crop-region.mjs";

/** How far a release must be from the press to count as a drag, in screen pixels. */
export const DEFAULT_THRESHOLD = 3;

/**
 * @typedef {{ x: number, y: number }} Point
 * @typedef {{ left: number, top: number, right: number, bottom: number }} SceneBox
 */

/**
 * The gesture a press in the crop mode begins.
 *
 * @param {string} id The image being cropped.
 * @param {SceneBox} box The image's box in scene units, as the kernel publishes it.
 * @param {Point} startScreen Where the pointer went down.
 * @returns {object} The payload for a new gesture, without its owners.
 */
export function start(id, box, startScreen) {
    return { kind: GESTURES.CROP, id, box, startScreen, currentScreen: startScreen };
}

/**
 * The gesture with the pointer at its new place. The start never moves.
 *
 * @param {object} gesture
 * @param {Point} next
 * @returns {object}
 */
export function move(gesture, next) {
    return { ...gesture, currentScreen: next };
}

/**
 * The drag's rectangle clipped to the image's box, in the screen pixels the ghost is
 * painted in.
 *
 * The geometry is decided in scene units, where the box lives and where the region is
 * measured; clipping in screen space would agree at one zoom and drift at another.
 *
 * @param {{ screenToScene: Function, sceneToScreen: Function }} session
 * @param {{ startScreen: Point, currentScreen: Point, box: SceneBox }} gesture
 * @returns {{ x: number, y: number, width: number, height: number }}
 */
export function rectOf(session, gesture) {
    const a = session.screenToScene(gesture.startScreen.x, gesture.startScreen.y);
    const b = session.screenToScene(gesture.currentScreen.x, gesture.currentScreen.y);
    const clipped = clipToBox(gesture.box, { x: a[0], y: a[1] }, { x: b[0], y: b[1] });
    const tl = session.sceneToScreen(clipped.left, clipped.top);
    const br = session.sceneToScreen(clipped.right, clipped.bottom);
    return { x: tl[0], y: tl[1], width: br[0] - tl[0], height: br[1] - tl[1] };
}

/** The kernel's answer about an image's crop, or `null` when it is not an image. */
function cropAnswer(session, id) {
    try {
        return JSON.parse(session.cropOf(id));
    } catch {
        return null;
    }
}

/**
 * The region of the bitmap the image's box shows now: the stored crop, or the whole
 * bitmap when nothing is stored yet. `null` when neither is known.
 */
function shownSpan(session, id, naturalSize) {
    const answer = cropAnswer(session, id);
    if (answer === null) {
        return null;
    }
    if (answer.cropped) {
        return answer.region;
    }
    const natural = naturalSize(id);
    if (natural === null) {
        return null;
    }
    return {
        x: 0,
        y: 0,
        width: natural.width,
        height: natural.height,
        naturalWidth: natural.width,
        naturalHeight: natural.height,
    };
}

/**
 * Write the region the drag chose.
 *
 * @param {{ cropOf: Function, screenToScene: Function, setCrop: Function }} session
 * @param {object} gesture
 * @param {Point} release Where the pointer came up.
 * @param {{ naturalSize: (id: string) => ({ width: number, height: number } | null), threshold?: number }} deps
 * @returns {"tap" | "unavailable" | "written"} A release closer than the threshold to the
 *   press is a `tap` and writes nothing; an image with no known bitmap to map into is
 *   `unavailable`.
 */
export function commit(session, gesture, release, { naturalSize, threshold = DEFAULT_THRESHOLD }) {
    const travelled = Math.hypot(
        release.x - gesture.startScreen.x,
        release.y - gesture.startScreen.y,
    );
    if (travelled < threshold) {
        return "tap";
    }
    const span = shownSpan(session, gesture.id, naturalSize);
    if (span === null) {
        return "unavailable";
    }
    const a = session.screenToScene(gesture.startScreen.x, gesture.startScreen.y);
    const b = session.screenToScene(release.x, release.y);
    const { region } = cropFromDrag(
        gesture.box,
        { x: a[0], y: a[1] },
        { x: b[0], y: b[1] },
        span,
    );
    session.setCrop(gesture.id, JSON.stringify(region));
    return "written";
}

/**
 * The ghost rectangle the page paints while the gesture lives.
 *
 * @param {object} session
 * @param {object | null} gesture
 * @returns {{ x: number, y: number, width: number, height: number } | null}
 */
export function preview(session, gesture) {
    if (gesture?.kind !== GESTURES.CROP) {
        return null;
    }
    return rectOf(session, gesture);
}
