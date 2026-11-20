// The text editor's wiring: the double click that opens an editor, and the two inks.
//
// # What this file is
//
// Two binders the page's entry point used to hold inline. `bindTextEditing` puts the
// double click on the canvas: it releases a pinned segment, starts the vertex edit mode,
// renames a frame, or mounts the text editor over a text or over a shape that gets a
// label. `bindInks` mounts the stroke and background colour pickers over the style door.
// Both moved whole; the rules they apply (what a double click means, what a picker
// writes) stay in `text-edit.mjs`, `vertex-edit.mjs`, `bound-text.mjs` and
// `colour-picker.mjs`.
//
// # What they are handed
//
// Everything the page owns arrives by name. The session and the paint context are the
// mount's own, so the binders are called from the boot, after both exist, and each is
// called where its inline block used to sit, so the order of the listeners does not move.
// Every listener is registered with the mount's `signal`, so `destroy` releases it.
//
// # What they keep
//
// The open editor, if any: a second double click while one is up does nothing, because
// the editor's own blur removes it before a new one is asked for.

import { arrowLabelJsonFor, boundTextJsonFor, createdTextJsonFor } from "./tools.mjs";
import { elementIdAt, frameNameAt, openTextEditor } from "./text-edit.mjs";
import { releaseTarget, vertexEditableIdAt } from "./vertex-edit.mjs";
import { editTarget, textToolTargetAt } from "./bound-text.mjs";
import { caretIndexInBox } from "./text-edit.mjs";
import { bindColourPicker } from "./colour-picker.mjs";

/**
 * @typedef {object} TextCreationDeps
 * @property {object} document
 */

/**
 * The line box a free text is born with: the size the birth is written with
 * (`createdTextJsonFor`: `fontSize` 20, `lineHeight` 1.25) times the line
 * height — upstream's `getLineHeightInPx` (`App.tsx:757`).
 */
const FREE_TEXT_LINE_BOX = 25;

/**
 * The width of an empty text, and so of the sheet that writes it: upstream's
 * empty body measures 8px (`textWysiwyg.tsx` lays the editor over the
 * element's own box, and the empty element's width is that).
 */
const EMPTY_TEXT_WIDTH = 8;

/**
 * Mount the **creation** editor: the sheet the text tool's click opens, with
 * no element behind it — upstream opens its own editor on the click and the
 * element is born when the user confirms (measured by the `create-text`
 * receipt, d3a9c2a1). The mount owns the sheet, its place on the screen and
 * the hand-off of the body, and nothing else: the settle — insert, select,
 * back to the selection tool — stays with the pipeline, which is where every
 * other creation settles. The place comes from the session's own transform,
 * read here and not in the gesture: the sheet is a DOM body over the canvas,
 * and the chrome-to-screen reads belong to the wires that put DOM on the
 * page, not to the pointer walk. A blank body reaches the settle as it was
 * typed, because the refusal is the settle's rule, not the sheet's.
 *
 * @param {TextCreationDeps} deps
 * @returns {{ mountTextEditor: (request: { session: object, sceneX: number, sceneY: number, onCommit: (body: string) => void, onCancel?: () => void }) => void }}
 */
