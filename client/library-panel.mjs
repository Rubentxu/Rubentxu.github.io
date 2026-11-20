// The library panel: the pieces a person keeps, listed, with a way in and a way out.
//
// # What this file is
//
// Upstream's library is a sidebar on the right edge (`Sidebar/Sidebar.scss`,
// `LibraryMenu.tsx`): a full-height island, a header with the library tab and
// the close button, a grid of pieces and the control buttons at the bottom.
// This is that surface over the library store. It lists the pieces by name,
// adds the selection as a new piece, lays a piece on the drawing and drops a
// piece. It knows nothing about elements: what a piece holds, where it lands
// and what the selection is are all answers handed in, so the geometry stays
// with the kernel and the panel is only the list.
//
// # Nothing is kept here
//
// The list on screen is read from the store on every refresh and never held
// between them. A panel that kept its own copy would be a second library, and
// the two would disagree the first time a write failed. A refresh that is
// overtaken by a newer one is dropped, so a slow read cannot draw over a fresh
// list.
//
// # Files
//
// The library goes in and out as a `.excalidrawlib` text. Choosing the file and
// downloading one belong to the page, so both come in as functions; reading and
// writing the text is `client/library-file.mjs`. Importing only fills the
// library, so it is allowed on a page that refuses edits, like adding is.
//
// # Edits and the view mode
//
// Opening the panel changes nothing. Adding a piece to the library does not
// change the drawing either; laying a piece on the drawing does, and that is the
// one action a page that refuses edits must refuse, so it is asked first.

import { LIBRARY_MIME } from "./library-drop.mjs";
import { LIBRARY_FILE_NAME, readLibraryFile, writeLibraryFile } from "./library-file.mjs";

const keepSource = (_key, source) => source;

/**
 * @typedef {import("./library-store.mjs").Piece} Piece
 */

/** One element with the classes upstream's sidebar uses. */
function make(createElement, tag, ...classes) {
    const element = createElement(tag);
    element.classList.add(...classes);
    return element;
}

/** Put the drawing the caller hands in inside a button, or leave the word. */
function wearIcon(createElement, button, icon, name, fallback) {
    const drawing = icon(name);
    if (drawing === null || drawing === undefined) {
        button.textContent = fallback;
        return;
    }
    const box = make(createElement, "div", "library-icon");
    box.setAttribute("aria-hidden", "true");
    box.appendChild(drawing);
    button.appendChild(box);
}

/**
 * Build the panel and its door.
 *
 * @param {object} deps
 * @param {(tag: string) => Element} deps.createElement The browser's builder.
 * @param {Element} deps.host The element the panel mounts in.
 * @param {{ load: () => Promise<Piece[]>, add: (name: string, elements: object[]) => Promise<Piece | null>, remove: (id: string) => Promise<boolean>, addMany?: (pieces: object[]) => Promise<{ added: number, skipped: number } | null> }} deps.store
 * @param {(piece: Piece) => unknown} deps.insertPiece Lays a piece on the drawing.
 * @param {() => object[]} deps.readSelectionElements The selection's elements, as the kernel inserts them; empty when there is none.
 * @param {() => boolean} [deps.isViewOnly] Whether the page refuses edits.
 * @param {(key: string, source: string) => string} [deps.text] The words, by key; the English here is the default.
 * @param {(message: string) => void} [deps.onProblem] Receives what went wrong, already worded.
 * @param {(message: string) => void} [deps.onNotice] Receives what happened when it is not a problem, already worded.
 * @param {() => Promise<string | null>} [deps.readFile] Lets the person choose a library file; its text, or `null` when none was chosen. Without it there is no Import button.
 * @param {(text: string, name: string) => void} [deps.saveFile] Hands a library file to the person. Without it there is no Export button.
 * @param {(name: string) => Element | null} [deps.icon] The iconary's drawing for a name, as an element. Without it the buttons say their word.
 * @param {AbortSignal} [deps.signal] When it aborts the panel closes and its buttons stop listening.
 * @returns {{ toggle: () => void, close: () => void, isOpen: () => boolean, refresh: () => Promise<void> }}
 */
