// Inline text editor. H5.11.
//
// A dblclick on a text element mounts a `<textarea>` over the element's
// AABB. The **text roads** — the creation editor and the text edit — follow
// upstream's own wysiwyg contract (`textWysiwyg.tsx:883-900`): Escape
// submits, Ctrl/Cmd+Enter submits, plain Enter is the textarea's own
// newline, and blur submits. The receipt `create-text` (d3a9c2a1) measured
// the creation road on exactly this keying — type the body, then Escape —
// and the re-run called the old keying by its name: an Escape that cancels
// is a birth the reference never loses. The **single-line** frame rename
// keeps Enter-commit and Escape-cancel: upstream's frame title is a plain
// input, not the wysiwyg.
//
// # Why a `<textarea>` and not `contenteditable`
//
// `contenteditable` is the upstream choice but the contract is "replace
// the body". A `<textarea>` has a value attribute that is a literal
// string, the wire format we already pass to `setText`. The trade is
// multi-line: on the text roads plain Enter is left to the textarea, so
// the browser inserts a real `\n`, which the kernel stores verbatim and
// `fillText` paints as a real newline. The sheet grows with an auto-sized
// body while the person types; the element's own AABB is the kernel's
// measurer's job, and the commit hands it the body to measure.
//
// # What the editor wears (TASK-219)
//
// Upstream's wysiwyg is not a form field: `textWysiwyg.tsx` writes
// `background: transparent`, `border: 0`, `padding: 0`, `resize: none`, and a
// `color` that is the element's own stroke put through
// `applyDarkModeFilter(strokeColor, theme === dark)`. The sheet's box is the
// element's box, and its font is the element's font. This editor follows the
// same rule: the colours are computed by `client/dark-colour.mjs` and written
// once, and the theme changes nothing about the document the commit sends.
//
// # The committed-once guard
//
// Both `blur` and the submit keys call `commit`; without the guard, a
// press of a submit key followed by the focus loss would call `onCommit`
// twice and emit two history entries. The flag lives on the closure so the
// cleanup function and the event listener share it.

import { applyDarkModeFilter } from "./dark-colour.mjs";

/**
 * The key that submits an editor. The multiline roads — the text creation
 * and the text edit, upstream's own wysiwyg (`textWysiwyg.tsx:883-900`) —
 * submit on Escape and on Ctrl/Cmd+Enter; plain Enter is the textarea's
 * own newline and stays with the browser. The single-line frame rename
 * keeps Enter without Shift as its submit.
 *
 * @param {{ key: string, ctrlKey?: boolean, metaKey?: boolean, shiftKey?: boolean }} event
 * @param {{ multiline?: boolean }} [roads]
 * @returns {boolean}
 */
export function shouldSubmitOnKey(event, { multiline = false } = {}) {
    if (multiline) {
        return (
            event.key === "Escape" ||
            (event.key === "Enter" && (event.ctrlKey === true || event.metaKey === true))
        );
    }
    return event.key === "Enter" && !event.shiftKey;
}

/**
 * The key that cancels an editor. Only the single-line road has one:
 * upstream's wysiwyg has no cancel — an empty birth is dropped by the
 * submit's own caller, and the typed body of a real one is kept.
 *
 * @param {{ key: string }} event
 * @param {{ multiline?: boolean }} [roads]
 * @returns {boolean}
 */
export function shouldCancelOnKey(event, { multiline = false } = {}) {
    return !multiline && event.key === "Escape";
}

/**
 * The id of the element under the pointer, or `null`.
 *
 * This is half of the double-click decision, and the half that is the
 * page's: *what is under the pointer*. The other half — *what a double
 * click on it means* — is a rule of the format, and the kernel answers it
 * (`textEditTarget`: a label to edit, a shape to put a label in, or
 * nothing at all).
 *
 * The page used to classify the element itself, keeping only the texts
 * (`kindOf(id) !== "text"` meant `null`). That filter is what made the
 * kernel's "container" answer unreachable: the page asked about texts
 * only, so the shape that could hold a label was never asked about, and
 * the branch that puts a label inside a shape was dead code the page
 * still carried.
 *
 * The filter also made the gesture depend on the *page's* idea of what
 * can hold text, and that idea came from the draw layer: H5.13 unified
 * the chrome's `kind` to `"polygon"` and took the client's only read of
 * "is this a text?" with it, and the double click went dead without
 * anything throwing. Asking the kernel is what keeps that from happening
 * again.
 *
 * @param {{ hitTestAtScreen(x: number, y: number, tolerance: number): string[] }} session
 * @param {number} x the point, in CSS pixels relative to the canvas.
 * @param {number} y the point, in CSS pixels relative to the canvas.
 * @returns {string|null} the id under the pointer, or `null`.
 */
