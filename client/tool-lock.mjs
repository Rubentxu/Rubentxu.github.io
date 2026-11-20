// Tool lock: keep the pen in the hand after the shape lands.
//
// Upstream's LockButton (`Toolbar.tsx`) toggles `appState.activeTool.locked`:
// with it on, a creation leaves the tool armed; with it off — upstream's
// default — the creation hands the page back to the selection. The state is a
// property of the hand's intent, not of the drawing, so it lives with the page
// and nowhere in the scene.
//
// The button wears upstream's two drawings: the closed padlock when the tool
// is kept, the open one when it is handed back. The icon is the state's second
// writing, beside `aria-pressed` and `ToolIcon--checked`.

/** The page's tool-lock switch. */
export function createToolLock({ initial = false } = {}) {
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
 * Wire a tool-lock button to the switch: a click toggles it, and the button's
 * attribute, class and icon follow the state.
 *
 * @param {{ button: Element, toolLock: { isOn: () => boolean, toggle: () => boolean },
 *           icons: { on: string, off: string }, onChange?: () => void, signal?: AbortSignal }} options
 * @returns {{ sync: () => void }}
 */
export function bindToolLockButton({ button, toolLock, icons, onChange = () => {}, signal }) {
    const box = button.querySelector(".ToolIcon__icon");
    const sync = () => {
        const on = toolLock.isOn();
        button.setAttribute("aria-pressed", on ? "true" : "false");
        button.classList.toggle("ToolIcon--checked", on);
        if (box !== null) {
            box.innerHTML = on ? icons.on : icons.off;
        }
    };
    button.addEventListener("click", () => {
        toolLock.toggle();
        sync();
        onChange();
    }, { signal });
    sync();
    return { sync };
}
