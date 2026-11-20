// The context menu: a view of the command registry.
//
// # What this file is
//
// The reference editor's menu filters a central registry of actions by their
// predicate. This is the same shape, with the registry in `client/commands.mjs`
// and the predicate on each command.
//
// The menu draws what the registry says and knows nothing else: it does not
// decide which commands exist, what they are called, or when they are
// allowed. Two views of one registry is the whole point — the keyboard and the
// menu cannot disagree about what `Ctrl+Shift+L` means, because neither of
// them is allowed to have an opinion of its own.
//
// # What the menu owes the keyboard
//
// While the menu is open it owns the keyboard. `index.js` asks
// `isOpen()` before it looks at a key press, because a menu that leaves the
// page's shortcuts live underneath it is a menu where `v` switches the tool
// and `Escape` clears the selection while the user is choosing an item.
//
// # Why the focus moves
//
// The first item takes the focus when the menu opens, the arrow keys move it,
// and `Escape` gives it back. That is what makes the menu reachable without a
// mouse: a keyboard user opens it and walks it.
//
// # Why the outside click is a listener that only exists while the menu is open
//
// The listener is added when the menu opens and removed when it closes, so a
// page with no menu open has no listener on it at all. The alternative — a
// permanent listener that checks whether the menu is open — is a listener that
// runs on every pointer press of the page forever, for a menu that is closed
// ninety-nine per cent of the time.

import { menuSections } from "./commands.mjs";

/**
 * The gap the reference leaves between a popover and the edge it is clamped
 * against (`components/Popover.tsx`, `POPOVER_CONTAINER_GAP`).
 */
export const MENU_VIEWPORT_GAP = 10;

/**
 * A menu box fitted into the viewport the way the reference fits it.
 *
 * The reference does not flip the menu: it clamps the point and, when the menu
 * is larger than the window allows, shrinks it to the window and scrolls the
 * overflow inside it (`Popover.tsx`, the `fitInViewport` layout effect). The
 * two branches are literal: only a menu that is at least as large as the
 * window is shrunk, and everything else slides along the axis until it fits.
 *
 * @param {{ x: number, y: number, width: number, height: number, viewportWidth: number, viewportHeight: number, gap?: number }} box
 *   The point the menu was asked for, its size and the viewport's.
 * @returns {{ left: number, top: number, width: number|null, height: number|null, overflowX: string|null, overflowY: string|null }}
 *   The fitted box; `width`/`height` are only set when the menu had to shrink.
 */
export function fitMenuToViewport({ x, y, width, height, viewportWidth, viewportHeight, gap = MENU_VIEWPORT_GAP }) {
    const fitted = { left: x, top: y, width: null, height: null, overflowX: null, overflowY: null };
    const maxWidth = Math.max(0, viewportWidth - gap * 2);
    if (width >= maxWidth) {
        fitted.width = maxWidth;
        fitted.left = gap;
        fitted.overflowX = "scroll";
    } else {
        fitted.left = Math.min(Math.max(x, gap), viewportWidth - gap - width);
    }
    const maxHeight = Math.max(0, viewportHeight - gap * 2);
    if (height >= maxHeight) {
        fitted.height = maxHeight;
        fitted.top = gap;
        fitted.overflowY = "scroll";
    } else {
        fitted.top = Math.min(Math.max(y, gap), viewportHeight - gap - height);
    }
    return fitted;
}

/**
 * The menu, bound to a container.
 *
 * `createElement` is injected for the same reason `client/tool-toolbar.mjs`
 * injects it: the module builds its own DOM, and a factory is what lets it be
 * exercised under `node --test` without a browser.
 *
 * `doc` is the document the outside click is heard on. It is injected rather
 * than reached for, so that the test can hand over a fake that records the
 * listeners it was given.
 *
 * `view` is the window the menu is clamped to. It is the document's default
 * view in the page and is injected in the tests, so the clamp is measured
 * against a viewport a test can name.
 *
 * `signal` ends the menu: its abort closes the menu and takes every listener it put on the page off.
 *
 * @param {{ root: Element, createElement: (tag: string) => Element, doc: Document, view?: object, run: (id: string) => void, labelOf?: (entry: object) => string, signal?: AbortSignal }} options
 * @returns {{ open: (where: string, state: object, x: number, y: number) => void, close: () => void, isOpen: () => boolean }}
 */