export function elementIdAt(session, x, y) {
    const id = session.hitTestAtScreen(x, y, 0).at(0);
    return id ?? null;
}

/**
 * Mount a `<textarea>` over the text element at (`x`, `y`) in CSS pixels.
 *
 * The container is a positioned ancestor (the toolbar overlay layer) so
 * absolute positioning lines up with the canvas. `initialBody` is the
 * value the kernel reports today; on commit the textarea's value is
 * passed to `onCommit`, on cancel `onCancel` is called instead.
 *
 * `createElement` is required: the production caller passes
 * `(tag) => document.createElement(tag)`, the test passes a fake.
 * Injecting the factory is what lets the module be tested under
 * `node --test` without a jsdom, and it is one parameter the
 * production caller already has.
 *
 * `width`, `height`, `lineHeight` and `font` are the element's own box and
 * typography, in CSS pixels; a caller that names none gets the page's font and
 * a sheet large enough to type in. `strokeColour` is the element's ink and
 * `dark` is the theme: the colour the editor shows is
 * `applyDarkModeFilter(strokeColour, dark)`, the same answer upstream gets from
 * `applyDarkModeFilter` in `textWysiwyg.tsx`. `autoResize` is the element's
 * `autoResize` (or its absence, for a bound label): an auto-sized text grows
 * with its body, a fixed one wraps at the box it was given. `caretIndex` is
 * where the caret seats — an index into `initialBody`, for the road that
 * opens the editor over a text the click rested on (TEXT-05); a caller that
 * names none keeps the end-of-body seat every other road opens with.
 *
 * Returns a `close` function that commits the current value and removes
 * the editor. Useful if a future caller wants to dismiss the editor
 * without waiting for blur.
 */
