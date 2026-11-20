// Which keyboard scope a key press belongs to.
//
// The canvas is one scope and the DOM's own controls are another: a tree, a
// menu, a dialog or a combobox owns Tab, the arrows, Space and Enter while the
// focus is inside it, and the page's shortcuts must not fire underneath. The
// page grew up with text entries as the only exception; an ARIA widget is the
// same fact with a different shape, so the question is asked once here.
//
// The path is read with `composedPath`, not `event.target`, because a widget
// may live in a shadow root (the embedded host is one) and `closest` from the
// target stops at the shadow boundary. The path crosses it, and every node on
// it is asked whether it is a control or a widget container.

/** The roles whose contents own the navigation keys. */
export const WIDGET_ROLES = Object.freeze([
    "tree",
    "treeitem",
    "grid",
    "gridcell",
    "menu",
    "menubar",
    "menuitem",
    "dialog",
    "alertdialog",
    "listbox",
    "option",
    "combobox",
    "tablist",
    "tab",
    "toolbar",
    "radiogroup",
    "spinbutton",
    "slider",
    "switch",
    "searchbox",
    "textbox",
]);

/** The elements a press belongs to when it lands on them (Space, typing). */
const CONTROL_SELECTOR = "button, select, option, a[href], input, textarea, summary, [contenteditable=''], [contenteditable='true']";

/**
 * The nodes the event travelled through, nearest first.
 *
 * A fake event may carry only a target; the path is then the target alone.
 *
 * @param {{ composedPath?: () => unknown[], target?: unknown } | null | undefined} event
 * @returns {unknown[]}
 */
export function eventPath(event) {
    if (event === null || event === undefined) {
        return [];
    }
    if (typeof event.composedPath === "function") {
        const path = event.composedPath();
        if (Array.isArray(path) && path.length > 0) {
            return path;
        }
    }
    return event.target === undefined ? [] : [event.target];
}

function roleOf(node) {
    const role = typeof node?.getAttribute === "function" ? node.getAttribute("role") : undefined;
    return typeof role === "string" ? role.trim().toLowerCase() : "";
}

function matches(node, selector) {
    return typeof node?.matches === "function" && node.matches(selector);
}

/**
 * Is this key press inside a widget that owns the navigation keys?
 *
 * @param {{ composedPath?: () => unknown[], target?: unknown } | null | undefined} event
 * @returns {boolean}
 */
export function isWidgetTarget(event) {
    const path = eventPath(event);
    return path.some((node) => {
        const role = roleOf(node);
        if (role !== "" && WIDGET_ROLES.includes(role)) {
            return true;
        }
        // A tree item's focusable node is often a plain `div` inside the
        // `role=tree`; the path carries the container above it.
        return typeof node?.closest === "function"
            && node.closest("[role='tree'], [role='grid'], [role='menu'], [role='dialog'], [role='listbox'], [role='combobox'], [role='tablist']") !== null;
    });
}

/**
 * Is this press on a control the keyboard belongs to?
 *
 * Includes the widgets: pressing Space on a tree item must not arm the pan, and
 * pressing it on a button must click the button.
 *
 * @param {unknown} target the node the event landed on.
 * @param {{ composedPath?: () => unknown[], target?: unknown } | null | undefined} [event]
 * @returns {boolean}
 */
export function isControlTarget(target, event = null) {
    const path = event === null ? (target === undefined ? [] : [target]) : eventPath(event);
    return path.some((node) => {
        if (node === null || node === undefined) {
            return false;
        }
        if (node.isContentEditable === true) {
            return true;
        }
        if (matches(node, CONTROL_SELECTOR)) {
            return true;
        }
        const role = roleOf(node);
        return role !== "" && WIDGET_ROLES.includes(role);
    });
}
