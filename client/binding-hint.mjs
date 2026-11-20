// The binding hint: the shape a held arrow end would tie to, painted while it is held.
//
// # What it is
//
// Upstream lights the shape an arrow would bind to while the arrow is being drawn or
// while one of a straight arrow's ends is dragged (`interactiveScene.ts` paints
// `appState.suggestedBinding` in the rgb(106,189,252) outline and the reachable
// midpoint dots). The shape named here is the kernel's own answer — the query the
// drop reads — so the hint and the tie are one statement, not two implementations
// kept in step (D6, and the point of TASK-209).
//
// # Who asks
//
// Only the two gestures that can tie ask: the drag that draws an arrow (the free end
// is one by birth), and the drag of a straight arrow's endpoint. A line's end ties
// nothing, and the kernel's own gate on the dragging id is the second wall — the
// client's gate here is about which gesture is worth asking at all.
//
// # The key that silences it
//
// Ctrl/Cmd held at the move is upstream's "binding off": the end the user lets go
// will not tie. A suggestion that lit a shape the release would refuse to tie would
// be a hint that lies, so the key held silences the hint entirely — the same key the
// commit reads to unbind (TASK-208), one key, one meaning.

import { GESTURES } from "./gesture.mjs";
import { ARROW_TYPES, TOOLS } from "./tools.mjs";

/**
 * The hint to paint for the gesture in flight, or `null` when there is none.
 *
 * @param {{ suggestedBindingAt: Function, screenToScene: Function }} session
 * @param {{ kind: string, tool?: string, arrowType?: string, id?: string, currentScreen?: {x: number, y: number}, bindingHeld?: boolean } | null} gesture
 * @returns {object | null} The kernel's `{id, strokeWidth, lines, curves, ellipse, midpoints}` in
 *   screen pixels, or `null`.
 */
export function bindingSuggestion(session, gesture) {
    if (gesture === null || gesture === undefined) {
        return null;
    }
    // The key held at the move silences the hint: what it lights would not tie.
    if (gesture.bindingHeld === true) {
        return null;
    }
    if (gesture.kind === GESTURES.DRAW) {
        // Only the arrow draws toward a tie — a rectangle being drawn binds nothing —
        // and the elbow is its own lane, whose route never rides this query.
        if (gesture.tool !== TOOLS.arrow || gesture.arrowType === ARROW_TYPES.elbow) {
            return null;
        }
        return ask(session, null, gesture.currentScreen);
    }
    if (gesture.kind === GESTURES.VERTEX) {
        return ask(session, gesture.id, gesture.currentScreen);
    }
    return null;
}

/**
 * The kernel's answer for one pointer place, or `null` when it names no shape.
 */
function ask(session, dragging, at) {
    if (!at || !Number.isFinite(at.x) || !Number.isFinite(at.y)) {
        return null;
    }
    const scene = session.screenToScene(at.x, at.y);
    const json = session.suggestedBindingAt(scene[0], scene[1], dragging);
    if (json === undefined || json === null) {
        return null;
    }
    try {
        return JSON.parse(json);
    } catch {
        return null;
    }
}
