import { rememberFocus } from "./focus.mjs";

const keepSource = (_key, source) => source;

/**
 * Ask before removing every element in the scene.
 *
 * @param {object} options
 * @param {HTMLDialogElement} options.host Existing dialog host.
 * @param {(tag: string) => Element} options.createElement Element factory.
 * @param {Document} [options.owner] Document receiving keyboard events.
 * @param {(key: string, source: string) => string} [options.text] Localized text.
 * @param {() => void} options.confirm Action performed only after confirmation.
 * @returns {() => void} Close the sheet without changing the scene.
 */
export function openClearCanvasDialog({
    host,
    createElement,
    owner = globalThis.document,
    text = keepSource,
    confirm,
}) {
    let settled = false;
    const restoreFocus = rememberFocus(owner);
    const close = () => {
        if (settled) return;
        settled = true;
        host.removeEventListener("cancel", onCancel);
        if (host.open) host.close();
        host.replaceChildren();
        restoreFocus();
    };
    const onCancel = (event) => {
        event.preventDefault();
        close();
    };

    host.replaceChildren();
    host.setAttribute("role", "alertdialog");
    host.setAttribute("aria-modal", "true");
    const title = createElement("h2");
    title.id = "clear-canvas-title";
    title.textContent = text("dialog.clearCanvas.title", "Clear canvas?");
    host.setAttribute("aria-labelledby", title.id);
    host.append(title);
    const message = createElement("p");
    message.textContent = text("dialog.clearCanvas.message", "This removes every element in the drawing. You can undo this action.");
    host.append(message);
    const cancel = createElement("button");
    cancel.type = "button";
    cancel.textContent = text("dialog.clearCanvas.cancel", "Cancel");
    cancel.addEventListener("click", close);
    host.append(cancel);
    const clear = createElement("button");
    clear.type = "button";
    clear.textContent = text("dialog.clearCanvas.confirm", "Clear canvas");
    clear.addEventListener("click", () => {
        if (settled) return;
        close();
        confirm();
    });
    host.append(clear);
    host.addEventListener("cancel", onCancel);
    host.showModal();
    cancel.focus();
    return close;
}

/**
 * The `clearCanvas` verb's confirmation, as the command runner takes it.
 *
 * The shell owns the dialog host, its words, and the focus it restores; the
 * scene's clear is the verb's, so this factory only settles the question and
 * hands the confirmed answer back. A cancellation never calls `onConfirm`.
 *
 * @param {object} options
 * @param {HTMLDialogElement} options.host Existing dialog host.
 * @param {(tag: string) => Element} options.createElement Element factory.
 * @param {Document} [options.owner] Document receiving keyboard events.
 * @param {(key: string, source: string) => string} [options.text] Localized text.
 * @returns {(onConfirm: () => void) => void} The verb's confirmation step.
 */
export function createClearCanvasPrompt({
    host, createElement, owner = globalThis.document, text,
}) {
    return (onConfirm) => openClearCanvasDialog({
        host,
        createElement,
        owner,
        text,
        confirm: onConfirm,
    });
}
