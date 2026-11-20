// The vertex gesture: dragging a vertex of a line or an arrow.
//
// # What it is
//
// The vertex follows the pointer at the distance the hand took it: a point dragged by
// its edge keeps that distance, so the gesture carries the offset between the vertex and
// the pointer from the moment it starts. The kernel moves the point in the document
// itself, live, so the drawing the person sees is the drawing the document holds.
//
// # The four moments
//
// `start` opens the capture the kernel holds for the whole drag, so the gesture is one
// undo step however many pointermoves it takes. `move` carries the vertex to the pointer
// plus the offset. `commit` hands the kernel the place where the pointer lifted, which
// decides what an end of a turning arrow lands on (a shape, or the void), and closes the
// capture; both sit in the same undo step. A vertex that was clicked and not dragged
// closes with the scene as it was and leaves the history alone. `preview` names the
// vertex the hand is on, the one thing the drawing cannot say.
//
// Nothing here catches: a refusal from the kernel is the pipeline's to report.

import { GESTURES } from "../gesture.mjs";

/**
 * The distance between the pointer and the vertex it took, in scene units.
 *
 * Every move adds the pointer's place to this offset, not to where the vertex happens to
 * be: without it, a point grabbed a hair off its centre would jump that hair on the first
 * move, and a chain whose end sat at a fraction the pointer never named would land on a
 * number the pointer never chose. A hit that does not say where the vertex is has no
 * offset.
 *
 * @param {{ screenToScene: Function }} session
 * @param {number[] | undefined} position The vertex on the screen.
 * @param {{ x: number, y: number }} at The pointer on the screen.
 * @returns {{ x: number, y: number }}
 */
export function grabOffset(session, position, at) {
    if (!Array.isArray(position)) {
        return { x: 0, y: 0 };
    }
    const vertexScene = session.screenToScene(position[0], position[1]);
    const pointerScene = session.screenToScene(at.x, at.y);
    return { x: vertexScene[0] - pointerScene[0], y: vertexScene[1] - pointerScene[1] };
}

/**
 * Open the drag of a vertex and return the gesture it begins.
 *
 * @param {{ vertexDragBegin: Function, screenToScene: Function }} session
 * @param {string} id The line or arrow whose vertex is dragged.
 * @param {{ index: number, position?: number[] }} hit The vertex under the pointer.
 * @param {{ x: number, y: number }} startScreen Where the pointer went down.
 * @returns {object} The payload for a new gesture, without its owners.
 */
export function start(session, id, hit, startScreen) {
    session.vertexDragBegin(id, hit.index);
    return {
        kind: GESTURES.VERTEX,
        id,
        index: hit.index,
        grab: grabOffset(session, hit.position, startScreen),
        startScreen,
        currentScreen: startScreen,
    };
}

/**
 * Carry the vertex to the pointer and return the gesture with its new place.
 *
 * @param {{ screenToScene: Function, vertexDragMove: Function }} session
 * @param {{ grab?: { x: number, y: number } }} gesture
 * @param {{ x: number, y: number }} next
 * @param {boolean} [bindingHeld] The binding key is held at this move: Ctrl/Cmd, the
 *   same key the release reads to let the end go. It rides the gesture so the paint
 *   can silence the hint without seeing events.
 * @returns {object}
 */
export function move(session, gesture, next, bindingHeld = false) {
    const scene = session.screenToScene(next.x, next.y);
    const grab = gesture.grab ?? { x: 0, y: 0 };
    session.vertexDragMove(scene[0] + grab.x, scene[1] + grab.y);
    return { ...gesture, currentScreen: next, bindingHeld };
}

/**
 * Close the drag at the place the pointer lifted. The first vertex is the end the arrow
 * leaves from and every other one is read as the end it arrives at; the kernel leaves
 * the ends of a straight arrow alone when asked, so the question is safe on every vertex.
 *
 * The binding key held at the lift is upstream's "binding off": the end lets go of the
 * shape it hung from and stays where it was dropped, instead of tying to the one under it.
 *
 * @param {{ screenToScene: Function, bindArrowEnd: Function, unbindArrowEnd: Function, editDragEnd: Function }} session
 * @param {{ id: string, index: number }} gesture
 * @param {{ x: number, y: number }} at Where the pointer lifted.
 * @param {boolean} [bindingOff] The binding key is held: the end lets go.
 * @param {boolean} [alt] Alt is held: the reference forces an "inside" tie at the
 *   pointer, even when the lift is outside the shape (BIND-04).
 */
export function commit(session, gesture, at, bindingOff = false, alt = false) {
    const scene = session.screenToScene(at.x, at.y);
    const endpoint = gesture.index === 0 ? "start" : "end";
    if (bindingOff) {
        session.unbindArrowEnd(gesture.id, endpoint);
    } else {
        session.bindArrowEnd(gesture.id, endpoint, scene[0], scene[1], alt);
    }
    session.editDragEnd();
}

/**
 * The vertex the chrome marks while the drag lives, or `null` for any other record.
 *
 * @param {{ id: string, index: number }} gesture
 * @param {{ id: string }} record One element's chrome.
 * @returns {{ kind: string, index: number } | null}
 */
export function preview(gesture, record) {
    if (record?.id !== gesture.id) {
        return null;
    }
    return { kind: GESTURES.VERTEX, index: gesture.index };
}
