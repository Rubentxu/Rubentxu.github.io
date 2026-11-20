// The live picture of a transform: what a drag, a resize or a turn would leave on the
// canvas if the pointer were released now.
//
// # Where the picture comes from
//
// The kernel answers it. The gesture hands the preview door the arguments its release will
// hand the commit door, and the kernel applies the same action to a copy of the scene, so
// the elements shown under the pointer are the elements the release keeps: the snap, the
// floor of a box, the arrows that follow a moved shape and the pivot of a turn are one
// rule, written once, on the kernel's side. Nothing here computes a position.
//
// # Three layers
//
// A move changes a few elements, and on a large board most of the scene is untouched. The
// answer says where the change sits in the stacking order: the committed scene's marks in
// `0..base` paint under it, the ones in `ceiling..` paint over it, and only the band in
// between crosses the frontier on every pointermove. The two outer runs are asked once per
// gesture (`frameRange`) and kept while the committed frame and the marks stay the same, so
// the layer under the change can sit in the static cache like any committed frame.
//
// # What stays outside
//
// Painting, and reporting a refusal: a preview the kernel refuses throws here with the
// kernel's words, which are the words its release would get.

import { GESTURES } from "./gesture.mjs";
import { decodeFrame } from "./wire.mjs";
import * as resizeGesture from "./gestures/resize.mjs";
import * as rotateGesture from "./gestures/rotate.mjs";
import * as translateGesture from "./gestures/translate.mjs";

/** The header of a preview whose release would paint what the committed scene does. */
export const PREVIEW_UNCHANGED = 0xffffffff;

/**
 * The preview packet of the gesture in flight, or `null` when the gesture is not a
 * transform the kernel previews.
 *
 * @param {object} session
 * @param {object | null} gesture
 * @param {number} minSize The resize floor, in screen pixels.
 * @returns {Uint8Array | null}
 */
function ask(session, gesture, minSize) {
    switch (gesture?.kind) {
        case GESTURES.TRANSLATE:
            // A press that grabbed nothing draggable holds no targets: there is nothing to
            // move, so there is nothing to show.
            return gesture.targets?.size > 0 ? translateGesture.preview(session, gesture) : null;
        case GESTURES.RESIZE:
            return resizeGesture.preview(session, gesture, minSize);
        case GESTURES.ROTATE:
            return rotateGesture.preview(session, gesture);
        default:
            return null;
    }
}

/**
 * What the transform in flight shows, or `null` when the committed frame is the picture:
 * the gesture is not a transform, or the release would change nothing.
 *
 * `items` are the band's marks, in stacking order, from the scene after the release;
 * `chrome` is the selection's chrome over that scene. `base` and `ceiling` index the
 * committed scene: its elements below `base` paint under the band, and the ones from
 * `ceiling` on paint over it.
 *
 * @param {object} session
 * @param {object | null} gesture
 * @param {number} minSize The resize floor, in screen pixels.
 * @returns {{ base: number, ceiling: number, items: object[], chrome: object[] } | null}
 * @throws The kernel's refusal, with the words its release would get.
 */
export function transformShown(session, gesture, minSize) {
    const bytes = ask(session, gesture, minSize);
    if (bytes === null) {
        return null;
    }
    const header = new DataView(bytes.buffer, bytes.byteOffset, 8);
    const base = header.getUint32(0, true);
    const ceiling = header.getUint32(4, true);
    if (base === PREVIEW_UNCHANGED) {
        return null;
    }
    const packet = decodeFrame(bytes.subarray(8));
    return { base, ceiling, items: packet.staticSection.items, chrome: packet.chromeSection.chrome };
}

/**
 * A reader of the committed marks under and over a preview's band, kept across moves.
 *
 * The runs are the committed scene's, so they change only when the committed frame does
 * or when the band moves in the stacking order; between two such changes every move reads
 * the same two objects, which is what lets the static cache keep the layer under the band.
 * `under` carries the committed paper and grid, because it is the layer painted first.
 *
 * @returns {(session: object, frame: object, shown: { base: number, ceiling: number }) =>
 *   { under: { items: object[], background: string, grid: unknown }, over: { items: object[] } }}
 */
function createTransformLayers() {
    let key = null;
    let base = -1;
    let ceiling = -1;
    let layers = null;
    return (session, frame, shown) => {
        const committed = frame.staticSection ?? frame;
        if (committed === key && shown.base === base && shown.ceiling === ceiling) {
            return layers;
        }
        key = committed;
        base = shown.base;
        ceiling = shown.ceiling;
        layers = {
            under: {
                items: decodeFrame(session.frameRange(0, base)).staticSection.items,
                background: frame.background,
                grid: frame.grid,
            },
            over: { items: decodeFrame(session.frameRange(ceiling, PREVIEW_UNCHANGED)).staticSection.items },
        };
        return layers;
    };
}

/**
 * The whole picture of the transform in flight, or `null` when the committed frame is it.
 *
 * Painted in order, `under`, `shown` and `over` are the scene the release would keep: the
 * committed marks under the band (with the paper and the grid), the band from the
 * preview, and the committed marks over it. `shown.chrome` is the selection's chrome
 * over that scene. The two committed runs are kept across moves (see
 * `createTransformLayers`), so a move asks the frontier for the band alone.
 *
 * @param {number} minSize The resize floor, in screen pixels.
 * @returns {(session: object, frame: object, gesture: object | null) =>
 *   { shown: ReturnType<typeof transformShown>, under: object, over: object } | null}
 * @throws The kernel's refusal, with the words its release would get.
 */
export function createTransformPicture(minSize) {
    const layers = createTransformLayers();
    return (session, frame, gesture) => {
        const shown = transformShown(session, gesture, minSize);
        return shown === null ? null : { shown, ...layers(session, frame, shown) };
    };
}
