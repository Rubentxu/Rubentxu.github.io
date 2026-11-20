// The draw gesture: a shape made by dragging with a shape tool.
//
// # What it is
//
// A press with the rectangle, diamond, ellipse, line or arrow tool open, a drag, and a
// release. The two ends of the drag are the two corners of a closed shape, or the two
// ends of a line or an arrow.
//
// # The four moments
//
// `start` keeps the tool, the point of the press and the element's identity, minted
// by the caller: the id, the seed and the arrow kind the commit will carry. `move`
// returns the gesture with the pointer at its new place. `commit` decides what the
// release means and says so with a result; it does not act on it. `preview` is the
// json of the element the drag would land — the live preview's input, the commit's
// own builder, one element in two moments.
//
// # What commit answers
//
// - `created`: the drag is a shape. It carries the id, the document and, for an arrow,
//   the two scene ends so the kernel can tie them in the same step of history. A sticky
//   note also uses `created` for a click, with its size read from the kernel.
// - `multipoint`: a straight gesture too short to be a line opens the click-by-click
//   mode, where the next clicks are corners. `from` is the press in the scene. A touch
//   pointer does not enter the mode: a tap has no hover to aim a rubber band with.
// - `tiny`: nothing happened. A click, a drag with no extent in a closed shape, a short
//   straight touch, a tool with no shape.
//
// # What stays outside
//
// Nothing here inserts and nothing here opens the multipoint mode: the page's one door
// creates elements, and the mode belongs to the page. The id is minted by the caller. A
// refusal is the pipeline's to report.

import { GESTURES } from "../gesture.mjs";
import { TOOLS, linearDragIsLongEnough, shapeJsonFor } from "../tools.mjs";

/**
 * The tools whose drag builds the element as a **box**, and so the only ones
 * whose extent the object snap re-measures (SNAP-05). The reference's own
 * snappable set is wider — text, image, frame — but their drag carries rules
 * of its own (an anchor side, a proportion, a frame's membership) and none of
 * them re-derives a box from two ends, so the kernel leaves them as built:
 * the declared granularity, not an omission this list hides.
 *
 * An arrow and a line are absent on purpose: a binding gives way to the snap,
 * never the other way round.
 */
const BOX_TOOLS = new Set([TOOLS.rectangle, TOOLS.ellipse, TOOLS.diamond]);

/**
 * The scene end of a creation drag, moved by what the kernel's object snap
 * answers for it.
 *
 * The kernel decides (`snapCreateEnd` is its pure query, the commit's own
 * rule); the client only applies the pair it answers, so the shape the user
 * watches grow is the shape the release lands. A session without the door —
 * a unit driving an older kernel — leaves the end exactly as it was.
 *
 * @param {{ snapCreateEnd?: (x: number, y: number) => number[] }} session
 * @param {string} tool
 * @param {number[]} to The raw scene end.
 * @returns {number[]} The scene end the snap answers for.
 */
function snappedEnd(session, tool, to) {
  if (!BOX_TOOLS.has(tool) || typeof session.snapCreateEnd !== "function") {
    return to;
  }
  const [ox, oy] = session.snapCreateEnd(to[0], to[1]);
  return [to[0] + ox, to[1] + oy];
}

/**
 * @typedef {{ x: number, y: number }} Point
 */

/**
 * @param {string} tool The draw tool in hand.
 * @param {Point} startScreen Where the pointer went down.
 * @param {{ id: string, seed: number, arrowType?: string, created?: number }} identity The element's
 *   identity, minted by the caller at the press: the id the commit will insert under,
 *   the seed the sketch wobbles with, and the arrow kind the tool was holding. The
 *   preview and the commit carry the same three, so what the user watched grow is
 *   what lands.
 * @returns {object} The payload for a new gesture, without its owners.
 */
export function start(tool, startScreen, identity) {
    return {
        kind: GESTURES.DRAW,
        tool,
        startScreen,
        currentScreen: startScreen,
        id: identity.id,
        seed: identity.seed,
        arrowType: identity.arrowType,
        ...(identity.created === undefined ? {} : { created: identity.created }),
    };
}

/**
 * The gesture with the pointer at its new place. The start never moves.
 *
 * @param {object} gesture
 * @param {Point} next
 * @param {boolean} [bindingHeld] The binding key is held at this move: Ctrl/Cmd, the
 *   same key the commit reads to let the end go (TASK-208). It rides the gesture so
 *   the paint can silence the hint without seeing events.
 * @returns {object}
 */
export function move(gesture, next, bindingHeld = false) {
    return { ...gesture, currentScreen: next, bindingHeld };
}

/**
 * What the release of a drag means.
 *
 * @param {{ screenToScene: (x: number, y: number) => ArrayLike<number>, stickyNoteDefaultSize: () => number }} session
 * @param {object} gesture
 * @param {Point} release Where the pointer left the canvas, from the release event.
 * @param {{ pointerType?: string, bindingOff?: boolean, alt?: boolean }} options
 *   `bindingOff` is the binding key held at the lift: the arrow is born untied, as
 *   the reference's Ctrl/Cmd release leaves it (BIND-05). `alt` is the modifier
 *   held at the lift: the reference's Alt forces an "inside" tie at the pointer
 *   (BIND-04), and rides along to the kernel with the ends.
 * @returns {{ kind: "created", id: string, json: string, ends: { start: ArrayLike<number>, end: ArrayLike<number>, alt?: boolean } | null }
 *   | { kind: "multipoint", from: Point }
 *   | { kind: "tiny" }}
 */