export function bindTextCreation(deps) {
    const { document } = deps;
    // The birth editor has no binder-supplied theme: the page's root carries
    // it (`theme.mjs`), and a document with no root — the unit road's fake —
    // is a light page.
    const dark = () => document.documentElement?.dataset?.theme === "dark";
    const textEditLayer = document.getElementById("text-edit-layer");
    let activeTextEditor = null;
    /**
     * What the editor over `id` should wear: the element's box, its type and
     * its ink.
     *
     * The box is the render list's, not the document's, because the render list
     * is where the kernel has already resolved the font family to a CSS stack
     * (`crates/nextdraw-core/src/font.rs`, upstream's `getFontFamilyString`)
     * and laid the text out at the zoom the canvas is painting. The document
     * answers the two things the op does not carry: the ink the element was
     * given and whether the text auto-sizes. A road with no op (the fake page
     * of the unit suite, an element the renderer has not seen) keeps the
     * click's own position: the editor still opens, it just has no box to
     * cover.
     *
     * @param {string} id the text element.
     * @returns {object|null}
     */
    const textEditorBox = (id) => {
        const op = frames?.take?.(session)?.items?.find((item) => item?.Text?.id === id)?.Text;
        let element = null;
        try {
            element = JSON.parse(session.toJson() ?? "null")?.elements?.find((candidate) => candidate.id === id) ?? null;
        } catch {
            element = null;
        }
        if (!op && !element) {
            return null;
        }
        // The element's **box**, not the text run's: upstream's editor covers
        // the element (`textWysiwyg.tsx` writes the element's `width`/`height`
        // and lets `textAlign` place the words inside it). The render op is the
        // only place the font family is already a CSS stack, and it carries the
        // line advance the text was painted with; the box comes from the
        // document.
        const [zeroX] = session.sceneToScreen(0, 0);
        const [unitX] = session.sceneToScreen(1, 0);
        const zoom = unitX - zeroX;
        const box = element ?? op;
        const [left, top] = session.sceneToScreen(box.x, box.y);
        const [right, bottom] = session.sceneToScreen(box.x + box.width, box.y + box.height);
        const fontSize = element?.fontSize ?? op?.fontSize;
        const lineAdvance = Number.isFinite(op?.lineAdvance)
            ? op.lineAdvance
            : Number.isFinite(fontSize) && Number.isFinite(element?.lineHeight)
              ? fontSize * element.lineHeight
              : undefined;
        return {
            x: left,
            y: top,
            width: Math.max(right - left, 1),
            height: Math.max(bottom - top, 1),
            font: Number.isFinite(op?.fontSize) ? `${op.fontSize * zoom}px ${op.fontFamily}` : undefined,
            lineHeight: Number.isFinite(lineAdvance) ? lineAdvance * zoom : undefined,
            textAlign: element?.textAlign ?? op?.textAlign,
            // A bound label is the container's width and wraps; a standalone
            // text auto-sizes unless the document said otherwise.
            autoResize: element === null || (element.autoResize !== false && element.containerId == null),
            strokeColour: typeof element?.strokeColor === "string" ? element.strokeColor : undefined,
        };
    };
    return {
        mountTextEditor({ session, sceneX, sceneY, onCommit, onCancel, fixedWidth }) {
            if (activeTextEditor) {
                return;
            }
            const [screenX, screenY] = session.sceneToScreen(sceneX, sceneY);
            // A birth the drag sized opens at the drag's width and wraps at
            // it: upstream's wysiwyg sits over the live element the drag
            // already fixed (`dragElements.ts:280-313`), and the sheet's box
            // is that width. A birth nobody dragged opens as a caret and
            // grows with the body.
            const fixed = Number.isFinite(fixedWidth) && fixedWidth > 0;
            const zoom = session.zoom();
            activeTextEditor = openTextEditor({
                container: textEditLayer,
                // The sheet sits over the element it writes: upstream's
                // wysiwyg takes its place and its box from the element's own
                // (`textWysiwyg.tsx:478-490`), and the element is born there
                // when the sheet is confirmed. That is also what keeps the
                // pointer that opened the sheet over the sheet: a pointerdown
                // there belongs to the sheet and not to the canvas, so the
                // birth survives it instead of being closed by the blur.
                x: screenX,
                y: screenY,
                initialBody: "",
                // A birth has no element yet, so it has no box to cover: it opens
                // as the empty text's own box — a caret wide, one line tall —
                // and grows with the body, the way upstream's wysiwyg does. Its
                // ink is the default text ink, put through the theme's filter,
                // so the caret and the first word are the colours the born
                // element will be painted with.
                width: fixed ? fixedWidth * zoom : EMPTY_TEXT_WIDTH,
                height: FREE_TEXT_LINE_BOX * zoom,
                autoResize: !fixed,
                strokeColour: "#1e1e1e",
                dark: dark(),
                // The creation is a text road: it submits the way upstream's
                // wysiwyg does — Escape and Ctrl/Cmd+Enter, plain Enter as
                // the newline — the keying the receipt `create-text` drove
                // when it measured this road (type the body, then Escape).
                multiline: true,
                onCommit: (body) => {
                    activeTextEditor = null;
                    onCommit(body);
                },
                onCancel: () => {
                    activeTextEditor = null;
                    if (onCancel) {
                        onCancel();
                    }
                },
                createElement: (tag) => document.createElement(tag),
            });
        },
    };
}

