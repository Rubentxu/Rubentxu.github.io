import { rememberFocus } from "./focus.mjs";

const sourceText = (_key, source) => source;

/** Present the two explicit outcomes for a same-document tab conflict. */
export function openTabConflictDialog({
    host,
    createElement,
    owner = globalThis.document,
    text = sourceText,
    keep,
    adopt,
    onError = () => {},
}) {
    let settled = false;
    let busy = false;
    const restoreFocus = rememberFocus(owner);
    const keepButton = createElement("button");
    const adoptButton = createElement("button");

    function close() {
        if (settled) return;
        settled = true;
        host.removeEventListener("cancel", onCancel);
        if (host.open) host.close();
        host.replaceChildren();
        restoreFocus();
    }

    function onCancel(event) {
        event.preventDefault();
    }

    function setDisabled(disabled) {
        keepButton.disabled = disabled;
        adoptButton.disabled = disabled;
    }

    async function choose(action) {
        if (settled || busy) return;
        busy = true;
        setDisabled(true);
        try {
            await action();
            close();
        } catch (error) {
            busy = false;
            setDisabled(false);
            onError(error);
        }
    }

    host.replaceChildren();
    host.setAttribute("role", "dialog");
    host.setAttribute("aria-modal", "true");
    const title = createElement("h2");
    title.id = "tab-conflict-title";
    title.textContent = text("dialog.tabsConflict.title", "This drawing changed in another tab");
    host.setAttribute("aria-labelledby", title.id);
    host.append(title);
    const message = createElement("p");
    message.textContent = text(
        "dialog.tabsConflict.message",
        "Choose which version to keep. Saving from this tab is paused until you decide.",
    );
    host.append(message);
    keepButton.type = "button";
    keepButton.textContent = text("dialog.tabsConflict.keep", "Keep this tab");
    keepButton.addEventListener("click", () => { void choose(keep); });
    host.append(keepButton);
    adoptButton.type = "button";
    adoptButton.textContent = text("dialog.tabsConflict.adopt", "Adopt the latest version");
    adoptButton.addEventListener("click", () => { void choose(adopt); });
    host.append(adoptButton);
    host.addEventListener("cancel", onCancel);
    host.showModal();
    keepButton.focus();
    return close;
}

/**
 * The `setTabConflictHandler` body: the dialog's host and words, bound once.
 *
 * The page owns the host and the status line; the handler answers with the two
 * resolutions the persistence offers and reports a refusal on the status line
 * in the same voice as every other command.
 *
 * @param {object} options
 * @param {HTMLDialogElement} options.host Existing dialog host.
 * @param {Document} [options.owner] Document receiving keyboard events.
 * @param {(key: string, source: string) => string} [options.text] Localized text.
 * @param {{ setProblem: (message: string) => void }} options.statusLine Status line.
 * @param {() => void} options.renderStatus Status renderer.
 * @returns {(resolution: {keep: Function, adopt: Function}) => void} The installed handler.
 */
export function createTabConflictPrompt({ host, owner = globalThis.document, text, statusLine, renderStatus }) {
    return (resolution) => openTabConflictDialog({
        host,
        createElement: (tag) => owner.createElement(tag),
        owner,
        text,
        keep: resolution.keep,
        adopt: resolution.adopt,
        onError: (error) => {
            statusLine.setProblem(`Tab conflict could not be resolved: ${error.message ?? error}`);
            renderStatus();
        },
    });
}
