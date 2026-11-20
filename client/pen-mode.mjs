// Pen mode: the switch that tells a touch "you are not a pen".
//
// Upstream's PenModeButton (`Toolbar.tsx`) toggles `appState.penMode`; with it
// on, the stylus draws and a finger pans. The state is the page's, not the
// document's — it is a property of the hand on this glass, not of the drawing —
// so it lives here and nowhere in the scene.
//
// The button is a toggle from the chrome's own primitive: the same
// `ToolIcon--checked` class and `aria-pressed` the tools carry, written from
// one reading so neither can go stale beside the other.

/** The page's pen-mode switch, with the one bit it owns. */
export function createPenMode({ initial = false } = {}) {
    let on = initial;
    return {
        isOn: () => on,
        set(value) {
            on = value === true;
            return on;
        },
        toggle() {
            on = !on;
            return on;
        },
    };
}

/**
 * Wire a pen-mode button to the switch: a click toggles it, and the button's
 * two writings (the attribute and the class) follow the state.
 *
 * @param {{ button: Element, penMode: { isOn: () => boolean, toggle: () => boolean }, onChange?: () => void, signal?: AbortSignal }} options
 * @returns {{ sync: () => void }} the refresher, for a caller that changes the state elsewhere.
 */
export function bindPenModeButton({ button, penMode, onChange = () => {}, signal }) {
    const sync = () => {
        const on = penMode.isOn();
        button.setAttribute("aria-pressed", on ? "true" : "false");
        button.classList.toggle("ToolIcon--checked", on);
    };
    button.addEventListener("click", () => {
        penMode.toggle();
        sync();
        onChange();
    }, { signal });
    sync();
    return { sync };
}
