// The colour pickers: a palette and a hex entry for each of the two inks.
//
// A colour is text, not a vocabulary, so the pickers are not rows of the `STYLES`
// table: there is no closed list of tokens for the kernel to answer from. What they
// share with the button rows is the contract that matters — one write door
// (`setStyle`), the whole selection per gesture (one undo), and a `sync` fed by the
// parsed `stylesOf` so the panel costs one crossing per frame.
//
// The kernel is the authority on what a colour is (`colour::writable`: hex of 3, 4, 6
// or 8 digits, or `transparent`). `normaliseColour` here only repairs what a person
// types — a missing `#`, upper case, stray spaces — so that the entry does not refuse
// what the kernel would take; it never accepts something the kernel refuses.

import { applyDarkModeFilter, swatchNeedsOutline } from "./dark-colour.mjs";
import { stylePatch } from "./style-toolbar.mjs";

/**
 * The swatches of each ink, as upstream's palette lists them in its first row of each
 * group (`packages/common/src/colors.ts`): the default ink, then the four hues most
 * drawings use. The background row starts with the "no fill" swatch.
 */
export const PALETTE = Object.freeze({
    strokeColor: Object.freeze(["#1e1e1e", "#e03131", "#2f9e44", "#1971c2", "#f08c00"]),
    backgroundColor: Object.freeze(["transparent", "#ffc9c9", "#b2f2bb", "#a5d8ff", "#ffec99"]),
});

const HEX = /^[0-9a-f]+$/;

/**
 * The colour a typed value names, in the spelling the kernel stores, or `null`.
 *
 * @param {string} text what the person typed.
 * @returns {string | null}
 */
export function normaliseColour(text) {
    const value = String(text).trim().toLowerCase();
    if (value === "transparent") {
        return value;
    }
    const digits = value.startsWith("#") ? value.slice(1) : value;
    if ([3, 4, 6, 8].includes(digits.length) && HEX.test(digits)) {
        return `#${digits}`;
    }
    return null;
}

/**
 * Bind one ink's picker.
 *
 * The swatches are built from `PALETTE` rather than written in the markup, so the
 * colours exist in one place and a swatch cannot name a colour the table does not.
 * The hex entry writes on `change` (Enter or leaving the field), not per keystroke: a
 * write per keystroke would be one undo entry per character.
 *
 * `sync(styles)` lights the swatch whose colour the whole selection shares and fills
 * the entry with it. When the selection disagrees (`"mixed"`) nothing is lit and the
 * row says `data-mixed`; with nothing selected the row hides.
 *
 * @param {object} options
 * @param {Element} options.host the row; it holds the hex entry (`input`).
 * @param {"strokeColor" | "backgroundColor"} options.property the patch key it writes.
 * @param {object} options.session the frontier: `selectedIds()` and `setStyle(ids, patch)`.
 * @param {() => void} options.paintFn the repaint.
 * @param {(tag: string) => Element} options.createElement makes the swatches.
 * @param {(error: unknown) => void} [options.onError] the rejection path.
 * @param {AbortSignal} [options.signal] when it aborts, the listeners this binder added are removed.
 * @param {(key: string, source: string) => string} [options.text] the words of the swatches.
 * @param {() => string} [options.theme] the theme on the page; the dark one turns
 *   every swatch over with upstream's filter before it is shown, and never
 *   changes the colour the click writes.
 * @returns {{sync: (styles: object | null) => void}}
 */
export function bindColourPicker({
    host,
    property,
    session,
    paintFn,
    createElement,
    onError = (e) => {
        throw e;
    },
    signal,
    text = (_key, source) => source,
    theme = () => "light",
}) {
    const swatches = PALETTE[property];
    if (swatches === undefined) {
        throw new Error(`colour-picker: ${property} is not an ink`);
    }
    const entry = host.querySelector("input");
    if (!entry) {
        throw new Error("colour-picker: the host carries no hex entry");
    }
    const write = (colour) => {
        const ids = session.selectedIds();
        try {
            session.setStyle(ids, stylePatch(property, colour));
        } catch (error) {
            onError(error);
            return;
        }
        paintFn();
    };
    const buttons = swatches.map((colour) => {
        const button = createElement("button");
        button.setAttribute("type", "button");
        button.setAttribute("data-colour", colour);
        const label = colour === "transparent" ? text("ui.no-colour", "No colour") : colour;
        button.setAttribute("title", label);
        button.setAttribute("aria-label", label);
        button.classList.add("swatch");
        // The outline is upstream's `has-outline`: a near-white swatch on a
        // near-white panel is a swatch nobody sees, and the class is decided by
        // the colour the **document** carries so the ring does not flip when the
        // theme turns the colour over.
        button.classList.toggle("has-outline", swatchNeedsOutline(colour));
        // A transparent swatch is drawn by the stylesheet's checkerboard, not by
        // a colour: `backgroundColor` would paint over it. Every other swatch
        // gets its colour written here, because the dark theme shows a value
        // that is not the document's.
        if (colour !== "transparent") {
            button.style.backgroundColor = colour;
        } else {
            button.classList.add("is-transparent");
        }
        button.addEventListener("click", () => write(colour), { signal });
        host.appendChild(button);
        return button;
    });
    /**
     * Show every swatch in the theme that is on.
     *
     * The document keeps the colour it had; what changes is the value the
     * chrome shows for it — upstream's `applyDarkModeFilter`, the same
     * arithmetic the canvas's dark filter performs. The swatch's protocol word
     * (`data-colour`) is never rewritten, so a click still writes the document
     * colour and a sync still compares it against the document.
     */
    const paintSwatches = () => {
        const dark = theme() === "dark";
        for (const button of buttons) {
            const colour = button.getAttribute("data-colour");
            // "No colour" is a value like any other: upstream writes its filtered
            // spelling too (`transparent` light, `#ededed00` dark) over the
            // checkerboard, and the result is the same nothing in both themes.
            button.style.backgroundColor = applyDarkModeFilter(colour, dark);
        }
    };
    paintSwatches();
    let shownDark = theme() === "dark";
    entry.addEventListener("change", () => {
        const colour = normaliseColour(entry.value);
        if (colour === null) {
            // A value the kernel would refuse never crosses: the entry says so and
            // keeps what was typed, so the person can correct it rather than retype.
            entry.setAttribute("aria-invalid", "true");
            return;
        }
        entry.removeAttribute("aria-invalid");
        entry.value = colour;
        write(colour);
    }, { signal });
    return {
        sync(styles) {
            // The theme is read on every sync and the swatches are repainted only
            // when it moved: the panel syncs once per frame, and a per-frame
            // recomputation of five colours would be work the frame already knew.
            const dark = theme() === "dark";
            if (dark !== shownDark) {
                shownDark = dark;
                paintSwatches();
            }
            host.hidden = styles === null;
            if (styles === null) {
                return;
            }
            const shared = styles[property];
            const mixed = shared === "mixed";
            if (mixed) {
                host.setAttribute("data-mixed", "true");
            } else {
                host.removeAttribute("data-mixed");
            }
            for (const button of buttons) {
                button.classList.toggle("is-active", button.getAttribute("data-colour") === shared);
            }
            if (!mixed && typeof shared === "string") {
                entry.value = shared;
                entry.removeAttribute("aria-invalid");
            }
        },
    };
}
