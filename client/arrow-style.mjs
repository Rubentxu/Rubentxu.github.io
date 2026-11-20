// The arrow settings: the head at each end of a line or an arrow, and whether it runs
// straight or bends through its points.
//
// Like the text settings, these are not rows of the `STYLES` table: they only exist for
// two kinds of element, so the row has to be able to vanish. What they share with every
// other control is the contract that matters — one write door (`setStyle`), the whole
// selection per gesture (one undo), and a `sync` fed by the parsed `stylesOf`.
//
// The kernel is the authority on every word here. `"elbow"` is read but never offered:
// turning an arrow into an elbow means routing it again, which a patch does not do.

import { stylePatch } from "./style-toolbar.mjs";

/** The heads the kernel draws, plus `"none"` for no head. */
export const HEADS = Object.freeze([
    "none",
    "arrow",
    "bar",
    "circle",
    "dot",
    "triangle",
    "diamond",
    "cardinality_one",
    "cardinality_many",
    "cardinality_one_or_many",
    "cardinality_exactly_one",
    "cardinality_zero_or_one",
    "cardinality_zero_or_many",
]);

/**
 * The rows, in order. The key is the patch key and the key `stylesOf` answers under, so
 * reading and writing speak one word.
 */
export const ARROW_CHOICES = Object.freeze({
    startArrowhead: HEADS,
    endArrowhead: HEADS,
    arrowType: Object.freeze(["sharp", "round"]),
});

/**
 * Bind the arrow panel.
 *
 * `sync(styles)` shows each row only when the kernel answers a word for it (`null` means
 * no line or arrow is selected), lights the choice the whole selection shares, and marks
 * the row `data-mixed` when the selected lines disagree. An elbow lights nothing.
 *
 * @param {object} options
 * @param {Element} options.host the container; it holds one row per property.
 * @param {object} options.session the frontier: `selectedIds()` and `setStyle(ids, patch)`.
 * @param {() => void} options.paintFn the repaint.
 * @param {(tag: string) => Element} options.createElement makes the rows and buttons.
 * @param {(error: unknown) => void} [options.onError] the rejection path.
 * @param {AbortSignal} [options.signal] when it aborts, the listeners this binder added are removed.
 * @param {(key: string, source: string) => string} [options.text] the words of a choice.
 * @param {string[]} [options.properties] the properties this host carries, when the
 *   page splits the type from the heads into two sections; the default is all three.
 * @returns {{sync: (styles: object | null) => void}}
 */
export function bindArrowStyle({
    host,
    session,
    paintFn,
    createElement,
    onError = (e) => {
        throw e;
    },
    signal,
    text = (_key, source) => source,
    properties = Object.keys(ARROW_CHOICES),
}) {
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
    const rows = [];
    for (const property of properties) {
        const choices = ARROW_CHOICES[property];
        if (choices === undefined) {
            throw new Error(`arrow-style: no choices for ${property}`);
        }
        const row = createElement("div");
        row.setAttribute("data-arrow-row", property);
        row.hidden = true;
        const buttons = [];
        for (const choice of choices) {
            const button = createElement("button");
            button.setAttribute("type", "button");
            button.setAttribute("data-arrow-property", property);
            button.setAttribute("data-arrow-choice", choice);
            // `startArrowhead` and `endArrowhead` name a head; `arrowType` names
            // the bend. The key follows the property, and the protocol value
            // stays in `data-arrow-choice`.
            const label =
                property === "arrowType"
                    ? text(`arrow.type.${choice}`, choice)
                    : text(`arrow.head.${choice}`, choice);
            button.setAttribute("title", label);
            button.textContent = label;
            button.addEventListener("click", () => write(property, choice), { signal });
            row.appendChild(button);
            buttons.push({ button, choice });
        }
        host.appendChild(row);
        rows.push({ row, property, buttons });
    }
    return {
        sync(styles) {
            let any = false;
            for (const { row, property, buttons } of rows) {
                const word = styles?.[property];
                const present = word != null;
                row.hidden = !present;
                any ||= present;
                if (!present) {
                    row.removeAttribute("data-mixed");
                    continue;
                }
                for (const { button, choice } of buttons) {
                    button.classList.toggle("is-active", word === choice);
                }
                if (word === "mixed") {
                    row.setAttribute("data-mixed", "true");
                } else {
                    row.removeAttribute("data-mixed");
                }
            }
            host.hidden = !any;
        },
    };
}
