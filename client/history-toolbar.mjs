// The undo / redo pair: two buttons that state the truth.
//
// Why this is not a fifth row of `STYLES`: that table answers "which of this row's
// tokens is active", which is a question about the *selection*. Undo and redo answer
// "can this happen at all", which is a question about the *document* and needs no ids.
// Forcing them into `STYLES` would mean a getter that takes no selection and a setter
// that is really a command, and the table would stop meaning anything it says.
//
// Why this is not two more listeners in `index.js`: the guarantee worth protecting is
// that the button and the keyboard share ONE history. That is only assertable if the
// binder is a thing you can hold, so the reasoning lives here instead of in the boot.
//
// The client keeps no undo stack of its own and no shadow counter of "how many things
// are undoable". The only history is the kernel's, and `disabled` is `canUndo()` /
// `canRedo()` read on every paint rather than a client-side guess. A click therefore
// makes exactly the call `Cmd+Z` makes — which is what lets a user mix the two without
// one silently stealing an entry from the other.

/**
 * The two history actions, each as the pair of methods the frontier exposes for it: the
 * one that acts, and the one that says whether it would.
 *
 * Both rows are the whole contract. `act` is what a click calls; `available` is what
 * `sync` reads; `token` is the `data-history` value that joins the button to its row. A
 * third action — "revert to the initial scene", say — is a row, not a new function.
 */
import { stepHistory } from "./history.mjs";

export const HISTORY_ACTIONS = Object.freeze([
  Object.freeze({ token: "undo", act: "undo", available: "canUndo" }),
  Object.freeze({ token: "redo", act: "redo", available: "canRedo" }),
]);

/**
 * Bind every `button[data-history]` under `root` to the history action its token names,
 * and return a `sync` that sets each button's `disabled` from the kernel's own answer.
 *
 * `paintFn` is the same `paint(session, ctx)` the other toolbars take, for the same
 * reason: the module knows about a session and a set of buttons, not about a canvas.
 *
 * `onError` receives anything the frontier throws. The default re-throws, because a
 * throw here is a defect in the binding rather than a condition the user caused — the
 * same reasoning as `bindStyleToolbar`.
 *
 * Both tables have to agree with the page, in both directions, and both mismatches
 * throw rather than pass silently. A `data-history` value no row names would bind a
 * button that does nothing and report nothing: the caller sees a working toolbar, and
 * the button is simply inert. A row with no button is the mirror — a capability the
 * table promises and the page does not deliver — and returning a `sync` that quietly
 * does half its work is how that goes unnoticed. `HISTORY_ACTIONS` is the list and
 * `index.html` is the other copy; these two throws are what keep them from drifting.
 *
 * @param {object} options
 * @param {object} options.root Element whose `[data-history]` buttons are bound.
 * @param {object} options.session The kernel session.
 * @param {() => void} options.paintFn Repaint, called only when the kernel moved.
 * @param {() => boolean} [options.isViewOnly] Whether the page refuses edits; history is then inert.
 * @param {(error: unknown) => void} [options.onError] Receives a frontier throw.
 * @param {AbortSignal} [options.signal] when it aborts, the listeners this binder added are removed.
 * @returns {{ sync: (available: {canUndo: boolean, canRedo: boolean}) => void }}
 */
export function bindHistoryToolbar({
  root, session, paintFn, isViewOnly = () => false, onError = (e) => { throw e; }, signal,
}) {
  const byToken = new Map(HISTORY_ACTIONS.map((action) => [action.token, action]));
  const bound = new Map();

  for (const button of Array.from(root.querySelectorAll("button[data-history]"))) {
    const action = byToken.get(button.dataset.history);
    if (action === undefined) {
      throw new Error(`no history action for data-history="${button.dataset.history}"`);
    }
    bound.set(action.token, button);
    button.addEventListener("click", () => {
      // History moves the document, so a view-only page leaves it alone.
      if (isViewOnly()) {
        return;
      }
      try {
        // Same step as the keyboard path, and the same function: the kernel
        // moves the history, and the pictures of the elements the scene no
        // longer holds are released with it. Repaint only when the kernel says
        // the scene actually moved — an undo with nothing to undo leaves
        // `canUndo()` exactly as it was, so the toolbar is already showing the
        // truth and a repaint would be a lie about having changed something.
        if (stepHistory(session, action.act)) {
          paintFn();
        }
      } catch (error) {
        onError(error);
      }
    }, { signal });
  }

  const missing = HISTORY_ACTIONS.filter((action) => !bound.has(action.token)).map(
    (action) => action.token,
  );
  if (missing.length > 0) {
    throw new Error(`the history toolbar has no button for ${missing.join(", ")}`);
  }

  return {
    /**
     * Say what the history can do, from the answer the frame carried.
     *
     * The paint reads one frame and hands this its `canUndo`/`canRedo`, so the
     * toolbar's truth is the same crossing the canvas's is — the kernel is not
     * asked a second time per paint for an answer it already gave.
     *
     * @param {{canUndo: boolean, canRedo: boolean}} available the frame's own answer.
     */
    sync(available) {
      for (const { token, available: name } of HISTORY_ACTIONS) {
        // `disabled`, not a dimmed class: it is the platform's own reason a click never
        // reaches the listener above, so the flag and the behaviour cannot disagree.
        bound.get(token).disabled = !available[name];
      }
    },
  };
}
