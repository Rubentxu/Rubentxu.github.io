// The type settings: typeface, size and the two alignments of a selected text.
//
// Like the colour pickers, these are not rows of the `STYLES` table: the typeface and
// the alignments are closed lists, but they only exist for one kind of element, and the
// size is a number. What they share with every other control is the contract that
// matters — one write door (`setStyle`), the whole selection per gesture (one undo), and
// a `sync` fed by the parsed `stylesOf` so the panel costs one crossing per frame.
//
// The kernel is the authority on every value here. The typefaces listed are the ones the
// build ships a face for (`setStyle` refuses any other by name), and the size bounds are
// the door's: this module only keeps a typed number from crossing when the door would
// refuse it, so the entry can say so instead of the status line.

import { FONT_FAMILIES } from "./vocabulary.mjs";
import { stylePatch } from "./style-toolbar.mjs";

/**
 * The closed lists, one row per property. The row's key is the patch key and the key
 * `stylesOf` answers under, so reading and writing speak one word.
 */
export const TEXT_CHOICES = Object.freeze({
    fontFamily: Object.freeze(FONT_FAMILIES.map(({ name }) => name)),
    textAlign: Object.freeze(["left", "center", "right"]),
    verticalAlign: Object.freeze(["top", "middle", "bottom"]),
});

/** The size range the door accepts, in pixels. */
export const SIZE_RANGE = Object.freeze({ min: 1, max: 400 });

/**
 * The size a typed value names, or `null` when the door would refuse it.
 *
 * @param {string} text what the person typed.
 * @returns {number | null}
 */
export function parseSize(text) {
    const trimmed = String(text).trim();
    if (trimmed === "") {
        return null;
    }
    const size = Number(trimmed);
    return Number.isFinite(size) && size >= SIZE_RANGE.min && size <= SIZE_RANGE.max ? size : null;
}

/**
 * Bind the text panel.
 *
 * The buttons are built from `TEXT_CHOICES`, so a choice exists in one place. The size
 * entry writes on `change`, not per keystroke, for the same reason the hex entry does: a
 * write per keystroke would be one undo entry per digit.
 *
 * `sync(styles)` lights the button each property's whole selection shares, fills the
 * size, and shows the row only when the selection holds a text (the kernel answers
 * `null` for a selection with no text in it). A property where the texts disagree
 * answers `"mixed"`: nothing is lit and the row says `data-mixed`.
 *
 * @param {object} options
 * @param {Element} options.host the row; it holds the size entry (`input`).
 * @param {object} options.session the frontier: `selectedIds()` and `setStyle(ids, patch)`.
 * @param {() => void} options.paintFn the repaint.
 * @param {(tag: string) => Element} options.createElement makes the buttons.
 * @param {(error: unknown) => void} [options.onError] the rejection path.
 * @param {AbortSignal} [options.signal] when it aborts, the listeners this binder added are removed.
 * @param {(key: string, source: string) => string} [options.text] the words of a choice.
 * @param {{fontFamily: Element, fontSize: Element, textAlign: Element, verticalAlign: Element}} [options.hosts]
 *   the per-property sections, when the page draws each as its own `fieldset`.
 *   A single `host` is still supported for a caller that draws them together.
 * @returns {{sync: (styles: object | null) => void}}
 */
export function bindTextStyle({
    host,
    hosts = null,
    session,
    paintFn,
    createElement,
    onError = (e) => {
        throw e;
    },
    signal,
    text = (_key, source) => source,
}) {
    const entry = (hosts?.fontSize ?? host).querySelector("input");
    if (!entry) {
        throw new Error("text-style: the host carries no size entry");
    }
    const write = (property, value) => {
        const ids = session.selectedIds();
        try {
            session.setStyle(ids, stylePatch(property, value));
        } catch (error) {
            onError(error);
            return;
        }
        paintFn();
    };
    const buttons = [];
    for (const [property, choices] of Object.entries(TEXT_CHOICES)) {
        for (const choice of choices) {
            const button = createElement("button");
            button.setAttribute("type", "button");
            button.setAttribute("data-text-property", property);
            button.setAttribute("data-text-choice", choice);
            // The choice's own word is the patch value; what the person reads is
            // the localized label of that value, and the family's name is the
            // name of a face (a proper noun) rather than a word to translate.
            const label =
                property === "fontFamily"
                    ? choice
                    : text(`text.${property === "textAlign" ? "align" : property}.${choice}`, choice);
            button.setAttribute("title", label);
            button.textContent = label;
            if (property === "fontFamily") {
                // The button wears its own face, so the list reads as a specimen.
                button.style.fontFamily = choice;
            }
            button.addEventListener("click", () => write(property, choice), { signal });
            (hosts?.[property] ?? host).appendChild(button);
            buttons.push({ button, property, choice });
        }
    }
    entry.addEventListener("change", () => {
        const size = parseSize(entry.value);
        if (size === null) {
            // The door would refuse it: the entry says so and keeps what was typed.
            entry.setAttribute("aria-invalid", "true");
            return;
        }
        entry.removeAttribute("aria-invalid");
        write("fontSize", size);
    }, { signal });
    return {
        sync(styles) {
            const present = styles !== null && styles.textAlign != null;
            if (hosts === null) {
                host.hidden = !present;
            }
            if (!present) {
                return;
            }
            let mixed = false;
            for (const { button, property, choice } of buttons) {
                button.classList.toggle("is-active", styles[property] === choice);
            }
            for (const property of Object.keys(TEXT_CHOICES)) {
                mixed ||= styles[property] === "mixed";
            }
            if (typeof styles.fontSize === "number") {
                entry.value = String(styles.fontSize);
                entry.removeAttribute("aria-invalid");
            } else {
                entry.value = "";
                mixed = true;
            }
            for (const target of hosts === null ? [host] : Object.values(hosts)) {
                if (target === null || target === undefined) continue;
                if (mixed) {
                    target.setAttribute("data-mixed", "true");
                } else {
                    target.removeAttribute("data-mixed");
                }
            }
        },
    };
}
