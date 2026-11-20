// The flight of a file over the canvas has a visible answer (TASK-145).
//
// Upstream's `FileDropOverlay.tsx` is the shape the port shows: a veil over
// the drawing, a card that says what a drop would do, and the two papers of
// its illustration — the back one crossed out when the drop would replace
// the content. The words are the port's own (`client/locales.mjs`, `drop.*`);
// the rules are upstream's, and they are all here, where a test drives them:
//
//   - a drag that carries files, and only such a drag, dresses the canvas;
//   - a picture is laid where it falls over the drawing the user sees, so
//     its flight keeps the canvas bare (upstream's own rule);
//   - what a drop would do is read from the file itself: a library appends,
//     a shift held keeps what there is, anything else replaces — and a file
//     with no type at all (an OS-dragged .excalidraw) may be either, so the
//     card says so a second time;
//   - the enter and the leave of an inner element count, because the events
//     bubble: the veil comes down when the drag is truly gone;
//   - the drop, the escape and a window that lost the focus end the flight.
//
// The state is a question about the drag and the keyboard and nothing else.
// It never reaches the drawing; a view-only page, which cannot take a drop,
// shows no answer to a drop.

/** The MIME type a library file carries, the one that turns the drop into an import. */
export const LIBRARY_MIME = "application/vnd.excalidrawlib+json";

/**
 * The words the card reads, in English — the source the translations answer.
 * Upstream's own four sayings, one per answer the drop can have.
 */
export const DROP_TEXTS = Object.freeze({
    replace: "Drop to replace content",
    add: "Drop to add to canvas",
    importLibrary: "Drop to import library",
    replaceHint: "Hold {shift} to keep existing content",
    keepHint: "Your existing content will be kept",
    libraryHint: "Library files will append",
});

/** The word the hint names the shift key by. */
const SHIFT_WORD = "Shift";

/**
 * Whether a drag carries files, the only drag the veil answers.
 *
 * @param {{dataTransfer?: {types?: string[]}} | undefined} event the drag.
 * @returns {boolean} whether files are in the air.
 */
export function isFileDrag(event) {
    return Array.from(event?.dataTransfer?.types ?? []).includes("Files");
}

/**
 * The state the flight shows, or nothing.
 *
 * @param {{kind?: string, type?: string}[]} items the drag's transfer items.
 * @param {boolean} shiftKey whether the shift key is held.
 * @returns {{shiftKey: boolean, kind: "scene" | "library" | "unknown"} | null}
 *   the state, or `null` for a drag whose answer is the bare canvas.
 */
export function dropStateOf(items, shiftKey) {
    const files = items.filter((item) => item?.kind === "file");
    if (files.some((item) => String(item.type ?? "").startsWith("image/"))) {
        return null;
    }
    const type = files[0]?.type;
    const kind = type === LIBRARY_MIME ? "library" : type ? "scene" : "unknown";
    return { shiftKey: Boolean(shiftKey), kind };
}

/**
 * The wording a state reads as: the title that names the drop, the hint that
 * tells the shift's price, and whether the unknown kind says its second line.
 *
 * @param {{shiftKey: boolean, kind: string}} state the flight's state.
 * @param {typeof DROP_TEXTS} texts the words to read.
 * @returns {{title: string, hint: string, secondary: boolean}} the words.
 */
export function overlayTexts(state, texts) {
    if (state.kind === "library") {
        return { title: texts.importLibrary, hint: texts.keepHint, secondary: false };
    }
    if (state.shiftKey) {
        return { title: texts.add, hint: texts.keepHint, secondary: false };
    }
    return {
        title: texts.replace,
        hint: texts.replaceHint,
        secondary: state.kind === "unknown",
    };
}

/** The two papers of the illustration, upstream's own paths. */
const PAPER_SVG = {
    back: '<svg class="file-drop-overlay__file file-drop-overlay__file--back" viewBox="0 0 100 128" fill="none" aria-hidden="true"><path class="file-drop-overlay__paper" d="M16 3h43l28 28v81c0 7-4 12-12 12H16c-8 0-12-5-12-12V15C4 7 8 3 16 3Z"/><path d="M59 3v20c0 6 3 8 9 8h19"/><path class="file-drop-overlay__lines" d="M24 61h43M24 77h43M24 93h26"/><path class="file-drop-overlay__cross" d="M18 44l24 24M42 44L18 68"/></svg>',
    front: '<svg class="file-drop-overlay__file file-drop-overlay__file--front" viewBox="0 0 100 128" fill="none" aria-hidden="true"><path class="file-drop-overlay__paper" d="M16 3h43l28 28v81c0 7-4 12-12 12H16c-8 0-12-5-12-12V15C4 7 8 3 16 3Z"/><path d="M59 3v20c0 6 3 8 9 8h19"/><path class="file-drop-overlay__lines" d="M24 61h43M24 77h43M24 93h26"/></svg>',
};

