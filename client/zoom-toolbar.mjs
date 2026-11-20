// The zoom control: out, the readout that resets, and in.
//
// Why the middle button is two things: it is the only place the current level is visible,
// and a level you cannot see is a level you cannot navigate back to. Making the readout
// the reset target costs nothing and means there is one button where there would
// otherwise be two, one of which is a number.
//
// Why this is not `bindStyleToolbar`: that answers "which token of this row is active",
// which needs a selection and a getter. This answers "what can I do from here", which
// needs the zoom, a ladder, and the session. The vocabulary is a list of levels, not a
// wire token the kernel knows about, so a `STYLES` row would be a row whose setter is a
// computed value and whose getter is a state of the world.
//
// Every path here goes through `zoomAtCentre`, never `setZoom`. That is a decision, not
// an oversight: `set_zoom` leaves the scroll alone, so pressing "in" at 100% would grow
// the scene from the top-left and throw away whatever the user had centred. `zoom_at_centre`
// derives the scroll from the old transform, so the middle of the canvas stays put. It
// also means the wheel and the buttons are the same call, and one anchor cannot be right
// for one of them.

import { DEFAULT_ZOOM, MAX_ZOOM, MIN_ZOOM, formatZoom, zoomBy } from "./zoom.mjs";

/**
 * The three controls, as the token the HTML carries and what a click does with it.
 * `reset` has no target level of its own — it is `DEFAULT_ZOOM` — so the row is the same
 * shape as the other toolbars and a fourth control would be a fourth token.
 */
export const ZOOM_ACTIONS = Object.freeze([
  Object.freeze({ token: "out", steps: -1 }),
  Object.freeze({ token: "reset", steps: 0 }),
  Object.freeze({ token: "in", steps: 1 }),
]);

/**
 * Bind every `button[data-zoom]` under `root`. Returns a `sync` that disables the two
 * end buttons when the ladder has no further level and writes the current level into the
 * readout.
 *
 * `paintFn` is the same `paint(session, ctx)` the other toolbars take. Repainting after a
 * zoom is not optional: the whole scene moved, and `paint` is also what refreshes the
 * selection chrome, so a zoom that skipped it would leave the rings where they were.
 *
 * A token no row names, or a row with no button, throws for the same reasons as
 * `bindHistoryToolbar`: both are silent failures of a kind nothing else reports.
 */
export function bindZoomToolbar({ root, session, paintFn, onError = (e) => { throw e; }, signal }) {
  const byToken = new Map(ZOOM_ACTIONS.map((action) => [action.token, action]));
  const bound = new Map();

  for (const button of Array.from(root.querySelectorAll("button[data-zoom]"))) {
    const action = byToken.get(button.dataset.zoom);
    if (action === undefined) {
      throw new Error(`no zoom action for data-zoom="${button.dataset.zoom}"`);
    }
    bound.set(action.token, button);
    button.addEventListener("click", () => {
      try {
        const target = action.steps === 0 ? DEFAULT_ZOOM : zoomBy(session.zoom(), action.steps);
        // Already there: a click on an end button that the sync has not disabled yet (the
        // flag is only as fresh as the last paint) should not ask the kernel to do
        // nothing, and should certainly not repaint as if it had.
        if (target === session.zoom()) {
          return;
        }
        session.zoomAtCentre(target);
        paintFn();
      } catch (error) {
        onError(error);
      }
    }, { signal });
  }

  const missing = ZOOM_ACTIONS.filter((action) => !bound.has(action.token)).map(
    (action) => action.token,
  );
  if (missing.length > 0) {
    throw new Error(`the zoom toolbar has no button for ${missing.join(", ")}`);
  }

  return {
    /**
     * Say the level, from the answer the frame carried: the same crossing the
     * canvas's truth rode in on, and not a second ask per paint.
     *
     * @param {{zoom: number}} answer the frame's own zoom.
     */
    sync({ zoom }) {
      // The reference disables the buttons at its own bounds
      // (`actionCanvas.tsx:172,230`: `<= MIN_ZOOM`, `>= MAX_ZOOM`).
      bound.get("out").disabled = zoom <= MIN_ZOOM;
      bound.get("in").disabled = zoom >= MAX_ZOOM;
      // The readout is also the reset target, so it must never be disabled: it is the one
      // control that works from every level, and a `disabled` percentage is a dead end.
      bound.get("reset").textContent = formatZoom(zoom);
    },
  };
}