export function openTextEditor({
    container,
    x,
    y,
    initialBody,
    onCommit,
    onCancel,
    onInput,
    signal,
    createElement,
    font,
    multiline = false,
    width,
    height,
    lineHeight,
    textAlign = "left",
    strokeColour,
    dark = false,
    autoResize = false,
    caretIndex,
    selectAll,
}) {
    const editor = createElement("textarea");
    editor.value = initialBody;
    editor.dataset.role = "text-edit";
    // Upstream's wysiwyg is a transparent sheet over the drawing, not a form
    // field (`textWysiwyg.tsx`: `background: transparent`, `border: 0`,
    // `padding: 0`, `resize: none`). The element's ink is the editor's ink, so
    // the text the person types is the text the canvas will paint — and in the
    // dark theme that ink is upstream's own `applyDarkModeFilter`, because the
    // canvas's filter belongs to the canvas and this sheet is DOM above it.
    editor.style.position = "absolute";
    editor.style.left = `${x}px`;
    editor.style.top = `${y}px`;
    if (Number.isFinite(width) && width >= 0) {
        editor.style.width = `${Math.max(width, 1)}px`;
    } else {
        editor.style.minWidth = "80px";
    }
    if (Number.isFinite(height) && height >= 0) {
        editor.style.height = `${Math.max(height, 1)}px`;
    } else {
        editor.style.minHeight = "1em";
    }
    editor.style.margin = "0";
    editor.style.padding = "0";
    editor.style.border = "0";
    editor.style.background = "transparent";
    editor.style.boxSizing = "border-box";
    editor.style.overflow = "hidden";
    editor.style.resize = "none";
    // A frame's title edits at its own size — upstream's input is
    // `FRAME_STYLE.nameFontSize` (`App.tsx:2236`), not the page's. A caller
    // that says nothing gets the page's font, which is what a canvas text
    // editor has always done.
    editor.style.font = font ?? "inherit";
    if (Number.isFinite(lineHeight) && lineHeight > 0) {
        editor.style.lineHeight = `${lineHeight}px`;
    }
    editor.style.textAlign = textAlign;
    // `color` is the element's ink in the theme that is on. A caller that names
    // no ink keeps the page's own (`inherit`), which is what the frame rename —
    // a plain input, not the wysiwyg — has always done.
    editor.style.color =
        typeof strokeColour === "string" ? applyDarkModeFilter(strokeColour, dark) : "inherit";
    // The caret is the text's colour, which is upstream's default once the
    // textarea's `color` is set; writing it down makes the promise testable.
    editor.style.caretColor = "currentColor";
    editor.style.outline = "none";
    editor.style.zIndex = "10";
    // The sheet takes the pointer, the way upstream's wysiwyg does: the
    // layer that hosts it is transparent to clicks (`pointer-events: none`
    // on `#text-edit-layer`), and the sheet opts back in on its own element.
    // That is what keeps a pointerdown **on the sheet** the sheet's and not
    // the canvas's: the sheet keeps the focus, and the text being written
    // survives the press. Upstream's editor is a real `<textarea>` over the
    // drawing, and the canvas never sees the presses that land on it
    // (`textWysiwyg.tsx` lays it over the element's own box).
    editor.style.pointerEvents = "auto";
    // Auto-sized text wraps nowhere; a fixed box and a bound label wrap at the
    // box, which is upstream's `whiteSpace`/`wordBreak` split
    // (`textWysiwyg.tsx`).
    editor.style.whiteSpace = autoResize ? "pre" : "pre-wrap";
    editor.style.wordBreak = autoResize ? "normal" : "break-word";
    container.appendChild(editor);
    editor.focus();
    // Caret at the end, not at the start. The default is position 0,
    // which is the wrong end of any edited text. A caller that names a
    // seat — the click that opened the editor over an existing text —
    // gets exactly that seat instead, collapsed.
    if (selectAll === true) {
        // The rename road selects the whole text on open, as upstream's frame
        // title does (`App.tsx:2220`, `onFocus={(e) => e.target.select()}`):
        // what the user types **replaces** the name, and a caret at the end
        // would make it an append.
        editor.setSelectionRange(0, initialBody.length);
    } else if (Number.isInteger(caretIndex) && caretIndex >= 0 && caretIndex <= initialBody.length) {
        editor.setSelectionRange(caretIndex, caretIndex);
    } else {
        editor.setSelectionRange(initialBody.length, initialBody.length);
    }

    /**
     * Grow the sheet to the body it holds, the way upstream's auto-resizing
     * text does.
     *
     * Only the auto-sized road grows: a bound label and a fixed text are the
     * width their box says, and the browser wraps them there. The measurement
     * is the textarea's own (`scrollWidth`/`scrollHeight`) after the box is
     * collapsed; a sheet with no layout (the fake element the unit suite
     * mounts) answers no number and is left alone.
     */
    const floorWidth = Number.isFinite(width) && width > 0 ? width : 1;
    const floorHeight = Number.isFinite(height) && height > 0 ? height : Number(lineHeight) || 1;
    const fitToBody = () => {
        if (!autoResize) {
            return;
        }
        // Grow, never shrink: the sheet starts as the element's box, and the
        // body is allowed to push it out. A fit that also shrank would rewrite
        // the element's own width on the first thing the person typed, and an
        // editor that is narrower than the box it was opened over is not the
        // element's editor.
        if (typeof editor.scrollWidth === "number") {
            editor.style.width = "1px";
            editor.style.width = `${Math.max(editor.scrollWidth, floorWidth)}px`;
        }
        if (typeof editor.scrollHeight === "number") {
            editor.style.height = "1px";
            editor.style.height = `${Math.max(editor.scrollHeight, floorHeight)}px`;
        }
    };
    fitToBody();

    let done = false;
    const close = (commit) => {
        if (done) {
            return;
        }
        done = true;
        editor.remove();
        if (commit) {
            onCommit(editor.value);
        } else {
            onCancel();
        }
    };

    editor.addEventListener("input", () => {
        fitToBody();
        if (!done) {
            onInput?.(editor.value);
        }
    });
    editor.addEventListener("keydown", (event) => {
        if (shouldSubmitOnKey(event, { multiline })) {
            event.preventDefault();
            close(true);
        } else if (shouldCancelOnKey(event, { multiline })) {
            event.preventDefault();
            close(false);
        }
    });
    editor.addEventListener("blur", () => close(true));
    if (signal?.aborted) {
        close(false);
    } else {
        signal?.addEventListener("abort", () => close(false), { once: true });
    }

    return () => close(true);
}

/**
 * The frame whose *name band* holds the point, topmost first.
 *
 * The band itself is the kernel's rule (`hitFrameTitle`): the strip above the
 * frame's top border where the title draws, its width the measured title
 * capped at the frame's own — the box upstream's clickable div occupies
 * (`App.tsx:2273-2287`). What stays here is the walk and the metric: the
 * render order decides who is on top, and the measurement is this page's
 * canvas answering for the ink it laid down. A band rule that lived on both
 * sides of the boundary would let the editor open where nothing was drawn.
 *
 * @param {object[]} frameOps the `Mark.Frame` ops of the render list, in
 *   scene order.
 * @param {{x: number, y: number}} at the point, in scene coordinates.
 * @param {(text: string, fontSize: number) => number} measureText the
 *   measurer, in scene units — the caller closes over its canvas so the
 *   measured width is the width the title was painted with.
 * @param {object} session the kernel, whose rule the question is.
 * @returns {object | null} the frame op under the point, or `null`.
 */
