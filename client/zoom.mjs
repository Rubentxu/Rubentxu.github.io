// The zoom steps: how far one keyboard press, one toolbar button or one wheel
// notch moves, and the bounds that stop them.
//
// Why a module and not four constants in `index.js`: every caller that wants
// "one step" has to answer the same question — how far, and which way — and an
// answer computed at four call sites is four answers that can disagree. The
// step, the bounds and the label live here; the session holds only the number.
//
// The numbers are the reference's own, not this application's taste: one
// keyboard press or button click moves `ZOOM_STEP` — 0.1
// (`common/src/constants.ts:365`, applied at
// `actions/actionCanvas.tsx:145,199`) — and one wheel notch moves the wheel's
// own arithmetic (`App.wheel.ts:123-163`): the delta clamped to one step's
// worth of pixels, `delta / 100`, and an acceleration that lifts the steps the
// more zoomed-in the view already is. Both answers come back normalized the
// same way the reference normalizes them — rounded to six decimals and clamped
// to `MIN_ZOOM`/`MAX_ZOOM` (`scene/normalize.ts:7-9`,
// `common/src/constants.ts:366-367`) — so a wheel built up from small ticks
// and a keyboard walked down from a pinch cannot disagree about the number the
// kernel is asked for.
//
// The pinch is the one thing that reaches past the steps: it is a free zoom,
// so it can land between two steps or past both bounds, and the next press
// moves from exactly where it left the view — 0.9 from 0.912, 1.1 from 1.087.

/** How far one keyboard press or toolbar click moves (`constants.ts:365`). */
export const ZOOM_STEP = 0.1;

/** The floor the reference clamps to (`constants.ts:366`). */
export const MIN_ZOOM = 0.1;

/** The ceiling the reference clamps to (`constants.ts:367`). */
export const MAX_ZOOM = 30;

/** The level a fresh document opens at, and the one the readout button returns to. */
export const DEFAULT_ZOOM = 1;

/** Upstream's `getNormalizedZoom` (`scene/normalize.ts:7-9`). */
export function getNormalizedZoom(zoom) {
    return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(zoom.toFixed(6))));
}

/**
 * Move `steps` presses from `zoom`, the way the reference's zoom actions do
 * (`actionCanvas.tsx:145,199`). Out-of-range steps clamp rather than wrap: a
 * user who holds the "out" button at the floor is asking to stop, and the
 * reference disables the button at the bounds (`actionCanvas.tsx:172,230`).
 *
 * @param {number} zoom The current level.
 * @param {number} steps Positive to zoom in, negative to zoom out.
 * @returns {number} The normalized zoom one gesture later.
 */
export function zoomBy(zoom, steps) {
    return getNormalizedZoom(zoom + steps * ZOOM_STEP);
}

/**
 * The zoom one wheel tick lands on, upstream's own arithmetic
 * (`App.wheel.ts:123-163`).
 *
 * The delta is clamped to one step's worth of pixels — `ZOOM_STEP * 100` — so a
 * mouse notch of any travel and a runaway flick move the same. The base move is
 * `delta / 100` in the direction the wheel went, and while the view is already
 * zoomed in the step is lifted by `log10(max(1, zoom))` scaled by how small the
 * tick was — `min(1, |delta| / 20)` — so the zoomed-in end does not feel
 * sluggish under a finger that is only brushing the wheel. The answer is
 * floored at `MIN_ZOOM` before the normalization clamps the ceiling, the order
 * the reference applies them in.
 *
 * @param {number} zoom The current level.
 * @param {number} deltaY The wheel event's travel; negative zooms in.
 * @returns {number} The normalized zoom one tick later.
 */
export function wheelZoom(zoom, deltaY) {
    const sign = Math.sign(deltaY);
    const maxStep = ZOOM_STEP * 100;
    const absDelta = Math.abs(deltaY);
    let delta = deltaY;
    if (absDelta > maxStep) {
        delta = maxStep * sign;
    }
    let next = zoom - delta / 100;
    next += Math.log10(Math.max(1, zoom)) * -sign * Math.min(1, absDelta / 20);
    return getNormalizedZoom(Math.max(next, MIN_ZOOM));
}

/**
 * The button label for the current level. Rounded to a whole percent because a label
 * showing `99.9999%` is a rounding artefact dressed as information.
 */
export function formatZoom(zoom) {
    return `${Math.round(zoom * 100)}%`;
}