export function bindContextMenu({ root, createElement, doc, view = doc.defaultView ?? null, run, labelOf = (entry) => entry.label, signal }) {
    /** The items currently on screen, in order. The arrow keys walk this. */
    let items = [];
    let open = false;
    /** Where the focus was when the menu opened, so that it can go back. */
    let restoreFocusTo = null;

    /**
     * Write the width half of a fit, or clear it when the menu fits.
     *
     * The menu's own `min-width` is the readable width of a row; a window
     * narrower than that wins, so the minimum is lifted while the menu is
     * shrunk and restored with the next measurement.
     *
     * @param {{ width: number|null, overflowX: string|null }} fitted
     */
    function applyWidth(fitted) {
        if (fitted.width === null) {
            root.style.width = "";
            root.style.minWidth = "";
            root.style.overflowX = "";
            return;
        }
        root.style.width = `${fitted.width}px`;
        root.style.minWidth = "0px";
        root.style.overflowX = fitted.overflowX;
    }

    /**
     * Put the menu at a point, fitted into the viewport.
     *
     * The fit happens when the menu opens and not on a later resize: the
     * reference's own `Popover` returns early from its layout effect when the
     * requested point has not changed (`Popover.tsx`, `lastInitializedPosRef`),
     * so resizing the window leaves its open menu where it was. Parity here is
     * the absence of a listener.
     *
     * The size is measured after the rows are in the page and the menu is no
     * longer hidden, because a menu that is not laid out has no size to fit.
     * The dimensions written by an earlier fit are cleared first, so the
     * measurement is the menu's own and not the previous window's answer.
     *
     * @param {number} x The point, in viewport pixels.
     * @param {number} y The point, in viewport pixels.
     */
    function place(x, y) {
        root.style.left = `${x}px`;
        root.style.top = `${y}px`;
        root.style.width = "";
        root.style.height = "";
        root.style.minWidth = "";
        root.style.overflowX = "";
        root.style.overflowY = "";
        const viewportWidth = Number(view?.innerWidth);
        const viewportHeight = Number(view?.innerHeight);
        if (!Number.isFinite(viewportWidth) || !Number.isFinite(viewportHeight)
            || viewportWidth <= 0 || viewportHeight <= 0) {
            return;
        }
        if (typeof root.getBoundingClientRect !== "function") {
            return;
        }
        const box = root.getBoundingClientRect();
        let fitted = fitMenuToViewport({
            x, y, width: box.width, height: box.height, viewportWidth, viewportHeight,
        });
        applyWidth(fitted);
        // A width constraint can add a horizontal scrollbar, and the bar is
        // height the first measurement did not see. The reference measures the
        // popover once and can lose those pixels; the guarantee this menu owes
        // is that it never leaves the window, so the height is measured again
        // after the width has been settled.
        if (fitted.width !== null) {
            const reflowed = root.getBoundingClientRect();
            fitted = fitMenuToViewport({
                x, y, width: reflowed.width, height: reflowed.height, viewportWidth, viewportHeight,
            });
            applyWidth(fitted);
        }
        root.style.left = `${fitted.left}px`;
        root.style.top = `${fitted.top}px`;
        if (fitted.height !== null) {
            root.style.height = `${fitted.height}px`;
            root.style.overflowY = fitted.overflowY;
        }
    }

    /**
     * A pointer press outside the menu closes it.
     *
     * Capture, because the press that opened the menu is not this one: the menu
     * opens on the *release* of the secondary button, and this listener is
     * added after that. Without the capture it would still fire for a press
     * that lands on something else inside the page and is handled first.
     */
    function onOutsidePointerDown(event) {
        if (root.contains(event.target)) {
            return;
        }
        close();
    }

    /**
     * Close the menu and give the focus back to wherever it came from.
     *
     * The focus is restored because a menu that takes the focus and does not
     * give it back leaves the page with no focused element at all, and the
     * keyboard shortcuts — which live on `window` — would still work, but the
     * user would have no idea where they were.
     */
    function close() {
        if (!open) {
            return;
        }
        open = false;
        doc.removeEventListener("pointerdown", onOutsidePointerDown, true);
        root.replaceChildren();
        root.hidden = true;
        items = [];
        const previous = restoreFocusTo;
        restoreFocusTo = null;
        if (previous !== null && typeof previous.focus === "function") {
            previous.focus();
        }
    }

    /**
     * Move the focus by `step` items, wrapping around.
     *
     * Wrapping is what a menu does: the last item's next is the first, so a
     * user who holds the arrow key does not have to know how long the menu is.
     */
    function move(step) {
        if (items.length === 0) {
            return;
        }
        const at = items.indexOf(doc.activeElement);
        const from = at === -1 ? 0 : at;
        const next = (from + step + items.length) % items.length;
        items[next].focus();
    }

    root.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            close();
            return;
        }
        if (event.key === "ArrowDown") {
            event.preventDefault();
            event.stopPropagation();
            move(1);
            return;
        }
        if (event.key === "ArrowUp") {
            event.preventDefault();
            event.stopPropagation();
            move(-1);
            return;
        }
        if (event.key === "Home") {
            event.preventDefault();
            event.stopPropagation();
            if (items.length > 0) {
                items[0].focus();
            }
            return;
        }
        if (event.key === "End") {
            event.preventDefault();
            event.stopPropagation();
            if (items.length > 0) {
                items[items.length - 1].focus();
            }
            return;
        }
        if (event.key === "Tab") {
            // Leaving the menu with `Tab` closes it. The menu is a layer over
            // the page, and a layer the user has walked out of should not stay
            // there collecting the focus.
            close();
        }
    }, { signal });
    signal?.addEventListener("abort", close, { once: true });

    /**
     * Open the menu at a point, showing the commands that are available.
     *
     * @param {string} where Which menu: `canvas` or `element`.
     * @param {object} state The document's answer.
     * @param {number} x The point, in CSS pixels.
     * @param {number} y The point, in CSS pixels.
     */
    function openMenu(where, state, x, y) {
        // An open menu is replaced by the new one rather than stacked on it:
        // two menus at once is not a thing the user can have meant.
        close();
        const sections = menuSections(where, state);
        const built = [];
        const builtItems = [];
        for (const section of sections) {
            if (built.length > 0) {
                built.push(separator(createElement));
            }
            for (const entry of section.commands) {
                const button = item(createElement, entry, run, close, labelOf(entry), signal);
                built.push(button);
                builtItems.push(button);
            }
        }
        root.replaceChildren(...built);
        root.hidden = false;
        // The menu is placed after it is visible: the reference measures the
        // popover it just laid out, and a hidden element has no box to
        // measure. A menu that is larger than the window is shrunk and
        // scrolled, and one that would leave the window slides back in.
        place(x, y);
        items = builtItems;
        open = true;
        restoreFocusTo = doc.activeElement;
        doc.addEventListener("pointerdown", onOutsidePointerDown, { capture: true, signal });
        if (items.length > 0) {
            items[0].focus();
        }
    }

    return {
        open: openMenu,
        close,
        isOpen: () => open,
    };
}

