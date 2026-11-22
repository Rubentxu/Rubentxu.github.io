// The arrow settings: the head at each end of a line or an arrow, and whether it runs
// straight or bends through its points.
//
// Like the text settings, these are not rows of the `STYLES` table: they only exist for
// two kinds of element, so the row has to be able to vanish. What they share with every
// other control is the write door `stylePatch` opens onto — with a selection, the whole
// selection per gesture (one undo) and a `sync` fed by the parsed `stylesOf`; with none,
// the birth preference of this instance (TASK-297), which never crosses to the kernel.
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
 * `sync(styles)` shows each row only when there is a word for it, lights the
 * choice the whole selection shares, and marks the row `data-mixed` when the
 * selected lines disagree. An elbow lights nothing. With no selection (`null`)
 * the rows show the birth preference — the heads from the store, the bend from
 * the tool state — so the panel is where tomorrow's arrow is chosen as well as
 * where today's is patched (TASK-297).
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
 * @param {{ snapshot: () => object, set: (key: string, value: string) => void } | null}
 *   [options.preferences] the instance's birth preferences for the heads.
 * @param {{ arrowType?: string } | null} [options.toolState] the live tool state, the
 *   one truth for the bend — the press reads it and the `a` key walks it.
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
    preferences = null,
    toolState = null,
}) {
    // The record the rows show when the canvas has no selection: the birth the
    // next arrow will wear (TASK-297). The heads are preference keys; the bend
    // is not — `toolState.arrowType` is the single truth the press reads
    // (`gesture-pipeline.mjs`) and the `a` key walks, and a second copy in the
    // store would be a second owner of one fact.
    const preferenceRecord = () => {
        const snapshot = preferences === null ? null : preferences.snapshot();
        const shown = {};
        for (const property of properties) {
            if (property === "arrowType") {
                if (toolState?.arrowType !== undefined && toolState.arrowType !== null) {
                    shown.arrowType = toolState.arrowType;
                }
            } else if (snapshot?.[property] !== undefined) {
                shown[property] = snapshot[property];
            }
        }
        return shown;
    };
    const write = (property, value) => {
        // With no selection the control is not a patch, it is the preference for
        // the next birth: the row writes the store (heads) or the tool state
        // (bend) and nothing crosses to the kernel — no `setStyle`, no history
        // entry, no repaint of a document that was not touched. The picture
        // updates because the rows re-sync onto the new truth.
        const ids = session.selectedIds();
        if (ids.length === 0 && preferences !== null) {
            if (property === "arrowType") {
                if (toolState !== null) {
                    toolState.arrowType = value;
                }
            } else {
                preferences.set(property, value);
            }
            sync(preferenceRecord());
            return;
        }
        try {
            session.setStyle(ids, stylePatch(property, value));
        } catch (error) {
            onError(error);
            return;
        }
        // With a selection the click does both jobs, in this order and never the
        // other way: the patch lands on the elements first, and only an
        // explicit click mirrors into the birth preference (TASK-297 AC4 — a
        // `"mixed"` reading never reaches the store, because a mirror happens
        // only here, on a chosen value, and `sync` only ever *reads* it).
        if (preferences !== null) {
            if (property === "arrowType") {
                if (toolState !== null) {
                    toolState.arrowType = value;
                }
            } else {
                preferences.set(property, value);
            }
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
    const sync = (styles) => {
        // `null` is no selection: the rows then show the birth preference, the
        // same way the shape rows show theirs (`ui-bindings.mjs`'s refresher
        // hands both the snapshot). A panel with no store and no tool state —
        // the unit road's — has nothing to show and keeps hiding.
        const shown = styles === null || styles === undefined
            ? preferenceRecord()
            : styles;
        let any = false;
        for (const { row, property, buttons } of rows) {
            const word = shown?.[property];
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
    };
    return { sync };
}
