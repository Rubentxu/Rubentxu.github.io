// The style toolbars: one control, five vocabularies.
//
// Why a module and not a function in `index.js`:
// A style toolbar has no dependency on the canvas, the session's history or the render
// pipeline — only on `selectedIds` to write, and on the parsed `stylesOf` object to read.
// Extracting it lets the
// test exercise the click contract and the active-state contract without booting the whole
// client, and keeps the wiring in `index.js` to three lines.
//
// Why one module and not four:
// The per-family modules were byte-identical modulo the token name, each carrying its own
// copy of the reasoning. The families differ in exactly two facts, and a table of two facts
// is not five modules. So the table below is the whole difference, `bindStyleToolbar` is the
// whole behaviour, and `bindStyleToolbars` binds every row and the opacity slider at once.
//
// The frontier has ONE write door for the whole family now (`setStyle`), so the table names
// no method: it names the **property**, and the property is the patch's key. The token
// lists are the wire vocabulary, exported so a caller validating its own inputs compares
// against the same set. The kernel is still the authority: `Roughness::token`, `FillStyle`
// and friends live there, the smoke test covers the opposite direction, and anything
// outside a set is rejected with a `bad_style: …` error rather than coerced.

/**
 * The `data-` attribute a toolbar's buttons carry, as it appears in HTML.
 *
 * Derived from the camelCase name `DOMStringMap` exposes rather than stored beside it,
 * because those two are *different spellings of the same attribute* and a table holding
 * both is a table that can disagree with itself. `data-line-width` is read as
 * `button.dataset.lineWidth`, and the only reason this function exists is that nothing
 * derives one from the other for you. Getting it wrong is silent: the selector
 * `[data-lineWidth]` matches no attribute, `querySelectorAll` returns nothing, the binder
 * wires up zero buttons and reports no error — a toolbar that is absent rather than broken.
 *
 * Exported because it is now two things rather than one. It reads the DOM's spelling,
 * and it is also the spelling `Session::stylesOf` sends its keys in, so a caller checking
 * that the kernel and this table agree has to derive the expectation the same way this
 * module does. `scripts/smoke.test.mjs` does exactly that, against the real artifact.
 */
import { STYLE_TOKENS } from "./vocabulary.mjs";

