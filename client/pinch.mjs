// The pinch: two fingers on the glass, and what the view does while they move.
//
// # Why this is a module
//
// A pinch is arithmetic — a middle, a distance, a ratio — and arithmetic that
// lives inside a pointer handler is arithmetic nobody can test. The handler
// already has enough to say: which finger moved, whether the browser took the
// pointer away, whether a gesture is in flight. The numbers belong here, where
// a table of cases can hold them down.
//
// # The model
//
// One sentence: **the scene under the point where the fingers met when the
// gesture started stays under the point where they meet now.**
//
// That is the whole promise, and it is the promise a person makes with their
// hands: the paper they are holding does not slide away from under their
// fingers. Everything else follows from it.
//
// Two halves, and they are the two halves of the gesture:
//
// - The distance between the fingers is the zoom. Twice the distance is twice
//   the zoom, and the ratio is taken against the distance at the start, so the
//   gesture is recomputed from its beginning every frame instead of
//   accumulating a rounding error sixty times a second.
// - The middle of the fingers is the anchor. Moving them together moves the
//   view with them.
//
// # Why not the way upstream does it
//
// Upstream applies a `2 *` multiplier to the pan and says so in a comment: *2x
// multiplier is just a magic number that makes this work correctly on
// touchscreen devices* (`App.tsx:8093`). It is a number that exists to
// compensate for an anchor applied twice — once by the zoom and once by the
// pan — and it makes the pan of two fingers twice as fast as the pan of one.
// The model above needs no such number: the anchor is applied once, so the pan
// is exactly the movement of the fingers.
//
// # What this module does not do
//
// It does not read the kernel. The zoom it asks for and the pan it computes
// are numbers; the caller asks the kernel for the scene under the fingers and
// hands it back, because only the kernel knows where the scene is.

/**
 * The middle of the fingers, in canvas pixels.
 *
 * The average rather than the midpoint of the first two points: with two
 * fingers the two are the same number, and the average is the one that stays
 * right if a third finger ever lands.
 *
 * @param {{x: number, y: number}[]} points the fingers, in canvas pixels.
 * @returns {{x: number, y: number}}
 */
export function pinchCentre(points) {
    if (points.length === 0) {
        return { x: 0, y: 0 };
    }
    let x = 0;
    let y = 0;
    for (const point of points) {
        x += point.x;
        y += point.y;
    }
    return { x: x / points.length, y: y / points.length };
}

/**
 * How far apart the fingers are, in canvas pixels.
 *
 * The mean distance between the fingers rather than the distance to their
 * middle: with two fingers the two differ by a factor of two — the distance
 * to the middle is half the distance between them — and only one of them is
 * what the hand did. The fingers were 200 pixels apart; the middle was 100
 * pixels from each of them.
 *
 * @param {{x: number, y: number}[]} points the fingers, in canvas pixels.
 * @returns {number}
 */
export function pinchSpread(points) {
    if (points.length < 2) {
        return 0;
    }
    let total = 0;
    let pairs = 0;
    for (let i = 0; i < points.length; i += 1) {
        for (let j = i + 1; j < points.length; j += 1) {
            total += Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y);
            pairs += 1;
        }
    }
    return total / pairs;
}

/**
 * The state a pinch starts from.
 *
 * `anchor` is the scene under the middle of the fingers, and it is the one
 * number the whole gesture is about: it is where the paper is held, and the
 * gesture's job is to keep it there.
 *
 * @param {{x: number, y: number}[]} points the fingers at the start.
 * @param {number} zoom the zoom at the start.
 * @param {{x: number, y: number}} anchor the scene under the middle, in scene units.
 * @returns {{centre: {x: number, y: number}, spread: number, zoom: number, anchor: {x: number, y: number}}}
 */
export function pinchStart(points, zoom, anchor) {
    return {
        centre: pinchCentre(points),
        spread: pinchSpread(points),
        zoom,
        anchor: { x: anchor.x, y: anchor.y },
    };
}

/**
 * The zoom the fingers are asking for.
 *
 * The ratio is against the distance at the start of the gesture, so the answer
 * is the same however many times the fingers have been moved since: a gesture
 * recomputed from its beginning cannot drift.
 *
 * Two fingers on the same spot have no distance to compare, and that is a
 * gesture that has not started rather than one that divides by zero.
 *
 * @param {{spread: number, zoom: number}} start the gesture's starting state.
 * @param {{x: number, y: number}[]} points the fingers now.
 * @returns {number}
 */
export function pinchZoom(start, points) {
    if (start.spread <= 0) {
        return start.zoom;
    }
    return start.zoom * (pinchSpread(points) / start.spread);
}

/**
 * The pan that leaves the anchor under the middle of the fingers.
 *
 * `under` is the scene under the middle of the fingers, read **after** the new
 * zoom was applied: the same scene at the new scale is a different point.
 *
 * The kernel's transform is `screen = (scene + scroll) * zoom`
 * (`crates/nextdraw-core/src/viewport.rs`), so the scene under a screen point
 * is `screen / zoom - scroll`. For the anchor to land under the middle of the
 * fingers, the scroll has to be `middle / zoom - anchor`; the difference
 * between that and the scroll the kernel holds is the pan — and the kernel
 * takes a pan in screen pixels, which is the scene difference times the zoom.
 *
 * @param {{anchor: {x: number, y: number}}} start the gesture's starting state.
 * @param {number} zoom the zoom the kernel actually applied.
 * @param {{x: number, y: number}} under the scene under the middle of the fingers.
 * @returns {{dx: number, dy: number}} the pan, in screen pixels.
 */
export function pinchPan(start, zoom, under) {
    return {
        dx: (under.x - start.anchor.x) * zoom,
        dy: (under.y - start.anchor.y) * zoom,
    };
}