export function commit(session, gesture, release, { pointerType, bindingOff = false, alt = false } = {}) {
    const widthScreen = Math.abs(release.x - gesture.startScreen.x);
    const heightScreen = Math.abs(release.y - gesture.startScreen.y);
    // The release is the point the user chose, so the extent is measured to it and not to
    // the last move. A closed shape with no extent in one axis is a click; a line and an
    // arrow are different, a horizontal one has no height and is ordinary, and what they
    // need is enough travel.
    const straight = gesture.tool === TOOLS.line || gesture.tool === TOOLS.arrow;
    const bigEnough = straight
        ? linearDragIsLongEnough(release.x - gesture.startScreen.x, release.y - gesture.startScreen.y)
        : widthScreen >= 1 && heightScreen >= 1;
    const from = session.screenToScene(gesture.startScreen.x, gesture.startScreen.y);
    let origin = from;
    let to;
    if (!bigEnough) {
        if (gesture.tool === TOOLS.stickynote) {
            // A click places the default square around the point the user chose; a drag
            // still starts at its press corner. The size belongs to the kernel, so the
            // client shifts that scene-space footprint rather than guessing CSS pixels.
            const size = session.stickyNoteDefaultSize();
            origin = [from[0] - size / 2, from[1] - size / 2];
            to = [origin[0] + size, origin[1] + size];
        } else {
            if (straight && pointerType !== "touch") {
                return { kind: "multipoint", from: { x: from[0], y: from[1] } };
            }
            return { kind: "tiny" };
        }
    } else {
        // The extent is a question about what the finger did, in CSS pixels; the ends of the
        // element are scene coordinates, and only the kernel knows where the scene's origin is
        // on this screen.
        to = session.screenToScene(release.x, release.y);
    }
    // The raw end is the gesture's own fact, and the commit's input: the kernel
    // re-decides the snap from it, so a preview that adjusted its answer and a
    // commit that re-derives it cannot drift. What the json builds from is the
    // snapped end, so the shape the release inserts is the shape the preview
    // showed.
    const rawEnd = to;
    to = snappedEnd(session, gesture.tool, to);
    const json = shapeJsonFor(
        gesture.tool,
        gesture.id,
        { x: origin[0], y: origin[1] },
        { x: to[0], y: to[1] },
        { arrowType: gesture.arrowType, seed: gesture.seed, created: gesture.created },
    );
    if (json === null) {
        return { kind: "tiny" };
    }
    // An arrow whose ends landed on shapes is born tied, and the creation and the tying
    // are one step of history. The binding key held at the lift is the reference's
    // "binding off": the arrow is born with no ties at all, not with ties it then
    // loses. Alt is the other modifier: it rides with the ends so the kernel ties
    // inside at the pointer. A box carries its raw drag end instead: the kernel
    // snaps the extent from it (SNAP-05), the same answer the preview painted.
    const ends =
        gesture.tool === TOOLS.arrow && !bindingOff
            ? { start: from, end: rawEnd, ...(alt ? { alt: true } : {}) }
            : BOX_TOOLS.has(gesture.tool)
              ? { dragEnd: rawEnd }
              : null;
    return { kind: "created", id: gesture.id, json, ends };
}

/**
 * The json of the element the drag would land, read before it exists.
 *
 * This is the live preview's half (TASK-132): the same builder the commit runs, the
 * same id, the same seed and the same arrow kind the press minted — so the shape the
 * user watched grow under the pointer is the shape that lands, wobble for wobble. The
 * ends are scene points answered by the session, the one owner of the transform; the
 * json is the kernel's draft door's own input (`Session.previewOps`), and the door
 * never sees the scene this json describes.
 *
 * A drag with no extent yet builds the same `null` the commit answers for a click —
 * the preview appears when the drag has an extent, and what the user sees is the
 * shape a release right there would draw.
 *
 * @param {{ screenToScene: (x: number, y: number) => ArrayLike<number> }} session
 * @param {object} gesture
 * @returns {string | null} The json, or `null` when the tool builds none.
 */
export function preview(session, gesture) {
    if (gesture?.kind !== GESTURES.DRAW) {
        return null;
    }
    const from = session.screenToScene(gesture.startScreen.x, gesture.startScreen.y);
    // The same adjustment the commit makes, from the same query: what the user
    // watches grow is what the release lands.
    const to = snappedEnd(
        session,
        gesture.tool,
        session.screenToScene(gesture.currentScreen.x, gesture.currentScreen.y),
    );
    return shapeJsonFor(
        gesture.tool,
        gesture.id,
        { x: from[0], y: from[1] },
        { x: to[0], y: to[1] },
        { arrowType: gesture.arrowType, seed: gesture.seed, created: gesture.created },
    );
}