export function openLibraryPanel({
    createElement,
    host,
    store,
    insertPiece,
    readSelectionElements,
    readSelectionPiece = null,
    isViewOnly = () => false,
    text = keepSource,
    onProblem = () => {},
    onNotice = () => {},
    readFile = null,
    saveFile = null,
    icon = () => null,
    signal,
}) {
    const title = text("library.title", "Library");
    const owner = host.ownerDocument;

    // The sidebar: upstream's `.Island.sidebar` on the right edge, full height.
    const panel = createElement("div");
    panel.classList.add("Island", "sidebar", "default-sidebar", "library-sidebar");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", title);
    panel.setAttribute("data-library-panel", "true");

    const header = make(createElement, "div", "sidebar__header");
    const tabs = make(createElement, "div", "sidebar-triggers");
    tabs.setAttribute("role", "tablist");
    const tab = createElement("button");
    tab.type = "button";
    tab.classList.add("sidebar-tab-trigger");
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-selected", "true");
    tab.setAttribute("aria-label", title);
    wearIcon(createElement, tab, icon, "LibraryIcon", title);
    tabs.appendChild(tab);

    const buttons = make(createElement, "div", "sidebar__header__buttons");
    const closeButton = createElement("button");
    closeButton.type = "button";
    closeButton.classList.add("sidebar__close");
    closeButton.setAttribute("data-library-close", "true");
    closeButton.setAttribute("aria-label", text("library.close", "Close"));
    wearIcon(createElement, closeButton, icon, "CloseIcon", "×");
    buttons.appendChild(closeButton);
    header.appendChild(tabs);
    header.appendChild(buttons);

    const content = make(createElement, "div", "library-menu-items-container");
    const rows = make(createElement, "div", "library-menu-items-container__items");
    rows.setAttribute("data-library-rows", "true");
    content.appendChild(rows);

    const controls = make(createElement, "div", "library-menu-control-buttons");
    const addButton = createElement("button");
    addButton.type = "button";
    addButton.classList.add("library-menu-browse-button");
    addButton.textContent = text("library.add", "Add selection");
    addButton.setAttribute("data-library-add", "true");
    controls.appendChild(addButton);

    if (readFile !== null) {
        const importButton = createElement("button");
        importButton.type = "button";
        importButton.classList.add("library-menu-control-button");
        importButton.textContent = text("library.import", "Import");
        importButton.setAttribute("data-library-import", "true");
        importButton.addEventListener("click", () => {
            importLibrary(readFile);
        }, { signal });
        controls.appendChild(importButton);
    }

    if (saveFile !== null) {
        const exportButton = createElement("button");
        exportButton.type = "button";
        exportButton.classList.add("library-menu-control-button");
        exportButton.textContent = text("library.export", "Export");
        exportButton.setAttribute("data-library-export", "true");
        exportButton.addEventListener("click", () => {
            exportLibrary(saveFile);
        }, { signal });
        controls.appendChild(exportButton);
    }

    panel.appendChild(header);
    panel.appendChild(content);
    panel.appendChild(controls);

    let open = false;
    let turn = 0;
    let previousFocus = null;
    let listening = false;

    /** One piece, as upstream's named library unit: the name under the preview. */
    function row(piece) {
        const card = make(createElement, "div", "library-unit", "library-unit--named");
        card.setAttribute("data-library-piece", piece.id);
        const insert = createElement("button");
        insert.type = "button";
        insert.classList.add("library-unit__dragger");
        insert.setAttribute("data-library-insert", piece.id);
        const name = piece.name === "" ? text("library.unnamed", "Piece") : piece.name;
        insert.setAttribute("aria-label", `${text("library.insert", "Insert")}: ${name}`);
        insert.setAttribute("draggable", "true");
        const preview = make(createElement, "div", "library-unit__preview");
        const drawing = icon("LibraryIcon");
        if (drawing !== null && drawing !== undefined) {
            preview.appendChild(drawing);
        }
        const nameBox = make(createElement, "div", "library-unit__name");
        nameBox.textContent = name;
        insert.appendChild(preview);
        insert.appendChild(nameBox);
        insert.addEventListener("click", () => place(piece), { signal });
        // The piece travels under its own type, whole, so the canvas needs no lookup.
        insert.addEventListener("dragstart", (event) => {
            event.dataTransfer?.setData(LIBRARY_MIME, JSON.stringify(piece));
            if (event.dataTransfer) {
                event.dataTransfer.effectAllowed = "copy";
            }
        }, { signal });

        const drop = createElement("button");
        drop.type = "button";
        drop.classList.add("library-unit__remove");
        drop.setAttribute("data-library-remove", piece.id);
        drop.setAttribute("aria-label", `${text("library.remove", "Remove")}: ${name}`);
        wearIcon(createElement, drop, icon, "CloseIcon", "×");
        drop.addEventListener("click", (event) => {
            event.stopPropagation?.();
            discard(piece.id);
        }, { signal });

        card.appendChild(insert);
        card.appendChild(drop);
        return card;
    }

    async function refresh() {
        turn += 1;
        const mine = turn;
        let pieces = [];
        try {
            pieces = await store.load();
        } catch {
            pieces = [];
        }
        if (mine !== turn || !open) {
            return;
        }
        if (pieces.length === 0) {
            const empty = make(createElement, "div", "library-menu-items__no-items");
            empty.setAttribute("data-library-empty", "true");
            const label = make(createElement, "div", "library-menu-items__no-items__label");
            label.textContent = text("library.empty", "No items yet");
            const hint = make(createElement, "div", "library-menu-items__no-items__hint");
            hint.textContent = text("library.emptyHint", "Select an element on the canvas to add it here.");
            empty.appendChild(label);
            empty.appendChild(hint);
            rows.replaceChildren(empty);
            return;
        }
        const grid = make(createElement, "div", "library-menu-items-container__grid");
        for (const piece of pieces) {
            grid.appendChild(row(piece));
        }
        rows.replaceChildren(grid);
    }

    function place(piece) {
        if (isViewOnly()) {
            onProblem(text("library.viewOnly", "The page is read-only"));
            return;
        }
        const failed = (error) =>
            onProblem(`${text("library.insertFailed", "The piece did not land")}: ${error?.message ?? error}`);
        try {
            // The page's insertion is asynchronous; a rejection is as much a refusal as a throw.
            Promise.resolve(insertPiece(piece)).catch(failed);
        } catch (error) {
            failed(error);
        }
    }

    async function discard(id) {
        await store.remove(id);
        await refresh();
    }

    async function addSelection() {
        let selection;
        try {
            selection = readSelectionPiece === null
                ? { elements: readSelectionElements() }
                : readSelectionPiece();
        } catch (error) {
            onProblem(`${text("library.readFailed", "The selection could not be read")}: ${error?.message ?? error}`);
            return;
        }
        const elements = selection?.elements;
        if (!Array.isArray(elements) || elements.length === 0) {
            onProblem(text("library.nothingSelected", "Select something first"));
            return;
        }
        const count = (await store.load()).length + 1;
        const piece = await store.add(`${text("library.unnamed", "Piece")} ${count}`, elements, selection?.files);
        if (piece === null) {
            onProblem(text("library.notSaved", "The piece could not be saved"));
        }
        await refresh();
    }

    async function importLibrary(choose) {
        let body;
        try {
            body = await choose();
        } catch (error) {
            onProblem(`${text("library.importFailed", "The file could not be read")}: ${error?.message ?? error}`);
            return;
        }
        if (body === null || body === undefined) {
            return;
        }
        const reading = readLibraryFile(body);
        if (!reading.ok) {
            if (reading.reason === "version") {
                onProblem(text("library.importVersion", "This library version is not supported"));
            } else if (reading.reason === "empty") {
                onProblem(text("library.importEmpty", "The library in the file has no pieces"));
            } else {
                onProblem(text("library.importInvalid", "The file is not a library"));
            }
            return;
        }
        const outcome = (await store.addMany?.(reading.pieces)) ?? null;
        if (outcome === null) {
            onProblem(text("library.notSaved", "The piece could not be saved"));
            return;
        }
        if (outcome.added === 0) {
            onNotice(text("library.importNothingNew", "Every piece was already in the library"));
        } else {
            onNotice(`${text("library.imported", "Pieces imported")}: ${outcome.added}`);
        }
        await refresh();
    }

    async function exportLibrary(save) {
        const pieces = await store.load();
        if (pieces.length === 0) {
            onProblem(text("library.exportEmpty", "There are no pieces to export"));
            return;
        }
        try {
            save(writeLibraryFile(pieces), LIBRARY_FILE_NAME);
        } catch (error) {
            onProblem(`${text("library.exportFailed", "The library could not be exported")}: ${error?.message ?? error}`);
        }
    }

    function isLibraryTrigger(node) {
        for (let at = node; at !== null && at !== undefined; at = at.parent) {
            if (at.dataset?.libraryTrigger !== undefined) {
                return true;
            }
        }
        return false;
    }

    function onKeyDown(event) {
        if (event.key === "Escape") {
            event.preventDefault?.();
            close();
        }
    }

    function onOutsidePointerDown(event) {
        if (panel.contains(event.target) || isLibraryTrigger(event.target)) {
            return;
        }
        close();
    }

    addButton.addEventListener("click", () => {
        addSelection();
    }, { signal });
    closeButton.addEventListener("click", () => close(), { signal });

    function show() {
        if (open) {
            return;
        }
        open = true;
        previousFocus = owner?.activeElement ?? null;
        host.appendChild(panel);
        if (owner !== null && owner !== undefined && !listening) {
            owner.addEventListener("keydown", onKeyDown, { signal });
            owner.addEventListener("pointerdown", onOutsidePointerDown, { capture: true, signal });
            listening = true;
        }
        refresh();
    }

    function close() {
        if (!open) {
            return;
        }
        open = false;
        panel.remove();
        if (owner !== null && owner !== undefined && listening) {
            owner.removeEventListener("keydown", onKeyDown);
            owner.removeEventListener("pointerdown", onOutsidePointerDown, true);
            listening = false;
        }
        const previous = previousFocus;
        previousFocus = null;
        if (previous !== null && previous !== undefined && panel.ownerDocument?.contains?.(previous) === true) {
            previous.focus?.();
        }
    }
    signal?.addEventListener("abort", close, { once: true });

    return {
        toggle() {
            if (open) {
                close();
            } else {
                show();
            }
        },
        close,
        isOpen: () => open,
        refresh,
    };
}
