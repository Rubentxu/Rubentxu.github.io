// The link editor: one question, three answers, the address it guards.
//
// The sheet is the chart dialog's sibling in construction — built from a host
// the page carries, settled by exactly one answer — and the address's guard
// lives in the kernel (`link::sanitize`), not here: the sheet collects what
// the user typed and hands it over, and a refusal comes back as the frontier's
// own `bad_link` for the caller to show. An empty answer is the clear request,
// and it is labelled as one, because "remove what is there" and "I changed my
// mind" are different buttons with different work.

import { cycleIndex, rememberFocus } from "./focus.mjs";

// The sheet does not import the catalogs: the application root hands it a `text` function, and
// with none the words are the English written below.
const keepSource = (_key, source) => source;

/**
 * Ask for the address the selection carries.
 *
 * @param {object} options the sheet's arguments.
 * @param {Element} options.host the sheet's container, already in the page.
 * @param {(tag: string) => Element} options.createElement the element maker;
 *   the production caller passes `document.createElement` and a test passes
 *   a fake.
 * @param {string} [options.current] the address the selection carries now,
 *   shown as the input's starting value.
 * @param {Document} [options.owner] the document to listen on; a test passes
 *   a fake. Defaults to the global document.
 * @param {(key: string, source: string) => string} [options.text] the words the
 *   sheet writes, by key; the English here is the source and the default.
 * @returns {Promise<string | null>} the typed address — `""` meaning *clear*
 *   — or `null` when the sheet was dismissed.
 */
export function askLink({
    host,
    createElement,
    current = "",
    owner = globalThis.document,
    text = keepSource,
}) {
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
            if (event.key === "Enter") {
                // The typed address is the answer: the reference's editor
                // commits with Enter (WF-LINK-01), and a sheet that only
                // ever closed with Escape and its buttons left the element's
                // link null where the reference had written the address —
                // the difference the receipt `link-edit` measured.
                event.preventDefault();
                settle(input.value);
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
        const label = createElement("label");
        label.textContent = text("dialog.link.label", "Link");
        label.setAttribute("for", "link-input");
        host.append(label);
        const input = createElement("input");
        input.id = "link-input";
        input.type = "text";
        input.value = current;
        input.placeholder = text("dialog.link.placeholder", "https://…");
        controls.push(input);
        host.append(input);
        for (const [answer, source] of [
            ["save", "Save"],
            ["clear", "Remove link"],
            [null, "Cancel"],
        ]) {
            const words = text(`dialog.link.${answer ?? "cancel"}`, source);
            const button = createElement("button");
            button.type = "button";
            button.dataset.linkChoice = answer ?? "cancel";
            button.textContent = words;
            button.addEventListener("click", () => {
                if (answer === "save") {
                    // The typed text is the answer, trimmed by the kernel's
                    // sanitizer and not here: trimming twice is two owners of
                    // one rule.
                    settle(input.value);
                } else if (answer === "clear") {
                    settle("");
                } else {
                    settle(null);
                }
            });
            controls.push(button);
            host.append(button);
        }
        input.focus();
    });
}
