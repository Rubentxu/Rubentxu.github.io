// A line or an arrow drawn click by click.
//
// A drag draws a straight element in one gesture, but the drawing a user
// wants is often a path — three corners of a room, the outline of a
// region — and dragging cannot say that. The multi-point mode is the
// answer both applications give: the first click opens the mode, every
// further click fixes a vertex, and the element is born when the user is
// done rather than while they are still thinking.
//
// This module is the mode's whole brain, as pure state: the client feeds
// it the pointer's scene position and the answers it needs (what the
// rubber band did, whether the click ends the drawing, which points the
// finished element carries), and nothing here touches the document or the
// canvas. That is what makes the rules testable without a browser and
// what keeps the growing line out of the kernel: the document is written
// once, when the drawing is finished, and one `Cmd+Z` takes the whole
// drawing back.
//
// # The rules, which are upstream's
//
// The state is the element being drawn: its points, measured from the
// first vertex like the document measures them, and the index of the last
// **committed** vertex — the one a click has fixed. The point after it,
// when there is one, is the **floating** point: the rubber band's end,
// which follows the pointer and belongs to nobody until a click fixes it.
// The mode opens with one committed vertex (the click that opened it) and
// one floating point at the same spot, so the rubber band is on the glass
// from the first move.
//
//   - A **move** with no floating point and the pointer past the commit
//     threshold from the last committed vertex grows a new floating
//     point. A move with one makes it follow the pointer — unless the
//     pointer came back inside the threshold of the last committed
//     vertex, which retracts the floating point instead: the user
//     hovering back over where they were is not a new corner.
//   - A **release** commits: the floating point becomes the last
//     committed vertex. This is why a double-click works without being
//     coded — the first click fixes a vertex, the second lands inside
//     its threshold and reads as "done".
//   - A **press** ends the drawing when the click lands inside the
//     commit threshold of the last committed vertex, when a line's path
//     has come back to its start, or when the tool is the arrow that
//     turns at right angles — which cannot be drawn click by click, and
//     so a second click reads as "done" whatever the distance.
//   - **Escape** and **Enter** end the drawing from the keyboard.
//
// The threshold is eight scene units, and the distance is measured in
// the scene, so zooming in does not make the commit zone harder to hit
// (`LINE_CONFIRM_THRESHOLD`, `packages/common/src/constants.ts:33`, and
// the arithmetic around it in `App.tsx` compares scene coordinates).
// The release that opens the mode — a click rather than a drag — is the
// client's own threshold (`MINIMUM_LINEAR_SIZE` in `tools.mjs`), which
// this module never sees.
//
// # What finishing leaves behind
//
// A finished drawing keeps its committed vertices and drops the floating
// one: the point the rubber band was still carrying was never clicked.
// One vertex is not an element, so a drawing that never grew past its
// first click finishes as nothing — the mode opened and closed without
// the document ever knowing.

/**
 * How far, in scene units, the pointer has to sit from the last committed
 * vertex before a click means "another corner" rather than "done here".
 */
export const LINE_CONFIRM_THRESHOLD = 8;

/**
 * Open the mode on the vertex the user just clicked.
 *
 * `origin` is that vertex in scene coordinates, and every point the state
 * carries is measured from it, the way the document measures a linear
 * element's points from its own corner. `zoom` rides with the state
 * because the loop test reads the threshold through it — a drawing
 * examined at another zoom closes at another distance — and the zoom a
 * drawing is drawn at is the zoom its loop is judged at.
 *
 * The second point exists from the start and floats: it is what the
 * rubber band moves, and the first committed vertex is the one behind it.
 *
 * @param {string} tool The drawing tool the mode opened with.
 * @param {string | undefined} arrowType The shape an arrow takes, when the tool is the arrow.
 * @param {{x: number, y: number}} origin Scene point of the first vertex.
 * @param {number} zoom The zoom the drawing is drawn at.
 * @returns {object} The mode's state.
 */
export function begin(tool, arrowType, origin, zoom) {
    return {
        tool,
        arrowType,
        origin,
        zoom,
        points: [
            [0, 0],
            [0, 0],
        ],
        committed: -1,
    };
}

/**
 * The squared distance between two points, without the square root.
 *
 * Every threshold in this module is a comparison against a constant, so
 * the square root is work the answer never reads.
 */
function squaredDistance([ax, ay], [bx, by]) {
    const dx = ax - bx;
    const dy = ay - by;
    return dx * dx + dy * dy;
}