/**
 * @typedef {object} InkDeps
 * @property {object} document
 * @property {object} session
 * @property {object} ctx The paint context.
 * @property {(session: object, ctx: object) => void} paint
 * @property {object} statusLine
 * @property {() => void} renderStatus
 * @property {{ signal: AbortSignal }} lifecycle
 * @property {() => string} [theme] the theme on the page, for the swatches'
 *   dark colours.
 */

/**
 * Mount the stroke and background colour pickers.
 *
 * @param {InkDeps} deps
 * @returns {{ syncStrokeColour: Function, syncBackgroundColour: Function }}
 */
export function bindInks(deps) {
    const { document, session, ctx, paint, statusLine, renderStatus, lifecycle, text, theme = () => "light" } = deps;
    // The two inks: a palette and a hex entry each, over the same write door.
    const bindInk = (rowId, property) =>
        bindColourPicker({
            host: document.getElementById(rowId),
            property,
            session,
            paintFn: () => paint(session, ctx),
            createElement: (tag) => document.createElement(tag),
            signal: lifecycle.signal,
            text,
            theme,
            onError: (error) => {
                statusLine.setProblem(`setStyle failed: ${error.message ?? error}`);
                renderStatus();
            },
        }).sync;
    return {
        syncStrokeColour: bindInk("stroke-colour-row", "strokeColor"),
        syncBackgroundColour: bindInk("background-colour-row", "backgroundColor"),
    };
}

/**
 * @typedef {object} TextEditingDeps
 * @property {HTMLCanvasElement} canvas
 * @property {object} document
 * @property {object} session
 * @property {object} ctx The paint context.
 * @property {{ take: (session: object) => { items: object[] } }} frames
 * @property {() => boolean} viewOnlyNow
 * @property {(event: object) => { x: number, y: number }} canvasPointFromEvent
 * @property {(session: object, ctx: object) => void} paint
 * @property {object} statusLine
 * @property {() => void} renderStatus
 * @property {{ signal: AbortSignal }} lifecycle
 * @property {() => string} [theme] the theme on the page, for the editor ink.
 */

/**
 * Put the double click on the canvas.
 *
 * @param {TextEditingDeps} deps
 */
