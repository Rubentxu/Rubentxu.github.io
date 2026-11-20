// The two presentation modes: zen and view, and what each one takes away.
//
// # What this file is
//
// Both modes are *ephemeral*: they change what the page shows and what the
// pointer may do, and they change nothing in the document. Neither one has
// ever crossed the kernel — a drawing that looks different because the user
// hid the controls is the same drawing — and neither one survives this module.
//
// - **Zen mode** (`Alt+Z`, upstream's own key, `actionToggleZenMode.tsx:34-35`)
//   hides the control panel so the drawing fills the page. Upstream reaches
//   the same answer with a class on the app shell and a transition on the
//   panels (`App.tsx:2410`, `LayerUI.tsx:402-404`); the port hides the panel
//   with the `hidden` attribute, which is the same statement without the CSS.
// - **View mode** (`Alt+R`, `actionToggleViewMode.tsx:34-35`) takes the
//   document away from the pointer: the canvas keeps showing the drawing, the
//   view keeps panning and zooming, and nothing can be selected, moved or
//   drawn. Upstream disables the pointer on the editing surfaces
//   (`App.tsx:2300`); the port asks the pointer pipeline to refuse every
//   editing press, which is the same answer at the one place gestures are born.
//
// # What the two modes are not
//
// They are not persisted, and they are not a fact about the document. A page
// reload comes back with both off, and a drawing opened in view mode opens
// editable somewhere else — the mode lives in the page the way the pan lives
// in the page, and for the same reason.
//
// # Why the whole panel hides and not its children
//
// `ZEN_HIDDEN` names the panel container and not the fourteen controls inside
// it. The container is the panel upstream's zen mode hides — one transition
// over one wrapper — and a list of children would need a new entry for every
// control added to the bar forever, with the failure mode that a forgotten
// entry survives the mode the rest of the page obeys. Hiding the container
// hides whatever the bar holds today.

/**
 * The ids zen mode hides, in the order it hides them.
 *
 * One entry today, and that is a fact about the page and not a placeholder:
 * the demo page's whole control surface hangs from the one `#toolbar` div,
 * and the status line stays out of the list on purpose — it is the surface
 * that says how to come back.
 *
 * @type {string[]}
 */
export const ZEN_HIDDEN = Object.freeze(["toolbar"]);

/**
 * The attributes the page carries while a mode is on.
 *
 * The attributes are the fact the rest of the page can read without asking
 * this module — the same contract the theme's `data-theme` is — and they are
 * read back by nothing today except the tests. A future rule about what the
 * page looks like in a mode has a place to hang without a second state.
 *
 * @type {object}
 */
export const PRESENTATION_ATTRIBUTES = Object.freeze({
    zen: "data-zen",
    view: "data-view",
});

/**
 * A fresh presentation state: both modes off.
 *
 * The state is two booleans, and nothing else — a mode has no degrees, and a
 * third mode would be a third row in the toggle the commands registry names.
 *
 * @returns {{ zen: boolean, view: boolean }}
 */
export function createPresentationState() {
    return { zen: false, view: false };
}

/**
 * Flip one mode. Answers with the mode's new value.
 *
 * @param {{ zen: boolean, view: boolean }} state The presentation state, mutated in place.
 * @param {"zen" | "view"} mode The mode to flip.
 * @returns {boolean} Whether the mode is now on.
 */
export function toggleMode(state, mode) {
    state[mode] = !state[mode];
    return state[mode];
}

/**
 * Whether the pointer may edit the document right now.
 *
 * View mode is the one thief: zen hides controls and takes nothing the
 * pointer could do. The question is asked once, where the gesture is about
 * to be born, and the answer is the mode's whole effect on the canvas.
 *
 * @param {{ view: boolean }} state The presentation state.
 * @returns {boolean}
 */
export function editingAllowed(state) {
    return state.view !== true;
}

/**
 * Put the modes on the page.
 *
 * Two writes: the `hidden` attribute on every panel zen hides, and the two
 * attributes on the root. Both are idempotent — applying the state the page
 * already shows changes nothing — because the function answers "what the page
 * should show", not "what just changed", and a caller that applies after every
 * toggle cannot drift from the state it toggles.
 *
 * A panel the root does not hold is skipped: the demo page and an embedder's
 * mount carry the same markup by contract, but a root that lost a panel has
 * nothing to hide, and refusing there would refuse the mode itself.
 *
 * @param {Element} root The mount's root.
 * @param {{ zen: boolean, view: boolean }} state The presentation state.
 * @returns {void}
 */
export function applyPresentation(root, state) {
    for (const id of ZEN_HIDDEN) {
        const panel = root.querySelector(`#${id}`);
        if (panel !== null) {
            panel.hidden = state.zen;
        }
    }
    setAttributeIf(root, PRESENTATION_ATTRIBUTES.zen, state.zen);
    setAttributeIf(root, PRESENTATION_ATTRIBUTES.view, state.view);
}

/**
 * Write or clear one attribute, the way the browser's own booleans behave.
 *
 * @param {Element} root The element.
 * @param {string} name The attribute.
 * @param {boolean} on Whether it should be there.
 * @returns {void}
 */
function setAttributeIf(root, name, on) {
    if (on) {
        root.setAttribute(name, "true");
    } else {
        root.removeAttribute(name);
    }
}