/**
 * Whether a closed path has come back to where it started — the kernel's
 * answer, not this module's.
 *
 * The rule moved to the core (`isPathALoop` on the boundary): three or more
 * points whose ends meet within the commit threshold read through the zoom,
 * so a drawing examined up close demands a closer return. A copy here would
 * let the drawing close into a polygon the kernel was never going to
 * confirm, and the two would disagree the first time either number moved.
 *
 * @param {Array<[number, number]>} points the drawing so far, scene units.
 * @param {number} zoom the zoom the threshold is read through.
 * @param {object} session the kernel, whose rule the question is.
 * @returns {boolean} whether the ends meet.
 */
export function isPathALoop(points, zoom, session) {
    return session.isPathALoop(JSON.stringify(points), zoom);
}

/**
 * Where the rubber band goes when the pointer moves.
 *
 * The answer says what happened — nothing, a floating point appeared, it
 * was retracted, or it followed the pointer — and whether the pointer
 * ended up inside the commit zone, which is the cursor's business: a
 * zone that would end the drawing reads as a button, not as a pen.
 *
 * @param {object} state The mode's state.
 * @param {{x: number, y: number}} at Scene point of the pointer.
 * @returns {{state: object, change: string, pointer: boolean}}
 */
export function move(state, at) {
    const local = [at.x - state.origin.x, at.y - state.origin.y];
    const floating = state.points.length - 1 > state.committed;

    if (!floating) {
        const last = state.points[state.points.length - 1];
        const threshold = LINE_CONFIRM_THRESHOLD;
        if (squaredDistance(local, last) >= threshold * threshold) {
            return {
                state: { ...state, points: [...state.points, local] },
                change: "append",
                pointer: false,
            };
        }
        return { state, change: "none", pointer: true };
    }

    if (state.committed >= 0 && state.points.length > 2) {
        const committedPoint = state.points[state.committed];
        const threshold = LINE_CONFIRM_THRESHOLD;
        if (squaredDistance(local, committedPoint) < threshold * threshold) {
            return {
                state: { ...state, points: state.points.slice(0, -1) },
                change: "retract",
                pointer: true,
            };
        }
    }

    const points = [...state.points.slice(0, -1), local];
    return { state: { ...state, points }, change: "follow", pointer: false };
}

/**
 * Fix the floating point where it stands.
 *
 * A release is what makes a click a vertex: everything the rubber band
 * was carrying belongs to the drawing from this moment. A release with
 * no floating point re-commits the vertex that is already there, which
 * is the sound of a click that changed nothing.
 *
 * @param {object} state The mode's state.
 * @returns {object} The state with the last vertex committed.
 */
export function commit(state) {
    return { ...state, committed: state.points.length - 1 };
}

/**
 * What a press means while the mode is open.
 *
 * The three ways a press ends the drawing, in the order upstream asks
 * them: a line whose path has come back to its start — the closing
 * point is kept, because the loop is the point; the turning arrow,
 * which cannot be drawn click by click and reads any second press as
 * "done"; and the commit zone, a click within the threshold of the last
 * committed vertex. Anything else is a press that only selects the
 * drawing while it grows.
 *
 * @param {object} state The mode's state.
 * @param {{x: number, y: number}} at Scene point of the press.
 * @param {object} session the kernel, whose loop rule the closing question is.
 * @returns {{state: object, finalize: boolean}}
 */
export function press(state, at, session) {
    if (state.tool === "line" && isPathALoop(state.points, state.zoom, session)) {
        return { state: commit(state), finalize: true };
    }
    if (state.tool === "arrow" && state.arrowType === "elbow" && state.points.length > 1) {
        return { state, finalize: true };
    }
    const local = [at.x - state.origin.x, at.y - state.origin.y];
    const committedPoint = state.committed >= 0 ? state.points[state.committed] : null;
    const threshold = LINE_CONFIRM_THRESHOLD;
    if (
        state.points.length > 1
        && committedPoint !== null
        && squaredDistance(local, committedPoint) < threshold * threshold
    ) {
        return { state, finalize: true };
    }
    return { state, finalize: false };
}

/**
 * The points the finished element carries, or `null` for no element.
 *
 * The floating point — the rubber band's end, still unowned when the
 * drawing ended — is dropped: the user never clicked it. One vertex is
 * not an element either, so a drawing that never grew past its first
 * click finishes as nothing and the document never hears about it.
 *
 * @param {object} state The mode's state.
 * @returns {Array<[number, number]> | null}
 */
export function finish(state) {
    const floating = state.points.length - 1 > state.committed;
    const kept = floating ? state.points.slice(0, state.committed + 1) : state.points;
    return kept.length >= 2 ? kept : null;
}