export function datasetProp(attr) {
    return attr.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

/** The inverse of `datasetProp`: the DOM attribute a family's name spells. */
const attrOf = (family) => family.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

/**
 * The per-element style families with button vocabularies: the button attribute and its
 * wire tokens. The opacity slider is the one family that is not a row here — its answer
 * is a number, not a token, and it has its own binder below. `tokens` is ordered as the
 * toolbar shows them and is the only thing a caller needs to build a button row.
 *
 * There is no `getter` column, and its absence is the point. Reading a family used to
 * mean calling that family's own `*Of`, which cost a crossing and a scene lookup apiece
 * — four crossings per frame to light four buttons. One `stylesOf` now answers all four,
 * so the reading key is no longer a *method* but the `datasetProp` spelling of the very
 * attribute above, which this module derives rather than stores. Three facts per row
 * where there were four, and one of them now has nowhere to disagree.
 *
 * There is no `setter` column either, and that is the newer half of the same story: the
 * frontier has ONE write door for the whole family (`setStyle`), so a row no longer
 * names a method to call — it names the **property** the patch carries, and the key of
 * the row *is* that property (`fill`, `stroke`, `lineWidth`, `roughness`, `edges`). The
 * same six words the kernel's read door answers.
 *
 * And the tokens are no longer written here at all: the table is **derived** from the
 * kernel's published vocabulary (`client/vocabulary.mjs`, generated from the artifact),
 * whose order the buttons walk. A token the kernel stops taking leaves the toolbar on
 * the next build; a token it starts taking arrives without anyone adding it — which is
 * why the rows' keys are the vocabulary's keys, and the attribute is spelled from the
 * family's name by `attrOf`, the same rule the DOM applies back (the page writes
 * `data-line-width`, and `dataset.lineWidth` reads it). The hand-written rows drifted
 * one build behind the kernel by construction; a derived table cannot.
 */
export const STYLES = Object.fromEntries(
    Object.entries(STYLE_TOKENS).map(([family, tokens]) => [family, { attr: attrOf(family), tokens }]),
);

/**
 * The patch the frontier's one write door takes, as the JSON it expects.
 *
 * The wire takes a patch and not a property and a value, so a caller that writes two
 * properties at once does not need two crossings and does not need two undo entries.
 * This function is the one place that knows the shape: the property is the key and the
 * value goes under it, which is the same vocabulary the kernel's read door answers.
 *
 * @param {string} property the property's name, as the table's key spells it.
 * @param {string | number} value the token or the number the property carries.
 * @returns {string} the JSON patch.
 */
export function stylePatch(property, value) {
    return JSON.stringify({ [property]: value });
}

/**
 * Bind every `button[data-<style.attr>]` under `root` so a click calls
 * `session.setStyle(selectedIds, patch)`. Returns a `sync` function that updates which
 * button carries the `is-active` class based on the kernel's token for that family, read
 * out of the `stylesOf` object the caller passes in.
 *
 * **`sync(styles)` takes the answer rather than asking for it.** The caller is `paint()`,
 * which reads `session.stylesOf()` once per frame — one object naming the selected id's
 * token for all four families — and hands the same object to every toolbar. This module
 * used to read the selection and then call its own family's `*Of` getter, so a frame paid
 * a crossing and a scene lookup per family to light four buttons; four crossings became
 * one, and the count stopped being a property of how many toolbars happen to be bound.
 *
 * `styles` is the parsed object, or `null` for "nothing to show" — an empty selection, or
 * an id that vanished between the last render and this read. Both used to be separate
 * branches here and are now the same value.
 *
 * The click handler still reads the selection itself. That is not the same
 * thing: a click is not a frame, it happens once per human click, and it must
 * see the selection as it is at that instant rather than whatever a paint
 * happened to read.
 *
 * `paintFn` is the same `paint(session, ctx)` callers use elsewhere; a style change always
 * re-paints, so passing it in keeps the module free of any knowledge about the canvas.
 *
 * `onError` is called with the thrown error when the frontier rejects a token — in practice,
 * only a misspelling on a future button. The default re-throws: a misspelling is a defect,
 * not a feature, and silently ignoring it would let the wrong button sit on screen with no
 * feedback.
 */
export function bindStyleToolbar({ root, style, session, paintFn, onError = (e) => { throw e; }, signal }) {
    const { attr } = style;
    const prop = datasetProp(attr);
    const buttons = Array.from(root.querySelectorAll(`button[data-${attr}]`));
    const mixedIndicator = Array.from(root.children).find(
        (child) => typeof child.getAttribute === "function" && child.getAttribute("data-style-mixed") !== null,
    ) ?? null;
    for (const button of buttons) {
        // Upstream's fill row carries three buttons and the fourth fill — the
        // zigzag — arrives by Alt-clicking the hachure one (actionProperties.tsx
        // builds the option with the "Alt-Click" hint). The keyboard path and
        // the menu still reach the token directly; this is the row's own way.
        button.addEventListener("click", (event) => {
            const token = prop === "fill" && event?.altKey === true && button.dataset.fill === "hachure"
                ? "zigzag"
                : button.dataset[prop];
            const ids = session.selectedIds();
            try {
                session.setStyle(ids, stylePatch(prop, token));
            } catch (error) {
                onError(error);
                return;
            }
            paintFn();
        }, { signal });
    }
    return {
        sync(styles) {
            // `styles` is the parsed `session.stylesOf()`: one object carrying the first
            // selected id's token for every family, or `null` for "nothing to show".
            // The caller reads it once per frame and hands the same object to every
            // toolbar, so painting four buttons costs one crossing instead of four.
            const active = styles === null ? null : styles[prop];
            const mixed = active === "mixed";
            if (mixed) {
                root.setAttribute("data-mixed", "true");
            } else {
                root.removeAttribute("data-mixed");
            }
            if (mixedIndicator !== null) {
                mixedIndicator.hidden = !mixed;
            }
            // The kernel's `mixed` token has no matching button, so no button lights. The
            // row marks that state separately and, where supplied, shows its text indicator.
            // A `null` style value remains the distinct answer for a value with no token.
            // Those two used to be three branches. "Nothing selected" was checked by the
            // caller with `ids.length > 0` and skipped the read entirely, and "the id
            // vanished since the last render" was a `catch` around it; both left `active`
            // at `null`. One read that can fail once has one failure, so the caller now
            // reports "nothing to show" as a value and this function has one branch left.
            for (const button of buttons) {
                // The zigzag fill lights the hachure button: upstream draws it as
                // hachure's second state, not as a row of its own.
                const lit =
                    button.dataset[prop] === active ||
                    (prop === "fill" && button.dataset.fill === "hachure" && active === "zigzag");
                button.classList.toggle("is-active", lit);
                // The class is what the eye reads; this is what an assistive
                // technology reads. Both come from the one comparison, so the
                // two cannot say different things.
                button.setAttribute("aria-pressed", lit ? "true" : "false");
            }
        },
    };
}

/**
 * The opacity slider: the one control in the inspector that is not a row of
 * buttons, because its vocabulary is every number from 0 to 100 and a row of
 * a hundred buttons is not an answer. It is bound here rather than through
 * `STYLES` for that reason: the table's shape is `attr, tokens`, and a range
 * input has no tokens — its answer is the number the input carries.
 *
 * The input event drives the setter, and the setter drives one undo: a drag
 * across a mixed selection is one gesture in the history, which is the whole
 * point of writing the selection and not the element.
 *
 * `sync(styles)` reads the same parsed `stylesOf` object the button rows
 * read. A number is the common answer every selected element carries, and it
 * goes in the slider; `null` is the kernel's word for "these do not agree",
 * and the row carries `data-mixed` so the page can say so — the slider stays
 * draggable, because dragging it is exactly how a mixed selection stops
 * being mixed. `null` styles — nothing selected — leave the row hidden, the
 * same outcome the button rows' `sync` reaches with an unlit row.
 *
 * @param {object} options the slider's arguments.
 * @param {Element} options.host the row that carries the range input.
 * @param {object} options.session the frontier; `setStyle(ids, patch)`.
 * @param {() => void} options.paintFn the repaint, as every binder takes it.
 * @param {(error: unknown) => void} [options.onError] the rejection path;
 *   the default re-throws, as the button binder's does.
 * @param {AbortSignal} [options.signal] when it aborts, the listeners this binder added are removed.
 * @returns {{sync: (styles: object | null) => void}} the per-frame refresher.
 */
export function bindOpacitySlider({ host, session, paintFn, onError = (e) => { throw e; }, signal }) {
    const slider = host.querySelector('input[type="range"]');
    if (!slider) {
        throw new Error("opacity-slider: the host carries no range input");
    }
    slider.addEventListener("input", () => {
        const ids = session.selectedIds();
        try {
            session.setStyle(ids, stylePatch("opacity", Number(slider.value)));
        } catch (error) {
            onError(error);
            return;
        }
        paintFn();
    }, { signal });
    // The readout beside the slider. It is optional: a host without one still works.
    const readout = host.querySelector("output");
    return {
        sync(styles) {
            host.hidden = styles === null;
            if (styles === null) {
                return;
            }
            if (typeof styles.opacity === "number") {
                slider.value = String(styles.opacity);
                if (readout) readout.textContent = String(styles.opacity);
                host.removeAttribute("data-mixed");
            } else {
                // The slider keeps its last position; the readout must not keep its last
                // number, or it would name a value the selection does not share.
                if (readout) readout.textContent = "\u2014";
                host.setAttribute("data-mixed", "true");
            }
        },
    };
}

/**
 * The id of the page element that holds each family's buttons, keyed like `STYLES`.
 * The row of tokens lives in `STYLES`; where it is drawn lives here, so adding a family
 * is one row in each table and no new module.
 */
export const STYLE_ROOT_IDS = Object.freeze({
    fill: "fill-buttons",
    stroke: "stroke-buttons",
    lineWidth: "line-width-buttons",
    roughness: "roughness-buttons",
    edges: "edges-buttons",
});

/** The id of the row that holds the opacity slider. */
export const OPACITY_ROW_ID = "opacity-row";

/**
 * Bind every style control the page shows from `STYLES` and return ONE refresher.
 *
 * `sync(styles)` is the `syncAll` the frame calls: it hands the single parsed
 * `stylesOf` object to each family's row and to the opacity slider, so the caller names
 * no family and a new row cannot be forgotten in `paint`.
 *
 * @param {object} options
 * @param {{getElementById: (id: string) => Element | null}} options.document where the roots live.
 * @param {object} options.session the frontier.
 * @param {() => void} options.paintFn the repaint.
 * @param {(error: unknown) => void} [options.onError] the rejection path.
 * @param {AbortSignal} [options.signal] when it aborts, the listeners this binder added are removed.
 * @returns {{sync: (styles: object | null) => void}}
 */
export function bindStyleToolbars({ document, session, paintFn, onError, signal }) {
    const syncs = [];
    for (const [key, style] of Object.entries(STYLES)) {
        const id = STYLE_ROOT_IDS[key];
        const root = document.getElementById(id);
        if (!root) {
            throw new Error(`style-toolbars: no element #${id} for the ${key} row`);
        }
        syncs.push(bindStyleToolbar({ root, style, session, paintFn, onError, signal }).sync);
    }
    const host = document.getElementById(OPACITY_ROW_ID);
    if (!host) {
        throw new Error(`style-toolbars: no element #${OPACITY_ROW_ID} for the opacity row`);
    }
    syncs.push(bindOpacitySlider({ host, session, paintFn, onError, signal }).sync);
    return {
        sync(styles) {
            for (const sync of syncs) sync(styles);
        },
    };
}
