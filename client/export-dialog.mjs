// The export dialog: the file's asks, one sheet.
//
// The file can carry a transparent or coloured paper, a resolution, a margin
// around the ink, the theme's filter and the scene to reopen it from. This
// sheet is where the user chooses; the live preview is drawn from those same
// choices before the answer is returned.
//
// The sheet is the chart offer's sibling in construction: built by this
// module straight onto the host — the rows and the two buttons are the
// host's own children, so the page's focus cycle can walk them — shown once
// per click, settled by exactly one answer. A sheet that never gets an
// answer (the Escape) settles as `null`, and `null` means "no export at
// all" — the user closed it, and closing is an answer the caller must not
// swallow.

import { cycleIndex, rememberFocus } from "./focus.mjs";

/** The sheet's controls, in the order `Tab` walks them. */
const CONTROLS = [
    {
        property: "resolution",
        tag: "input",
        type: "number",
        min: 1,
        max: 3,
        step: 1,
        fallback: 1,
        word: "export-dialog.resolution",
    },
    {
        property: "background",
        tag: "input",
        type: "checkbox",
        fallback: false,
        word: "export-dialog.background",
    },
    {
        property: "dark",
        tag: "input",
        type: "checkbox",
        fallback: false,
        word: "export-dialog.dark",
    },
    {
        property: "padding",
        tag: "input",
        type: "number",
        min: 0,
        max: 500,
        step: 1,
        fallback: 10,
        word: "export-dialog.padding",
    },
    {
        property: "embedScene",
        tag: "input",
        type: "checkbox",
        fallback: false,
        word: "export-dialog.embed",
    },
];

// The sheet does not import the catalogs: the application root hands it a
// `text` function, and with none the words are the English written below.
const keepSource = (_key, source) => source;

/**
 * Ask what the exported file should carry.
 *
 * @param {object} options the sheet's arguments.
 * @param {Element} options.host the sheet's container, already in the page.
 * @param {(tag: string) => Element} options.createElement the element maker;
 *   the production caller passes `document.createElement` and a test passes
 *   a fake, so the sheet needs no browser to be exercised.
 * @param {Document} [options.owner] the document to listen on; a test passes
 *   a fake. Defaults to the global document.
 * @param {(key: string, source: string) => string} [options.text] the words
 *   the sheet writes, by key; the English here is the source and the default.
 * @param {(answer: object, image: Element) => void} [options.preview] draw the
 *   current answer into the sheet's preview image.
 * @param {() => void} [options.cleanupPreview] release preview resources when
 *   the sheet settles.
 * @returns {Promise<{resolution: number, background: boolean, dark: boolean,
 *   padding: number, embedScene: boolean} | null>} the user's answer, or null
 *   when the sheet was dismissed.
 */
export function askExport({
    host,
    createElement,
    owner = globalThis.document,
    text = keepSource,
    preview = () => {},
    cleanupPreview = () => {},
}) {
    return new Promise((resolve) => {
        let settled = false;
        // The controls in the order `Tab` walks them: the sheet knows them
        // because it made them, so no selector has to find them again.
        const controls = [];
        const restoreFocus = rememberFocus(owner);
        host.replaceChildren();
        const previewImage = createElement("img");
        previewImage.setAttribute("data-export-preview", "true");
        previewImage.setAttribute("role", "img");
        previewImage.setAttribute("alt", text("export-dialog.preview", CONTROL_WORDS.preview));
        host.appendChild(previewImage);
        const inputs = new Map();
        for (const control of CONTROLS) {
            const words = createElement("label");
            words.setAttribute("for", `export-${control.property}`);
            words.textContent = text(control.word, CONTROL_WORDS[control.property]);
            host.appendChild(words);
            const input = createElement(control.tag);
            input.id = `export-${control.property}`;
            input.setAttribute("data-export", control.property);
            if (control.type === "number") {
                input.setAttribute("type", "number");
                input.setAttribute("min", String(control.min));
                input.setAttribute("max", String(control.max));
                input.setAttribute("step", String(control.step));
                input.value = String(control.fallback);
            } else {
                input.setAttribute("type", "checkbox");
                input.checked = control.fallback;
            }
            host.appendChild(input);
            inputs.set(control.property, input);
            controls.push(input);
        }
        const accept = createElement("button");
        accept.setAttribute("type", "button");
        accept.setAttribute("data-export-accept", "true");
        accept.textContent = text("export-dialog.accept", ACCEPT_WORD);
        host.appendChild(accept);
        controls.push(accept);
        const cancel = createElement("button");
        cancel.setAttribute("type", "button");
        cancel.setAttribute("data-export-cancel", "true");
        cancel.textContent = text("export-dialog.cancel", CANCEL_WORD);
        host.appendChild(cancel);
        controls.push(cancel);
        host.hidden = false;
        controls[0]?.focus();

        const settle = (answer) => {
            if (settled) {
                return;
            }
            settled = true;
            owner.removeEventListener("keydown", onKey, true);
            host.replaceChildren();
            host.hidden = true;
            cleanupPreview();
            restoreFocus();
            resolve(answer);
        };
        const read = () => {
            const answer = {};
            for (const control of CONTROLS) {
                const input = inputs.get(control.property);
                if (control.type !== "number") {
                    answer[control.property] = input.checked;
                    continue;
                }
                const raw = input.value.trim();
                const value = raw === "" ? Number.NaN : Number(raw);
                const valid = Number.isFinite(value) &&
                    (control.property !== "resolution" || [1, 2, 3].includes(value));
                answer[control.property] = valid ? value : control.fallback;
            }
            return answer;
        };
        const refreshPreview = () => preview(read(), previewImage);
        for (const input of inputs.values()) {
            input.addEventListener("input", refreshPreview);
        }
        accept.addEventListener("click", () => settle(read()));
        cancel.addEventListener("click", () => settle(null));
        const onKey = (event) => {
            if (event.key === "Escape") {
                event.preventDefault();
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
        refreshPreview();
    });
}

/** The words the English sheet carries when no catalog answers. */
const CONTROL_WORDS = Object.freeze({
    resolution: "Resolution (1×–3×)",
    background: "Include background",
    dark: "Dark theme",
    padding: "Padding",
    embedScene: "Embed the scene in the file",
    preview: "PNG preview",
});
const ACCEPT_WORD = "Export";
const CANCEL_WORD = "Cancel";