/**
 * The line between two sections.
 *
 * `role="separator"` because that is what it is, and because a screen reader
 * reading a flat list of eleven buttons is not reading a menu.
 *
 * @param {(tag: string) => Element} createElement
 * @returns {Element}
 */
function separator(createElement) {
    const node = createElement("div");
    node.setAttribute("role", "separator");
    return node;
}

/**
 * One command, as a button.
 *
 * The label and the shortcut are two elements rather than one string, so that
 * the shortcut can sit at the other end of the row without a layout table:
 * `span` for the verb and `kbd` for the key, in a row that puts them apart.
 *
 * The button is a real `<button>` because it has to be reachable with the
 * keyboard, and a `div` with a click handler is not.
 *
 * @param {(tag: string) => Element} createElement
 * @param {object} entry The command.
 * @param {(id: string) => void} run What to call when it is chosen.
 * @param {() => void} close How the menu goes away.
 * @param {string} text What the command is called in the locale in use.
 * @param {AbortSignal} [signal] Its abort takes the row's listener off.
 * @returns {Element}
 */
function item(createElement, entry, run, close, text, signal) {
    const button = createElement("button");
    button.type = "button";
    button.setAttribute("role", "menuitem");
    button.dataset.command = entry.id;
    const label = createElement("span");
    label.textContent = text;
    const hint = createElement("kbd");
    hint.textContent = entry.hint;
    button.appendChild(label);
    button.appendChild(hint);
    button.addEventListener("click", () => {
        close();
        run(entry.id);
    }, { signal });
    return button;
}
