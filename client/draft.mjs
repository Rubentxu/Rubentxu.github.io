// The draft: what the shape in flight would look like, asked of the kernel and
// painted by the frame's own painter.
//
// # What this file is
//
// One crossing per paint of a draw or freehand gesture: the gesture's own builder
// (`preview` of its module) names the element the release will insert — the same
// id, the same seed, the same arrow kind the press minted — and the kernel's draft
// door (`Session.previewOps`) answers its geometry as a frame packet. The answer is
// decoded by the reader the frame itself decodes with, so a draft crosses in the
// vocabulary the frame crosses in: there is no second encoding of "what a mark
// looks like" to drift.
//
// # What it is not
//
// The draft is not in the document. The door is a question — the scene, the
// revisions and the history it was asked of are the ones that answer — so a drag the
// browser took away leaves nothing behind, and nothing the user draws mid-drag can
// reach a collaborator, the save or the export until the release commits it.
// Upstream previews from the element it inserted on pointer-down; this port keeps
// the document free of what the hand has not committed to and asks for the geometry
// instead. That is the declared divergence (TASK-132).

import { decodeFrame } from "./wire.mjs";
import { GESTURES } from "./gesture.mjs";
import * as drawGesture from "./gestures/draw.mjs";
import * as freedrawGesture from "./gestures/freedraw.mjs";

/**
 * The items the gesture's shape would paint, in the frame's own item shape.
 *
 * @param {object} session the kernel session in hand.
 * @param {object | null} gesture the gesture in flight, as the pipeline holds it.
 * @returns {object[] | null} the frame items of the draft, or `null` when the
 *   gesture in flight is not a drawing one or builds no element.
 * @throws whatever the door or the builders refuse — the caller decides what a
 *   refused draft does to the frame.
 */
export function draftFrame(session, gesture) {
    if (gesture?.kind !== GESTURES.DRAW && gesture?.kind !== GESTURES.FREEDRAW) {
        return null;
    }
    const json =
        gesture.kind === GESTURES.DRAW
            ? drawGesture.preview(session, gesture)
            : freedrawGesture.preview(session, gesture);
    if (json === null) {
        return null;
    }
    const packet = decodeFrame(session.previewOps(json));
    return packet.staticSection?.items ?? null;
}