export function frameNameAt(frameOps, at, measureText, session) {
    for (let i = frameOps.length - 1; i >= 0; i -= 1) {
        const op = frameOps[i];
        if (!op || !op.name || !op.style) {
            continue;
        }
        const measured = measureText(op.name, op.style.titleFontSize);
        if (
            session.hitFrameTitle(
                op.x,
                op.y,
                op.width,
                op.style.titleOffsetY,
                op.style.titleFontSize,
                at.x,
                at.y,
                measured,
            )
        ) {
            return op;
        }
    }
    return null;
}

/**
 * The caret index a click on the editor's sheet rests at.
 *
 * The text tool's click over an existing text opens the editor with the
 * caret where the click landed — upstream seats it the same way, from the
 * scene point to an index into the body (`textWysiwyg.tsx`
 * `getCaretIndexFromInitialSceneCoords`: the row the click rests on, then
 * the character whose middle the click is past). The receipt
 * `text-edit-existing` is this answer: a click just past the `H` of
 * `Hola` seats the caret between the `H` and the `o`, and what the user
 * types inserts there instead of at the end.
 *
 * The rows the sheet lays out are computed here the way the sheet itself
 * wraps: an auto-sized text wraps nowhere and its rows are the body's own
 * lines, a fixed one wraps greedily at the box's width, one space
 * consumed per break — so each row's start in the body is the previous
 * rows' length plus one separator each. The measurement is injected: the
 * caller closes over the canvas and the font the sheet is laid out with,
 * because the widths that decide where the caret rests are the widths
 * the sheet was drawn at.
 *
 * @param {string} body the text the editor opens with.
 * @param {{x: number, y: number, width?: number, lineHeight?: number,
 *          textAlign?: string, autoResize?: boolean}} box the editor's
 *   sheet, in screen pixels — the `textEditorBox` answer.
 * @param {{x: number, y: number}} at the click, in the same space as the box.
 * @param {(text: string) => number} measureText the measurer, closed over
 *   the sheet's own font.
 * @returns {number} the caret index into `body`.
 */
export function caretIndexInBox(body, box, at, measureText) {
    const rows = caretRows(body, box, measureText);
    if (rows.length === 0) {
        return 0;
    }
    const lineHeight = Number.isFinite(box.lineHeight) && box.lineHeight > 0 ? box.lineHeight : 0;
    const rowIndex = lineHeight > 0
        ? Math.max(0, Math.min(rows.length - 1, Math.floor((at.y - box.y) / lineHeight)))
        : 0;
    const row = rows[rowIndex];
    if (row.text === "") {
        return row.start;
    }
    const lineWidth = measureText(row.text);
    const width = Number.isFinite(box.width) ? box.width : lineWidth;
    const lineStartX = box.textAlign === "center"
        ? (width - lineWidth) / 2
        : box.textAlign === "right"
          ? width - lineWidth
          : 0;
    const relativeX = at.x - box.x - lineStartX;
    let previous = 0;
    for (let i = 0; i < row.text.length; i += 1) {
        const ahead = measureText(row.text.slice(0, i + 1));
        if (relativeX <= previous + (ahead - previous) / 2) {
            return row.start + i;
        }
        previous = ahead;
    }
    return row.start + row.text.length;
}

/**
 * The rows the editor's sheet lays `body` out into, and where each starts.
 *
 * @param {string} body the text the editor opens with.
 * @param {{width?: number, autoResize?: boolean}} box the editor's sheet.
 * @param {(text: string) => number} measureText the measurer.
 * @returns {{text: string, start: number}[]} one record per row.
 */
function caretRows(body, box, measureText) {
    const rows = [];
    let start = 0;
    if (box.autoResize) {
        // `white-space: pre` wraps nowhere: the rows are the body's own
        // lines, each followed by the newline that ends it.
        for (const line of body.split("\n")) {
            rows.push({ text: line, start });
            start += line.length + 1;
        }
        return rows;
    }
    // `pre-wrap` breaks at a space when the row outgrows the box, one
    // space consumed per break: the same greedy walk a textarea runs,
    // which is why each break costs the row's length plus one.
    const limit = Number.isFinite(box.width) && box.width > 0 ? box.width : Infinity;
    for (const paragraph of body.split("\n")) {
        let row = "";
        let rowStart = start;
        for (const word of paragraph.split(" ")) {
            const candidate = row === "" ? word : `${row} ${word}`;
            if (row !== "" && measureText(candidate) > limit) {
                rows.push({ text: row, start: rowStart });
                start += row.length + 1;
                rowStart = start;
                row = word;
            } else {
                row = candidate;
            }
        }
        rows.push({ text: row, start: rowStart });
        start += row.length + 1;
    }
    return rows;
}