/**
 * Bind the veil on `surface`, the element the drag flies over.
 *
 * The listeners mirror upstream's: the enter and the leave count on the
 * surface (the events bubble, so a pass through an inner element is not a
 * leave), the dragover keeps the count alive and defaults the drag to a
 * copy, and the drop, the dragend, the escape and the blur are heard where
 * they happen — on the document and the window — whatever the surface is.
 *
 * @param {object} options
 * @param {EventTarget} options.surface the element the drag flies over.
 * @param {EventTarget} options.ownerDocument the document the drop and the
 *   keys are heard on (the capture phase, so a drop anywhere ends the flight).
 * @param {EventTarget} options.viewWindow the window whose blur ends it.
 * @param {(key: keyof typeof DROP_TEXTS) => string} options.t the words.
 * @param {() => boolean} [options.isViewOnly] a page that cannot take a drop
 *   is a page the veil does not answer.
 * @param {AbortSignal} [options.signal] its abort takes every listener off —
 *   the veil is part of the mount, and a mount that came down leaves no
 *   listener behind.
 */
export function bindDropOverlay({ surface, ownerDocument, viewWindow, t, isViewOnly = () => false, signal }) {
    const overlay = surface.ownerDocument.createElement("div");
    overlay.classList.add("file-drop-overlay");
    overlay.hidden = true;
    const card = surface.ownerDocument.createElement("div");
    card.classList.add("file-drop-overlay__card");
    const said = surface.ownerDocument.createElement("div");
    said.setAttribute("role", "status");
    said.setAttribute("aria-live", "polite");
    said.setAttribute("aria-atomic", "true");
    const title = surface.ownerDocument.createElement("div");
    title.classList.add("file-drop-overlay__title");
    const hint = surface.ownerDocument.createElement("div");
    hint.classList.add("file-drop-overlay__hint");
    const secondary = surface.ownerDocument.createElement("div");
    secondary.classList.add("file-drop-overlay__hint", "file-drop-overlay__hint--secondary");
    const illustration = surface.ownerDocument.createElement("div");
    illustration.classList.add("file-drop-overlay__illustration");
    illustration.setAttribute("aria-hidden", "true");
    illustration.innerHTML = `${PAPER_SVG.back}${PAPER_SVG.front}`;
    said.append(title, hint, secondary);
    card.append(said, illustration);
    overlay.append(card);
    surface.append(overlay);

    let depth = 0;
    let state = null;

    const hide = () => {
        depth = 0;
        state = null;
        overlay.hidden = true;
    };

    const show = () => {
        const words = overlayTexts(state, {
            replace: t("replace"),
            add: t("add"),
            importLibrary: t("importLibrary"),
            replaceHint: t("replaceHint"),
            keepHint: t("keepHint"),
            libraryHint: t("libraryHint"),
        });
        title.textContent = words.title;
        // The hint names the shift key as the key it is — a `kbd`, the way
        // the context menu names a shortcut — with the words around it.
        const parts = words.hint.split("{shift}");
        hint.textContent = parts[0];
        if (parts.length > 1) {
            const key = surface.ownerDocument.createElement("kbd");
            key.textContent = SHIFT_WORD;
            const rest = surface.ownerDocument.createElement("span");
            rest.textContent = parts[1];
            hint.append(key, rest);
        }
        secondary.textContent = t("libraryHint");
        secondary.hidden = !words.secondary;
        overlay.classList.toggle("file-drop-overlay--keep", state.shiftKey || state.kind === "library");
        overlay.hidden = false;
    };

    const update = (event) => {
        const next = dropStateOf(Array.from(event.dataTransfer?.items ?? []), event.shiftKey);
        if (next === null) {
            // A picture keeps the canvas bare; a flight that began as one
            // kind of file and turned into another is read again whole.
            if (state !== null) hide();
            return;
        }
        const same = state !== null && state.kind === next.kind && state.shiftKey === next.shiftKey;
        state = next;
        if (!same) show();
    };

    surface.addEventListener("dragenter", (event) => {
        if (!isFileDrag(event) || isViewOnly()) {
            return;
        }
        depth += 1;
        update(event);
    }, { signal });
    surface.addEventListener("dragover", (event) => {
        if (!isFileDrag(event) || isViewOnly()) {
            return;
        }
        // Shift is what the browser reads as a move; the port only ever
        // copies the file in, so the cursor says copy whatever the keys say.
        if (event.dataTransfer) {
            event.dataTransfer.dropEffect = "copy";
        }
        depth = Math.max(1, depth);
        update(event);
    }, { signal });
    surface.addEventListener("dragleave", () => {
        depth = Math.max(0, depth - 1);
        if (depth === 0) hide();
    }, { signal });
    ownerDocument.addEventListener("drop", hide, { capture: true, signal });
    ownerDocument.addEventListener("dragend", hide, { capture: true, signal });
    const onKey = (event) => {
        if (event.key === "Escape") {
            hide();
        } else if (event.key === "Shift" && state !== null) {
            state = { ...state, shiftKey: Boolean(event.shiftKey) };
            show();
        }
    };
    ownerDocument.addEventListener("keydown", onKey, { capture: true, signal });
    ownerDocument.addEventListener("keyup", onKey, { capture: true, signal });
    viewWindow.addEventListener("blur", hide, { signal });
}
