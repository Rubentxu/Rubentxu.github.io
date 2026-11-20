// The canvas footer, upstream's `Footer.tsx` in the page: the zoom group and
// the undo/redo group in the bottom-left corner, and the help button in the
// bottom-right one.
//
// # Why this is not a second toolbar
//
// The binders already own what the buttons *do* (`zoom-toolbar.mjs` and
// `history-toolbar.mjs`); this module owns only what the reference draws and
// the page's markup cannot carry: the iconary's drawings, on buttons whose
// token stays in a `data-` attribute, and the second door to the help sheet.
// The table below is the one place that says which icon belongs to which
// token, the same shape `style-icons.mjs` uses for the style rows.
//
// # Why the icons are injected and not written in the markup
//
// `client/chrome-icons.mjs` is generated from the reference's `icons.tsx`, and
// a hand-copied SVG in `index.html` would be a second copy of a drawing the
// generator owns. The markup therefore carries the empty button and its token;
// this module puts the drawing in the box the chrome's stylesheet already draws
// hover, active and disabled states for (`client/chrome.mjs`).
//
// # Why the history buttons lose their words
//
// Upstream's undo and redo are icon buttons (`.undo-redo-buttons`), not a pair
// of text buttons, and the footer's two groups are the reference's two
// 36-pixel-wide islands. A text button cannot be 36 pixels wide and say
// "Deshacer", so the name moves to `aria-label` — where a screen reader reads
// it either way — and the drawing says it to the eye.

import { CHROME_ICONS } from "./chrome-icons.mjs";

/** The icon upstream draws for each footer token, by the attribute that names it. */
export const FOOTER_ICONS = Object.freeze({
    zoom: Object.freeze({
        out: "ZoomOutIcon",
        in: "ZoomInIcon",
    }),
    history: Object.freeze({
        undo: "UndoIcon",
        redo: "RedoIcon",
    }),
});

/** The classes upstream's `IconButton` puts on a plain icon button. */
const TOOL_ICON_CLASSES = Object.freeze([
    "ToolIcon",
    "ToolIcon_size_medium",
    "ToolIcon_type_button",
    "ToolIcon--plain",
    "ToolIcon_type_button--show",
]);

/** The inner box whose hover, active and disabled states the chrome draws. */
const ICON_BOX_CLASS = "ToolIcon__icon";

/**
 * Put the drawing inside a button, in the inner box upstream's button uses.
 *
 * @param {Document} document the page's own.
 * @param {Element} button the footer button.
 * @param {string} icon the iconary's SVG.
 * @returns {void}
 */
function wearIcon(document, button, icon) {
    button.classList.add(...TOOL_ICON_CLASSES);
    const box = document.createElement("div");
    box.classList.add(ICON_BOX_CLASS);
    box.setAttribute("aria-hidden", "true");
    box.setAttribute("aria-disabled", "false");
    box.innerHTML = CHROME_ICONS[icon];
    button.replaceChildren(box);
}

/**
 * Put the footer's icons where the reference draws them, once.
 *
 * A token the table does not name is left alone: the reset readout is text and
 * upstream draws it as text, so it wears the button's shell but no icon. The
 * help button is not a token — it is one fixed drawing — but it is decorated
 * here because it belongs to the same surface.
 *
 * Idempotent: a second call finds the icons already in place and does nothing,
 * which matters because a panic rebuild boots the page's binders again.
 *
 * @param {Document} document the page's own.
 * @returns {number} how many controls were decorated.
 */
export function decorateFooterIcons(document) {
    let decorated = 0;
    for (const attribute of ["data-zoom", "data-history"]) {
        const family = attribute === "data-zoom" ? FOOTER_ICONS.zoom : FOOTER_ICONS.history;
        for (const button of document.querySelectorAll(`button[${attribute}]`)) {
            const token = button.getAttribute(attribute);
            const icon = family[token];
            const box = button.querySelector(`.${ICON_BOX_CLASS}`);
            if (icon === undefined) {
                // The readout: upstream's text button, still in the icon
                // button's shell so it takes the same focus ring and radius.
                if (token === "reset" && !button.classList.contains("ToolIcon")) {
                    button.classList.add(...TOOL_ICON_CLASSES);
                    decorated += 1;
                }
                continue;
            }
            if (box !== null) {
                continue;
            }
            wearIcon(document, button, icon);
            decorated += 1;
        }
    }
    const help = document.querySelector("button[data-help]");
    if (help !== null && !help.classList.contains("help-icon")) {
        help.classList.add("help-icon");
        help.innerHTML = CHROME_ICONS.HelpIcon;
        decorated += 1;
    }
    return decorated;
}

/**
 * Make the footer's help button open the shortcuts sheet.
 *
 * The button is the reference's `?` in the bottom-right corner (`Footer.tsx`,
 * `HelpButton.tsx`), and it opens the same sheet the menu's Help row opens:
 * `onOpen` is the caller's door, so there is one dialog and not a second copy
 * of it in a second place.
 *
 * A footer without the button is a page defect rather than an optional
 * surface: a corner that promises help and has no control is worse than no
 * corner, and a silent return would hide it until someone clicks.
 *
 * @param {object} options
 * @param {Element} options.root the footer.
 * @param {() => void} options.onOpen what the click does.
 * @param {AbortSignal} [options.signal] when it aborts, the listener comes off.
 * @returns {Element} the button, for the caller that wants it.
 */
export function bindFooterHelp({ root, onOpen, signal }) {
    const button = root?.querySelector("button[data-help]") ?? null;
    if (button === null) {
        throw new Error("the footer has no help button");
    }
    button.addEventListener("click", () => onOpen(), { signal });
    return button;
}