export function bindTextEditing(deps) {
    const {
        canvas, document, session, ctx, frames, viewOnlyNow, canvasPointFromEvent,
        paint, statusLine, renderStatus, lifecycle, mountTextEditor, platform = "",
        theme = () => "light",
    } = deps;
    const hasCommandModifier = (event) =>
        event.ctrlKey === true || (event.metaKey === true && /Mac|iPhone|iPad|iPod/i.test(platform));
    // H5.11 inline editing. A dblclick on a text element mounts an
    // editor on top of the AABB; commit on blur (or Enter without
    // Shift) calls `setText`, which the kernel stores under
    // `unmodelled["text"]`. The `textOf(id)` round-trip then returns
    // the new body. The discrimination is a single `kindOf`
    // call: a kind of `"text"` is the only one that gets an editor.
    // Other shapes (rectangle, ellipse, line, …) get nothing on
    // dblclick, which is the upstream behaviour: only text has a body
    // to edit. The new text on commit triggers a paint, which is the
    // same path a `setStyle` triggers — the kernel is the source
    // of truth and the client repaints after every mutation.
    const textEditLayer = document.getElementById("text-edit-layer");
    let activeTextEditor = null;
    /**
     * What the editor over `id` should wear: the element's box, its type and
     * its ink.
     *
     * The box is the render list's, not the document's, because the render list
     * is where the kernel has already resolved the font family to a CSS stack
     * (`crates/nextdraw-core/src/font.rs`, upstream's `getFontFamilyString`)
     * and laid the text out at the zoom the canvas is painting. The document
     * answers the two things the op does not carry: the ink the element was
     * given and whether the text auto-sizes. A road with no op (the fake page
     * of the unit suite, an element the renderer has not seen) keeps the
     * click's own position: the editor still opens, it just has no box to
     * cover.
     *
     * @param {string} id the text element.
     * @returns {object|null}
     */
    const textEditorBox = (id) => {
        const op = frames?.take?.(session)?.items?.find((item) => item?.Text?.id === id)?.Text;
        let element = null;
        try {
            element = JSON.parse(session.toJson() ?? "null")?.elements?.find((candidate) => candidate.id === id) ?? null;
        } catch {
            element = null;
        }
        if (!op && !element) {
            return null;
        }
        // The element's **box**, not the text run's: upstream's editor covers
        // the element (`textWysiwyg.tsx` writes the element's `width`/`height`
        // and lets `textAlign` place the words inside it). The render op is the
        // only place the font family is already a CSS stack, and it carries the
        // line advance the text was painted with; the box comes from the
        // document.
        const [zeroX] = session.sceneToScreen(0, 0);
        const [unitX] = session.sceneToScreen(1, 0);
        const zoom = unitX - zeroX;
        const box = element ?? op;
        const [left, top] = session.sceneToScreen(box.x, box.y);
        const [right, bottom] = session.sceneToScreen(box.x + box.width, box.y + box.height);
        const fontSize = element?.fontSize ?? op?.fontSize;
        const lineAdvance = Number.isFinite(op?.lineAdvance)
            ? op.lineAdvance
            : Number.isFinite(fontSize) && Number.isFinite(element?.lineHeight)
              ? fontSize * element.lineHeight
              : undefined;
        return {
            x: left,
            y: top,
            width: Math.max(right - left, 1),
            height: Math.max(bottom - top, 1),
            font: Number.isFinite(op?.fontSize) ? `${op.fontSize * zoom}px ${op.fontFamily}` : undefined,
            lineHeight: Number.isFinite(lineAdvance) ? lineAdvance * zoom : undefined,
            textAlign: element?.textAlign ?? op?.textAlign,
            // A bound label is the container's width and wraps; a standalone
            // text auto-sizes unless the document said otherwise.
            autoResize: element === null || (element.autoResize !== false && element.containerId == null),
            strokeColour: typeof element?.strokeColor === "string" ? element.strokeColor : undefined,
        };
    };
    const openFreeTextEditor = (event, at) => {
        if (typeof mountTextEditor !== "function") {
            return false;
        }
        const [pointerX, pointerY] = session.screenToScene(at.x, at.y);
        // A free text is born with its first line box **centred on the
        // pointer**: upstream's `startTextEditing` puts the element half a
        // line above the point — «Free text starts from a point cursor, so
        // center the first line box on it» (`App.tsx:753-760`) — and the
        // sheet that writes it sits over the element's own box
        // (`textWysiwyg.tsx:478-490`), so the sheet and the element are born
        // at the same place. The measured double click on the empty canvas
        // puts its text at (400, 287.5) for a pointer at (400, 300).
        const sceneX = pointerX;
        const sceneY = pointerY - FREE_TEXT_LINE_BOX / 2;
        mountTextEditor({
            session,
            sceneX,
            sceneY,
            onCommit: (body) => {
                if (!body.trim()) {
                    return;
                }
                const id = crypto.randomUUID();
                try {
                    session.insert(createdTextJsonFor(id, body, sceneX, sceneY), undefined);
                    session.setSelection([id]);
                    paint(session, ctx);
                } catch (error) {
                    statusLine.setProblem(`text creation failed: ${error.message ?? error}`);
                    renderStatus();
                }
            },
            onCancel() {},
        });
        return true;
    };
    const openArrowLabelEditor = (target) => {
        const label = JSON.parse(arrowLabelJsonFor(crypto.randomUUID()));
        try {
            session.beginArrowLabel(target.container, JSON.stringify(label));
        } catch (error) {
            statusLine.setProblem(`text edit failed: ${error.message ?? error}`);
            renderStatus();
            return false;
        }
        const provisional = JSON.parse(session.toJson()).elements.find(
            (element) => element.type === "text" && element.containerId === target.container,
        );
        if (provisional === undefined) {
            session.cancelArrowLabel();
            statusLine.setProblem("text edit failed: provisional arrow label is missing");
            renderStatus();
            return false;
        }
        const [screenX, screenY] = session.sceneToScreen(
            provisional.x + provisional.width / 2,
            provisional.y + provisional.height / 2,
        );
        activeTextEditor = openTextEditor({
            container: textEditLayer,
            x: screenX - 2,
            y: screenY - 14,
            initialBody: "",
            multiline: true,
            onInput: (body) => {
                try {
                    session.updateArrowLabel(body);
                    paint(session, ctx);
                } catch (error) {
                    statusLine.setProblem(`text edit failed: ${error.message ?? error}`);
                    renderStatus();
                }
            },
            onCommit: (body) => {
                activeTextEditor = null;
                try {
                    session.finishArrowLabel(body);
                } catch (error) {
                    statusLine.setProblem(`text edit failed: ${error.message ?? error}`);
                    renderStatus();
                    return;
                }
                paint(session, ctx);
            },
            onCancel: () => {
                activeTextEditor = null;
                try {
                    session.cancelArrowLabel();
                } catch (error) {
                    statusLine.setProblem(`text edit failed: ${error.message ?? error}`);
                    renderStatus();
                    return;
                }
                if (!lifecycle.signal.aborted) {
                    paint(session, ctx);
                }
            },
            signal: lifecycle.signal,
            createElement: (tag) => document.createElement(tag),
        });
        paint(session, ctx);
        return true;
    };
    canvas.addEventListener("dblclick", (event) => {
        // A double click edits: it opens the text editor and the vertex edit
        // mode. While the page is view-only it does neither.
        if (viewOnlyNow()) {
            return;
        }
        // The dblclick must come from a real click on the canvas, not
        // a focus event that bubbled from the inline editor. The
        // editor's own `blur` removes the textarea before this can
        // fire, so the layer is always empty when a new editor is
        // requested.
        if (activeTextEditor) {
            return;
        }
        // The edit mode for the vertices. Upstream starts it on a double click
        // over a linear element (`packages/excalidraw/components/App.tsx:6205`),
        // and it is the only mode in which the vertices are on the screen: the
        // box is not drawn while they are, because a vertex of a polyline sits
        // on the corner of its own box.
        //
        // The pointer is read in canvas coordinates, the same space the
        // pointer events are read in, so the answer does not depend on where
        // the canvas sits on the page.
        const at = canvasPointFromEvent(event);
        // The release of a pinned segment. Upstream drops the pin when the user
        // double-clicks the handle of a segment that is pinned
        // (`packages/excalidraw/components/App.tsx:6292`), and the chain is derived
        // again without it.
        //
        // The chrome is what answers: the handles of the segments are only on the
        // screen while the element is being edited, so a double click on a handle
        // of an element that is not being edited finds nothing and opens the edit
        // mode instead, the way upstream does.
        const editingId = session.editingId();
        const selected = session.selectedIds();
        const releaseId = editingId ?? (selected?.length === 1 ? selected[0] : undefined);
        if (releaseId !== undefined) {
            const release = releaseTarget(session, at.x, at.y, releaseId);
            if (release !== null) {
                try {
                    session.releaseFixedSegment(release.id, release.segment);
                } catch (error) {
                    // Chrome already identified a real segment. The kernel uses
                    // no_such_segment when that segment has no pin to release;
                    // upstream consumes this double click without editing text.
                    if (String(error.message ?? error).startsWith("no_such_segment:")) {
                        return;
                    }
                    statusLine.setProblem(`segment release failed: ${error.message ?? error}`);
                    renderStatus();
                    return;
                }
                paint(session, ctx);
                return;
            }
        }
        const vertexEditable = vertexEditableIdAt(session, at.x, at.y, hasCommandModifier(event));
        if (vertexEditable !== null) {
            if (session.beginEditing(vertexEditable)) {
                paint(session, ctx);
            }
            return;
        }
        // The group the double click enters (`WF-SELECT-08`). Upstream's branch runs
        // before the text editor (`packages/excalidraw/components/App.tsx:6359-6380`), so
        // the first double click on a member of the selected group enters it — the member
        // alone is then the selection, inside the group — and a second double click, with
        // the member alone inside the group, is what opens its text. The kernel answers
        // whether there is a group to enter; a `false` falls through to the rest of the
        // double click's meanings.
        const hitId = elementIdAt(session, at.x, at.y);
        if (hitId !== null && session.enterGroup(hitId)) {
            paint(session, ctx);
            return;
        }
        // The frame's name. Upstream draws it as a DOM div above the frame and
        // turns it into an input on the double click
        // (`packages/excalidraw/components/App.tsx:2204-2264`); here the title
        // is canvas ink, so the band it draws in is the click target, and the
        // editor is the same sheet the text edit mounts. The commit is one
        // `setName` — one undo — and an untouched title writes nothing, the
        // way upstream's blur resets without a change.
        const frameOps = [];
        for (const item of frames.take(session).items) {
            const op = item.Mark && item.Mark.Frame;
            if (op) {
                frameOps.push(op);
            }
        }
        const named = frameNameAt(
            frameOps,
            at,
            (text, fontSize) => {
                ctx.font = `${fontSize}px Helvetica, sans-serif`;
                return ctx.measureText(text).width;
            },
            session,
        );
        if (named !== null) {
            const initialTitle = named.name;
            activeTextEditor = openTextEditor({
                container: textEditLayer,
                x: event.clientX - 4,
                y: event.clientY - 18,
                initialBody: initialTitle,
                // The title opens selected: upstream's own input focuses with
                // `select()` (`App.tsx:2220`), so the first glyph typed
                // replaces the name (GROUP-05) instead of appending to it.
                selectAll: true,
                font: "14px Helvetica, sans-serif",
                onCommit: (newTitle) => {
                    activeTextEditor = null;
                    if (newTitle !== initialTitle) {
                        try {
                            session.setName(named.id, newTitle);
                        } catch (error) {
                            statusLine.setProblem(`frame rename failed: ${error.message ?? error}`);
                            renderStatus();
                            return;
                        }
                    }
                    paint(session, ctx);
                },
                onCancel: () => {
                    activeTextEditor = null;
                },
                createElement: (tag) => document.createElement(tag),
            });
            return;
        }
        // The point is read in canvas coordinates, like every other read of
        // the pointer in this handler: the kernel's hit test takes CSS
        // pixels relative to the canvas's top-left. The window's
        // coordinates were read here, and the two are the same only while
        // the canvas sits at the top-left of the page — so the double
        // click found nothing at all as soon as the page had a toolbar
        // above it.
        // What a double click means is the kernel's answer: a text to edit, or
        // a shape that gets one. The page asks and does what it is told — the
        // kinds of shape that hold a text, and whether this one already holds
        // it, are rules of the format.
        //
        // A point that hits no element still has a meaning for the text roads:
        // the kernel's text-tool rule looks a container up by its **box**, and
        // the middle of an unfilled shape is inside it even though the shape's
        // hit test has no interior to hit. Enter is this road — it dispatches
        // the double click at the selection's middle (`TEXT-07`, `KEY-13`) —
        // and the reference's own canvas double click asks the same question
        // (`App.tsx:6388`: a single selected container is what the double
        // click is about, wherever the click lands).
        const target = hitId !== null
            ? editTarget(session, hitId)
            : textToolTargetAt(session, at.x, at.y);
        if (target === null) {
            // The canvas's own double click: when no text and no container
            // matched, the pin's `handleCanvasDoubleClick` still ends at
            // `startTextEditing` — free text at the pointer
            // (`App.tsx:6438-6443`), whatever the pointer rests over. Alt is
            // the selection's cycling modifier and the double click it
            // carries opens nothing (`App.tsx:6218-6230`).
            if (event.altKey) {
                return;
            }
            openFreeTextEditor(event, at);
            return;
        }
        if (target.arrowLabel && hasCommandModifier(event)) {
            openFreeTextEditor(event, at);
            return;
        }
        if (target.arrowLabel && target.text === undefined) {
            openArrowLabelEditor(target);
            return;
        }
        // A new label stays in the editor until it has a body. Keeping the
        // draft outside the document preserves redo and unrelated edits.
        const initialBody = target.text !== undefined ? session.textOf(target.text) : "";
        const box = target.text !== undefined ? textEditorBox(target.text) : null;
        // The text tool's click over a text seats the caret where the click
        // landed — upstream hands its editor the scene point
        // (`App.textTool.ts:296-300`, `initialCaretSceneCoords`) and the
        // wysiwyg turns it into an index through the laid-out rows. The
        // mapping is the editor's own measurement, so the caret rests over
        // the glyph the sheet draws. A real double click names no seat: the
        // editor keeps its end-of-body one, the way it always has.
        const caretIndex = event.caretAtClick === true && box !== null && initialBody.length > 0
            ? caretIndexInBox(initialBody, box, at, (text) => {
                if (typeof box.font === "string") {
                    ctx.font = box.font;
                }
                return ctx.measureText(text).width;
            })
            : undefined;
        activeTextEditor = openTextEditor({
            container: textEditLayer,
            // The editor covers the element it edits, as upstream's wysiwyg
            // does. An element the renderer has not seen yet keeps the old
            // click-relative seat, so the road still opens.
            x: box?.x ?? event.clientX - 2,
            y: box?.y ?? event.clientY - 14,
            width: box?.width,
            height: box?.height,
            font: box?.font,
            lineHeight: box?.lineHeight,
            textAlign: box?.textAlign ?? "left",
            autoResize: box?.autoResize ?? false,
            strokeColour: box?.strokeColour,
            dark: theme() === "dark",
            initialBody,
            caretIndex,
            // A text edit is a text road too — the same wysiwyg upstream
            // opens for it: Escape submits, plain Enter is the newline.
            multiline: true,
            onCommit: (newBody) => {
                activeTextEditor = null;
                let created = false;
                if (newBody !== initialBody || (target.text !== undefined && !newBody.trim())) {
                    try {
                        // A body that is only white space **deletes**: upstream's
                        // own submit decides `isDeleted = !nextOriginalText.trim()`
                        // and removes the element (`App.text.ts:301-302`). The
                        // kernel keeps what it is told — a zero-width box nothing
                        // can select or reopen — so the lifecycle decision is the
                        // driver's, and leaving the element here would be a label
                        // the scene keeps and the user has lost.
                        if (target.text !== undefined && !newBody.trim()) {
                            session.delete(target.text);
                        } else if (target.text !== undefined) {
                            session.setText(target.text, newBody);
                        } else if (newBody.trim()) {
                            // A shape with no label gets one. The kernel wraps
                            // the body at the shape's width, grows the shape if
                            // the label does not fit and puts the label in the
                            // middle of it — one action, one undo step. A body
                            // of white space creates nothing: the same rule the
                            // birth road applies to a click that never typed.
                            const label = target.arrowLabel
                                ? JSON.parse(arrowLabelJsonFor(crypto.randomUUID()))
                                : null;
                            if (label !== null) {
                                label.unmodelled.text = newBody;
                                label.originalText = newBody;
                            }
                            session.bindText(
                                target.container,
                                label === null
                                    ? boundTextJsonFor(crypto.randomUUID(), newBody)
                                    : JSON.stringify(label),
                            );
                            created = true;
                        }
                    } catch (error) {
                        statusLine.setProblem(`text edit failed: ${error.message ?? error}`);
                        renderStatus();
                        return;
                    }
                }
                // The editor closed without a label: upstream's finalize leaves
                // the container selected — the shape the user was typing into
                // is the page's own answer (the group-exit observation's end
                // state, GROUP-04). A road that created nothing and selected
                // nothing would end a gesture whose every other step matched.
                if (created === false && target.text === undefined && target.container !== undefined) {
                    session.setSelection([target.container]);
                }
                paint(session, ctx);
            },
            onCancel: () => {
                activeTextEditor = null;
            },
            createElement: (tag) => document.createElement(tag),
        });
    }, { signal: lifecycle.signal });
}
