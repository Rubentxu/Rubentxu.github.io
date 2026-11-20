// The chart offer: one paste, one question, three answers.
//
// The reader said the pasted text is a chart's data; this sheet is where the
// user says which chart — or says none, and the text pastes as text. The
// sheet is the context menu's sibling in construction: built from a table by
// this module, shown once per paste, settled by exactly one answer. A paste
// that never gets an answer (the Escape, the click elsewhere) settles as
// `null`, and `null` means the text path — the offer must never swallow a
// paste.

/** The sheet's own vocabulary: what each answer is called and does. */
const CHOICES = [
    { value: "bar", label: "Bar chart" },
    { value: "line", label: "Line chart" },
    { value: "text", label: "Paste as text" },
];

import { cycleIndex, rememberFocus } from "./focus.mjs";

// The sheet does not import the catalogs: the application root hands it a `text` function, and
// with none the words are the English written below.
const keepSource = (_key, source) => source;

/**
 * Ask which chart the pasted data should become.
 *
 * @param {object} options the sheet's arguments.
 * @param {Element} options.host the sheet's container, already in the page.
 * @param {(tag: string) => Element} options.createElement the element maker;
 *   the production caller passes `document.createElement` and a test passes
 *   a fake, so the sheet needs no browser to be exercised.
 * @param {Document} [options.owner] the document to listen on; a test passes
 *   a fake. Defaults to the global document.
 * @param {(key: string, source: string) => string} [options.text] the words the
 *   sheet writes, by key; the English here is the source and the default.
 * @returns {Promise<"bar" | "line" | "text" | null>} the user's answer, or
 *   null when the sheet was dismissed.
 */
export function askChart({ host, createElement, owner = globalThis.document, text = keepSource }) {
    return new Promise((resolve) => {
        let settled = false;
        // The controls in the order `Tab` walks them: the sheet knows them
        // because it made them, so no selector has to find them again.
        const controls = [];
        const restoreFocus = rememberFocus(owner);
        const settle = (answer) => {
            if (settled) {
                return;
            }
            settled = true;
            owner.removeEventListener("keydown", onKey, true);
            host.replaceChildren();
            host.hidden = true;
            restoreFocus();
            resolve(answer);
        };
        const onKey = (event) => {
            if (event.key === "Escape") {
                settle(null);
                return;
            }
            if (event.key === "Tab") {
                // The sheet holds the keyboard until it settles: `Tab` walks
                // its controls and wraps, and never reaches the page under it.
                const at = controls.indexOf(owner.activeElement);
                const next = cycleIndex(controls.length, at, event.shiftKey === true);
                if (next >= 0) {
                    event.preventDefault();
                    controls[next].focus();
                }
            }
        };
        owner.addEventListener("keydown", onKey, true);

        host.replaceChildren();
        host.hidden = false;
        const title = createElement("div");
        title.textContent = text("dialog.chart.title", "The pasted text looks like a chart");
        host.append(title);
        for (const choice of CHOICES) {
            const button = createElement("button");
            button.type = "button";
            button.dataset.chartChoice = choice.value;
            button.textContent = text(`dialog.chart.choice.${choice.value}`, choice.label);
            button.addEventListener("click", () => settle(choice.value));
            controls.push(button);
            host.append(button);
        }
        host.querySelector("button")?.focus();
    });
}
