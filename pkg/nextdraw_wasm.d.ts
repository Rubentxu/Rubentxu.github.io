/* tslint:disable */
/* eslint-disable */

/**
 * A live editing session held on the Rust side of the boundary.
 */
export class Session {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Move the selection so every member shares one edge or centre, in one
     * atomic transition.
     *
     * `axis` is `"horizontal"` or `"vertical"`; `mode` is `"start"`, `"center"`
     * or `"end"`. The two together are the six-way gesture, where `"start"`
     * means left on a horizontal axis and top on a vertical one — the same
     * naming upstream's toolbar uses.
     *
     * The reference is the selection's own bounding box, so this lines the
     * elements up with each other wherever they are, rather than to the canvas.
     * Fewer than two selected elements is a free no-op: an element is already
     * aligned with itself.
     *
     * # Errors
     *
     * `bad_align_axis` and `bad_align_mode` for an unrecognised string, so the
     * JS side can branch on a stable prefix rather than matching a message.
     * `unknown_element` when the selection names nothing the scene holds:
     * there was no element to align.
     */
    alignAll(axis: string, mode: string): void;
    /**
     * Whether any element in the scene is locked.
     *
     * The predicate behind the canvas menu's "Unlock all": the verb is only
     * offered when there is something to unlock.
     *
     * The question crosses as a question. A client that kept its own count of
     * what is locked would be a second truth about the document, and one that
     * goes stale as soon as anything else changes it.
     */
    anyLocked(): boolean;
    beginArrowLabel(container: string, json: string): void;
    /**
     * Start editing the vertices of an element.
     *
     * The double click is what starts it upstream
     * (`packages/excalidraw/components/App.tsx:6205`), and it starts it only
     * for a linear element: a rectangle has no vertices to edit, and a locked
     * element cannot be edited at all.
     *
     * The answer is a boolean and not an error, because the client asks this
     * question on every double click on the canvas and most of them are not
     * asking for an edit. A refusal here is not a failure: it is the answer
     * "this element has no vertices", and the client carries on.
     */
    beginEditing(id: string): boolean;
    /**
     * Seed the conversion panel's cache for this selection, and forget the previous
     * panel's.
     *
     * The client calls this on the Tab that opens the panel. Upstream's cache lives as
     * long as the popup is mounted; this is the open half of that lifetime, and the
     * conversion itself writes the snapshots a return visit restores.
     */
    beginShapeSwitch(): void;
    /**
     * Begin a freehand stroke at a point on the screen.
     *
     * The stroke is measured with the zoom of the view right now, and keeps
     * that zoom for its whole life: a stroke whose points were measured with
     * two different transforms is a stroke nobody can say which transform
     * produced which point.
     *
     * The answer is the scene point the stroke started at — the origin its
     * points are relative to — as `[x, y]`.
     */
    beginStroke(x: number, y: number): Float64Array;
    /**
     * Answer an end drop of a turning arrow.
     *
     * The endpoint names which end was dropped (`"start"` or `"end"`), and the
     * coordinates are the scene position the pointer was released at. The call
     * belongs inside the drag's capture: tying the end and moving it there are
     * one gesture and one undo step.
     *
     * The zoom is the session's own. A caller that sent its own copy of it
     * would be sending a second truth about how big the drawing looks, and the
     * reach of a binding travels with the zoom.
     *
     * `alt` is the modifier the pointer lifted with: the reference's Alt forces
     * an "inside" tie at the pointer, even when the drop is outside the shape.
     * Grid mode is read from the session's view state, not from here.
     *
     * # Errors
     *
     * `unknown_element` for an id the session does not hold.
     */
    bindArrowEnd(id: string, endpoint: string, x: number, y: number, alt?: boolean | null): void;
    /**
     * Create a text bound to a container.
     *
     * The text is the caller's — its id and its body — and its **geometry is
     * not**: the kernel wraps the body at the container's width, measures it,
     * grows the container if the label does not fit, and places the label in the
     * middle of it. A client that sent a box for the label would be
     * sending a claim the kernel checks and discards, exactly as it does with
     * every other text (`Action::Insert`).
     *
     * One transition, one undo step: creating a label and fitting it to its
     * shape is one thing the user did.
     *
     * # Errors
     *
     * `unknown_element` for a container the session does not hold,
     * `not_a_container` for an element that cannot hold a text, and
     * `already_has_bound_text` for a container that already holds one.
     */
    bindText(container: string, text_json: string): void;
    /**
     * The bindable elements' side midpoints, projected to screen pixels as JSON pairs.
     */
    bindingMidpoints(): string;
    boundsOf(id: string): Float64Array;
    /**
     * Encode the frame into this session's buffer and return where it starts.
     *
     * This is the crossing H8.4 exists for. The JSON answer in [`Session::frame`]
     * is now the *oracle* rather than the product: it is what the tests that
     * compare the two encodings ask for, and nothing in the client calls it —
     * a guard in `client/wiring.test.mjs` fails if that ever changes.
     *
     * # What the pointer is
     *
     * An offset into this session's own `frame_buf`, which lives in Wasm linear
     * memory. It is valid until the next `buildFrame` on this session or until
     * the session is dropped, and the length is [`Session::frame_len`]. The
     * buffer is reused across calls rather than reallocated, so a long editing
     * session does not hand the allocator three megabytes per revision.
     *
     * # When the pointer stops being valid
     *
     * Three things end it: the next `buildFrame` on this session (the `Vec` may
     * reallocate and move), the session being dropped, and **any Wasm call that grows
     * linear memory** (`memory.grow` detaches the `ArrayBuffer` every view was made
     * over, and a detached view reads zeros without throwing). So the pointer is read
     * in the same turn it is returned, and the view over it is never stored:
     * `client/wire.mjs` `readFrame` builds it, decodes and drops it, and
     * `client/wire-view-confinement.test.mjs` fails if another module builds one.
     *
     * # Why `&mut self`
     *
     * Writing into a buffer that a client may be holding a view over is a
     * mutation, and this crate documents that it has no interior mutability: a
     * `&self` method that rewrote the buffer would make the pointer mean two
     * things at once. `buildFrame` and `frameLen` are separate calls on purpose,
     * so the client reads the length before it reads the bytes.
     */
    buildFrame(resources_revision: number): number;
    /**
     * Whether the session holds any undone scenes a `redo` could restore.
     */
    canRedo(): boolean;
    /**
     * Whether the session holds any past scenes an `undo` could restore.
     *
     * Used by the UI to disable the undo button when the answer is `false`. Cheap
     * to call, called once per re-render; the test is one equality.
     */
    canUndo(): boolean;
    cancelArrowLabel(): void;
    /**
     * Refuse a document whose size is past the fence, before it has been read.
     *
     * The browser knows the size of a file without reading it: the size is what the
     * file system said when the picker handed the file over. The rule that says how
     * long a document may be belongs to the codec, and the codec is the one that
     * applies it — so the client measures the file, asks this, and the answer arrives
     * before the text does. A file that is too long is refused while it is still a
     * file, and nothing has to carry its bytes.
     *
     * The same rule [`Self::load_json_with_report`] applies to the text it parses,
     * read from the same declaration: one fence, two doors, and a document that is
     * too long is refused at whichever door it meets first. The door that reads the
     * text is the one that catches a document that arrived by another road — the
     * clipboard, the library — where there was no size to measure before the read.
     *
     * # Errors
     *
     * `document_too_large: …` when the size is past the limit, tagged by
     * [`codec_err_text`]. The refusal names the size that was passed and the size
     * that is allowed, so the user can see how far past the fence the file is.
     */
    checkDocumentBytes(bytes: number): void;
    /**
     * Clear every element in the scene, including locked elements, in one undoable action.
     *
     * Unlike `deleteAll`, this does not depend on the current selection. An empty
     * scene is a no-op.
     */
    clearScene(): void;
    /**
     * Drop every selected id.
     *
     * The empty-selection case is a no-op, not an error. The client calls
     * this when the user clicks outside any element, and may call it twice
     * in a row without harm.
     */
    clearSelection(): void;
    /**
     * The clipboard of this application as the text the system clipboard
     * carries.
     *
     * The same text the family of applications this one belongs to writes,
     * so what is copied here can be pasted by another one, and what another
     * one copied can be pasted here. The text is a drawing when the
     * clipboard holds elements and a body of text otherwise.
     *
     * # Errors
     *
     * `serialize: …` if the clipboard cannot be written. Reaching that would
     * be a defect in the codec rather than a user error, so the tag says
     * which crate to look at.
     */
    clipboardText(): string;
    /**
     * Snapshot the supplied ids into the clipboard, expanding any of
     * them to the whole group they belong to. Mirrors
     * [`Session::copy`].
     *
     * # Errors
     *
     * `unknown_element` if any supplied id is not in the scene, or
     * `bad_element_id` if any supplied id is empty.
     */
    copy(ids: string[]): number;
    /**
     * Answer what region of its bitmap an element shows, if any.
     *
     * The client maps a drag on the canvas into the bitmap's own pixels, and
     * that mapping needs to know three things: whether the element is an image
     * at all (nothing else has a bitmap to slice), whether a region is already
     * stored, and the region itself. The answer spells all three in one JSON
     * body — `{"cropped":true,"region":{…}}`, `{"cropped":false}`, or `null`
     * for an element that is not an image — so arming the crop gesture and
     * mapping the drag read one crossing instead of guessing from two.
     *
     * The element's box the drag is measured against is a separate question;
     * [`boundsOf`](Self::bounds_of) already answers it.
     *
     * # Errors
     *
     * `unknown_element`.
     */
    cropOf(id: string): string | undefined;
    /**
     * Remove the supplied ids from the scene and place a copy in
     * the clipboard, returning the ids that were removed in scene
     * order. Mirrors `Cmd+X`. The whole operation is one undo.
     *
     * A cut removes the selection and nothing else. What lands in the
     * clipboard is the selection as it was, whole, so the paste that
     * follows keeps the style, the groups and the frame the cut took
     * away.
     *
     * # Errors
     *
     * `unknown_element` if any supplied id is not in the scene, or
     * `bad_element_id` if any supplied id is empty.
     */
    cut(ids: string[]): string[];
    /**
     * Step the selected convertible elements to the next variant of their family, or the
     * previous one with `backward`, in one undoable action.
     *
     * Returns the name of the kind they became, or `undefined` when nothing was switched.
     */
    cycleSelectedShape(backward: boolean): string | undefined;
    /**
     * Delete every selected element in one atomic transition.
     *
     * The keyboard `Backspace` / `Delete` handler is a single user
     * intent and the undo stack must agree: a single `Cmd+Z` restores
     * every id, not one per id. Empty selection pushes no history
     * entry.
     *
     * # Errors
     *
     * `unknown_element` when the selection names nothing the scene holds:
     * there was no element to delete.
     */
    deleteAll(): void;
    /**
     * Remove an element.
     *
     * # Errors
     *
     * `unknown_element` for an id the session does not hold.
     */
    delete(id: string): void;
    /**
     * Move the selection so the free space between its members is the same along
     * `axis`, in one atomic transition — upstream's `distributeElements`
     * (`packages/element/src/distribute.ts`), the kernel's [`Session::distribute_all`].
     *
     * # Errors
     *
     * `bad_distribute_axis` for an unrecognised string, so the JS side can
     * branch on a stable prefix rather than matching a message.
     * `unknown_element` when the selection names nothing the scene holds.
     */
    distributeAll(axis: string): void;
    /**
     * A counter of everything the *document* holds: the scene alone.
     *
     * The frame counter above moves for the selection and the viewport too, and a
     * client that stored the drawing on every one of those moves would serialise the
     * whole scene on every click. This one moves when the drawing itself moves, and it
     * never saturates, so the hundred-and-first edit is as visible as the first.
     *
     * It crosses as a string for the same reason as [`Session::revision`]: JavaScript
     * has no `u64`, and a number would lose precision past 2^53 — silently, at which
     * point two different revisions read as one and the drawing stops being saved.
     */
    documentRevision(): string;
    /**
     * Clone every selected element in one atomic transition, offset
     * by `(dx, dy)`. Returns the fresh ids in scene order so the
     * client can re-select the clones without paying a second scene
     * round-trip.
     *
     * The clones arrive with an identity nobody else holds, their own
     * seed, their own groups and their references pointing at the
     * copies of what they were bound to.
     */
    duplicateAll(dx: number, dy: number): string[];
    /**
     * Clone the named elements and move the copies by the pointer's travel.
     *
     * This is the alt-drag's door, and it is one door for the same reason the
     * plain drag's is: the travel has to be measured in the scene and applied
     * to the copies without the client ever holding the transform. The
     * duplication and the move are one action, so one undo takes the copies
     * away and leaves the originals where they were.
     *
     * The travel is snapped by the same [`Session::duplicate_translate_all`]
     * answer the plain drag's commit uses, so holding Alt changes what moves
     * and not where it lands.
     *
     * The fresh ids come back in scene order so the page can select the copies
     * the way upstream does, without a second round-trip.
     *
     * # Errors
     *
     * `unknown_element` for an id the session does not hold.
     */
    duplicateTranslateBy(ids: string[], from_x: number, from_y: number, to_x: number, to_y: number): string[];
    /**
     * Clone an element one step up the draw order, with a caller-supplied id.
     *
     * The new id is supplied by the caller on purpose: a paste wants a UUID, an
     * alt-drag wants any unique string, and inventing one here would force an RNG
     * dependency for a value the client already has a way to make.
     *
     * # Errors
     *
     * `unknown_element` for an absent `source`, and `duplicate_id` if `new_id`
     * is already in the session.
     */
    duplicate(source: string, new_id: string): void;
    /**
     * Abandon the drag: the document goes back to what it was.
     *
     * This is the cancelled gesture — the pointer left the window, the browser
     * took the pointer away. The scene the live moves left behind is replaced
     * by the one the drag found, and nothing is left on the history, because a
     * gesture that was thrown away is something that never happened.
     */
    editDragCancel(): void;
    /**
     * End the drag: the whole gesture is one undo step.
     *
     * The name says "drag" and not "vertex" because the gesture it ends may be
     * any of the three the edit mode has: a vertex that moves, a vertex that
     * is added, or a segment that is pinned.
     */
    editDragEnd(): void;
    /**
     * The group whose members are being edited from the inside, or `null`.
     *
     * The client asks this to keep Alt-click's cycle inside the group
     * (`WF-SELECT-08`), and to know whether Escape means "leave the group" or "drop the
     * selection".
     */
    editingGroupId(): string | undefined;
    /**
     * The id of the element whose vertices are being edited, if any.
     *
     * The client asks this to know whether the double click it is about to
     * dispatch is the second click of a double click, and to know which
     * element it is about.
     */
    editingId(): string | undefined;
    /**
     * Every embeddable's overlay, in the pixels of this frame.
     *
     * The boxes come transformed by the session's own viewport — the same
     * projection the frame's marks went through — and each row carries the
     * address and the policy's answer, so the DOM layer the client keeps over
     * the canvas is a rendering of one document and not an arithmetic of its
     * own. `[]` when the drawing holds no embeddable, which is the common
     * frame and the cheap one.
     */
    embeddablesView(): string;
    /**
     * Enable content-sized layout for a fixed text element. The kernel reads
     * `originalText` when present and records the transition in Session history.
     *
     * # Errors
     *
     * `unknown_element` for an absent id and `not_a_text` for a non-text id.
     */
    enableTextAutoResize(id: string): void;
    /**
     * Stop editing the vertices of whatever was being edited.
     *
     * The no-op case is a no-op, not an error: the client calls this when the
     * pointer goes somewhere else, and it may call it twice in a row.
     */
    endEditing(): void;
    /**
     * Enter the group a double click hits (`WF-SELECT-08`).
     *
     * The group must be one the selection stands for — the click that precedes the double
     * click selects it — and the hit element must be inside it. The member alone (or the
     * group just inside the entered one) is selected afterwards, and the group is the one
     * being edited. Answers `false` when there is nothing to enter, so the client falls
     * through to the double click's other meanings (the vertex editor, text editing).
     *
     * No undo step: entering a group is a mode, not an edit.
     */
    enterGroup(id: string): boolean;
    /**
     * Start an erasing gesture at a screen point.
     *
     * The gesture is transient: it is not part of the document, it is not undoable on its
     * own, and it leaves nothing behind but the ids it marked. It lives here rather than
     * in the core session because the core session holds the *document*, and this holds a
     * pointer's way of crossing it — the same division upstream draws, where the trail
     * belongs to the app and not to the scene.
     *
     * `now_ms` is the caller's clock. Upstream reads `performance.now()` inside the
     * trail's width decay; a kernel that reads the clock cannot be tested, so the time
     * comes in from the boundary.
     */
    eraserBegin(screen_x: number, screen_y: number, now_ms: number): void;
    /**
     * Abandon the erasing gesture without deleting anything.
     *
     * A cancelled pointer is not a release, and the freehand stroke already says so
     * (`App.tsx:9722-9752`): a stroke the browser takes away leaves nothing behind. The
     * eraser has the same rule, and it needs its own way to say it — ending the gesture
     * would delete everything it had marked, which is the opposite of abandoning it.
     */
    eraserCancel(): void;
    /**
     * End the erasing gesture, deleting everything it marked in one transition.
     *
     * A stroke the pointer never moved is a **click**, and a click still erases:
     * upstream's pointerup notices the zero dragged distance and marks what the
     * click's own hit test answers before it erases (`App.tsx:10127-10152`), so
     * the receipt `erase-click-zero-distance` ends with one element gone and its
     * neighbour intact. The rule lives in the kernel's eraser
     * (`Eraser::mark_click`), which reads the same trail the sweep reads; this
     * boundary only hands it the scene and the zoom.
     *
     * Returns the ids that were deleted. One stroke is one undo step: a single `Cmd+Z`
     * brings back every element the stroke erased, not one per element.
     */
    eraserEnd(): string[];
    /**
     * Extend the erasing gesture to a screen point and report what it has marked.
     *
     * Returns JSON: `{"pending": ["id", …]}`.
     *
     * The **pending** ids are the elements the gesture has marked for deletion. They are
     * *not* deleted yet: upstream erases on the pointer's release, and so does this, so
     * that one stroke is one undo step and the elements it will erase can still be drawn
     * faded while the pointer is down.
     *
     * The **trail** is not in this answer. It is the ink under the pointer, it decays
     * with the clock, and it therefore has to be asked for at the instant it is drawn —
     * which is what `eraserTrail` is for. Answering it here as well would give the
     * client two copies of the same ink, one of them already stale by the time it is
     * painted, and the rule that decides which one wins would be the client's.
     *
     * `restore` is upstream's `alt`: the pointer *un*-erases rather than erases.
     */
    eraserMove(screen_x: number, screen_y: number, now_ms: number, restore: boolean): string;
    /**
     * The trail of the erasing gesture at a given instant, in screen coordinates.
     *
     * This is the cheap half of the eraser: it draws ink and touches no element, so an
     * animation frame may call it as often as it likes. It is a separate method from
     * `eraserMove` because the two are asked for on different clocks — the move for the
     * pointer's travel, this one for the browser's frames — and merging them would make
     * the frame pay for the eraser test it does not need.
     *
     * The trail's width **decays**: upstream's eraser's ink fades behind the pointer
     * (`sizeMapping`, `packages/excalidraw/eraser/index.ts`), and it is the clock that
     * measures the fade. That is why this method takes the time rather than reading it:
     * a kernel that reads the clock cannot be tested, and this one is tested against
     * upstream's own numbers.
     *
     * Returns JSON: `{"trail": [[x, y], …]}`.
     */
    eraserTrail(now_ms: number): string;
    exportSvg(pen_json: string, ids_json?: string | null, background?: string | null, options_json?: string | null): string;
    /**
     * Read the current fill style of an element, as the wire token the
     * SVG export already understands (`"solid" | "hachure" | "cross-hatch" |
     * `"zigzag"`). Used by the toolbar to know which of the four fill
     * buttons to render as active. The token is what `setStyle` accepts for
     * the `fill` property, so the round-trip is exact.
     *
     * `unknown_element` for an absent id, so the JS side can branch the
     * same way it does for every other absent-id error in the surface.
     */
    fillStyleOf(id: string): string;
    finishArrowLabel(body: string): void;
    /**
     * Frame the whole drawing in the canvas, with `padding` scene units of margin.
     * A view fact: nothing in the document changes. An empty drawing is left as it was.
     */
    fitContent(padding: number): void;
    /**
     * Frame the selection in the canvas. An empty selection leaves the view as it was.
     */
    fitSelection(padding: number): void;
    /**
     * Begin pinning one of a turning arrow's segments.
     *
     * The segment is the one the handle belongs to: the segment between the
     * points `i` and `i + 1` is the segment `i`.
     *
     * The drag is the gesture, and the gesture is one thing the user did: a
     * capture is opened, so every move that follows is part of one undo step
     * and the document is written once, when the gesture ends.
     *
     * # Errors
     *
     * `unknown_element` for an id the session does not hold.
     */
    fixedSegmentDragBegin(id: string, segment: number): void;
    /**
     * Move the segment being pinned.
     *
     * The scene moves live: the elbow follows the pointer while it is being
     * dragged, the way upstream's does. The history does not move with it —
     * that is what the capture is for.
     *
     * # Errors
     *
     * `no_such_segment` for a segment the element does not have, and
     * `unknown_element` when no drag is in progress.
     */
    fixedSegmentDragMove(scene_x: number, scene_y: number): void;
    /**
     * Mirror the selected elements about the centre of their common box.
     *
     * `by_x` mirrors left/right and `by_y` mirrors up/down. Upstream has one
     * action per axis — `actionFlipHorizontal` (`Shift+H`) and
     * `actionFlipVertical` (`Shift+V`), both in
     * `packages/excalidraw/actions/actionFlip.ts` — and this method is the
     * union of the two, because the geometry is the same mirror with a
     * different axis and a client that had to call two methods for one
     * gesture would have to know which one to call.
     *
     * The anchor is the centre of the selection's common bounding box
     * (`actionFlip.ts:131`), the geometry is in the kernel's `flip` module,
     * and the transition is atomic: one call, one history entry, one undo.
     *
     * An empty selection, or a call with neither axis, is a free no-op.
     */
    flip(by_x: boolean, by_y: boolean): void;
    /**
     * The length of the bytes [`Session::build_frame`] last produced.
     *
     * Zero before the first `buildFrame`, which is not an empty frame: it is the
     * absence of one, and the client asks for the pointer first precisely so
     * that this cannot be confused with a scene that legitimately has no ops.
     */
    frameLen(): number;
    /**
     * The marks of a run of the committed scene, as a frame packet.
     *
     * The run is `start..end` in stacking order; an `end` past the scene is
     * the scene's end, and a `start` past `end` is an empty run. The packet's
     * only present section is the static one, with the paper and the grid of
     * the whole view, so the run that starts at zero is a layer that can be
     * painted first.
     *
     * This is what a gesture's preview paints under and over the band it
     * changes: the marks are read from the compiled scene the last frame
     * built, and reading them teaches the cache nothing, so a drag that asks
     * for the two runs on every frame does not evict the marks the release
     * will paint.
     */
    frameRange(start: number, end: number): Uint8Array;
    /**
     * One whole frame: the items in scene order, and the selection chrome.
     *
     * This is the only paint call the boundary makes. It used to be three —
     * `renderList()`, `textViews()` and `selectionOutlines()` — and two of the
     * three walked the whole scene to produce their half, so a frame paid the
     * scene twice to cross twice. `examples/frame_cost.rs` is where that shape
     * was measured; this is the code that answered it.
     *
     * The response is one object with two arrays:
     *
     * ```json
     * {"items":[…],"chrome":[…]}
     * ```
     *
     * `items` is one ordered list, and each entry is either
     * `{"Mark":{…}}` or `{"Text":{…}}`. It used to be two lists — `ops` and
     * `textViews` — and the relative order of a mark and a label was then
     * decided by which array each of them happened to land in. Two lists cannot
     * say which of the two is on top, and the scene is the thing that knows.
     *
     * **The order is the scene's order.** It is the order the elements are
     * stored in, which is the order upstream's own Z index defines, and it is
     * the order upstream's own renderers paint in: `staticScene.ts` walks the
     * visible elements and renders one at a time, and `staticSvgScene.ts` walks
     * the elements and renders one at a time. Neither groups the text on top of
     * the strokes. A frame that arrives in two lists arrives in an order
     * upstream does not have.
     *
     * The per-record knowledge is untouched — a mark is still a mark and a text
     * is still a text, with the same fields — so the client only had to learn
     * where to read them. `chrome` is what `selectionOutlines()` shipped, read
     * from the session's own selection: the client never had an id to pass and
     * does not now.
     *
     * **The two halves are not independent, and that is the point.** The items
     * are culled by one rule, over one walk, against one viewport, so there is
     * no longer a frame in which a text element is visible to one half and
     * culled by the other.
     *
     * The viewport defaults to `(0, 0)` until [`set_viewport_size`] is called,
     * which yields empty `items` and `chrome` — an unlaid canvas has no window
     * to cull against.
     */
    frame(): string;
    /**
     * A session loaded from a `.excalidraw` document.
     *
     * # Errors
     *
     * Whatever [`nextdraw_codec::parse`] returns, tagged by [`codec_err_text`].
     */
    static fromJson(json: string): Session;
    /**
     * The grid's paintable lines, in **screen pixels**, across the visible
     * canvas, as `[[x1, y1, x2, y2], …]` — one full-height vertical per
     * column and one full-width horizontal per row. The client strokes
     * these as-is; it decides the colour, never the geometry. An empty
     * answer is an honest "no grid": the setting off, a canvas with no
     * area, or a pitch the screen cannot separate (fewer than
     * `GRID_MIN_PITCH_SCREEN_PX` screen pixels between neighbouring
     * lines).
     */
    gridLines(): string;
    /**
     * The grid step in scene units, or `undefined` when the grid is off.
     *
     * A view fact: the client paints the lines from it, and nothing in the
     * document answers to it. A step the caller cannot mean (`0`, negative,
     * NaN) is stored as given and answered as no grid by the kernel — the
     * round-trip is the caller's own number.
     */
    gridStep(): number | undefined;
    /**
     * The first group `id` belongs to, or `null` if it is ungrouped.
     *
     * Reads, does not dispatch. The keyboard handler in the client uses this
     * to find the unique group_id per selected element, then calls
     * [`ungroup`](Self::ungroup) for each — which is the right shape for
     * "ungroup every group the selection touches".
     */
    groupIdOf(id: string): string | undefined;
    /**
     * Every group `id` belongs to, innermost first; empty when it belongs to none.
     *
     * The client uses this to keep Alt-click's cycle inside the group being edited: the
     * hits outside that group are not units of the cycle while the user is inside it.
     */
    groupIdsOf(id: string): string[];
    /**
     * Every id that shares a group with `id`, including `id` itself. Returns
     * `[id]` when `id` is ungrouped and `[]` when `id` is not in the scene.
     *
     * The click and drag handlers in the client call this so that a click on
     * a group member selects the whole group, and a drag of a group member
     * moves the whole group.
     */
    groupMembersOf(id: string): string[];
    /**
     * Bind a set of elements into a group.
     *
     * `group_id` is the caller's string (a UUID is the usual choice); the
     * kernel does not allocate one. Every element in `ids` has its `group_ids`
     * replaced with `[group_id]` — an element that was already in another group
     * leaves it. The single group id is a deliberate narrowing of the wire
     * format, which carries an array; a future H6 milestone that wires up
     * nested groups would change the underlying storage and the narrowing
     * would lift.
     *
     * # Errors
     *
     * `empty_group` if `ids` is empty, `unknown_element` for any id the
     * session does not hold.
     */
    group(ids: string[], group_id: string): void;
    /**
     * Whether the sole selection is a live arrow suitable for the binding command.
     */
    hasSelectedArrow(): boolean;
    /**
     * How many past scenes the session is currently remembering.
     *
     * Bounded by the kernel's `HISTORY_DEPTH`, so the answer is always in
     * `0..=HISTORY_DEPTH`. Surfaces for a status bar that wants to tell the user
     * "you have N more undos left", not for the editor's internal use: the editor
     * reads [`can_undo`](Self::can_undo).
     */
    historyDepth(): number;
    /**
     * Which chrome piece, if any, the screen point lands on for the given selected id.
     *
     * Returns one of four `kind` values:
     * - `"handle"` with a `name` in `{"nw","n","ne","w","e","sw","s","se"}` —
     *   the point is inside one of the four corner squares, sized for
     *   `pointer` (`"pen"` sixteen pixels, `"touch"` twenty-eight, anything
     *   else, or nothing, the mouse's eight), or within the side-resizing
     *   band of one of the four borders. **An element without handles has
     *   neither** — an image, which the kernel refuses to resize, and a line
     *   or an arrow that upstream gives no box — so this `kind` cannot come
     *   back for one; the corners come from the same
     *   `ChromeHandles::for_element` that paints them, which is what makes
     *   "not painted" and "not grabbable" the same statement.
     * - `"rotate"` — the point is inside the rotate handle's circle. The
     *   client starts a rotate gesture; no `name` is set. A frame, an elbow
     *   arrow and a line or an arrow of two points have none.
     * - `"body"` — the point is on the element's geometry but not on chrome.
     *   The client starts a translate gesture.
     * - `"empty"` — the id is unknown or absent; the client does nothing.
     *
     * The chrome is checked **in screen pixels**, against the very record the
     * painter walks. That is the point of the change: the side that paints and
     * the side that grabs ask one question of one value, so the square the
     * user sees and the square the user hits are the same square. It used to
     * be checked in scene units against a half-extent of four *scene* units,
     * while the painter drew eight *screen* pixels — so at any zoom but one
     * the region that grabbed a handle was bigger than the handle.
     *
     * The `box` and `centre` that come back are in screen pixels too, for the
     * same reason: the client draws and drags in screen pixels, and a client
     * that had to ask the kernel to convert them was holding a second copy of
     * the viewport transform.
     *
     * # Errors
     *
     * `unknown_element` if `id` is not in the scene.
     */
    hitChromeAtScreen(screen_x: number, screen_y: number, id: string, pointer?: string | null): string;
    /**
     * The element's bounding box as `[x1, y1, x2, y2]`, already transformed by nothing.
     *
     * Scene coordinates, not screen: the viewport transform belongs to H3 and applies to
     * `DrawOp`, not to a box the client asked about directly.
     *
     * # Errors
     *
     * `unknown_element` for an id the session does not hold.
     * Whether the point lands in the band where a frame's title draws.
     *
     * The band is the kernel's rule; the numbers are the render op's, and
     * the measured width is the client's metric. A double click that lands
     * in the band opens the title's editor, the way upstream's clickable
     * div does — and a rule that lived on both sides of the boundary would
     * let the editor open where nothing was drawn.
     */
    hitFrameTitle(x: number, y: number, width: number, title_offset_y: number, title_font_size: number, at_x: number, at_y: number, measured_title_width: number): boolean;
    /**
     * What a pointer over the current selection's chrome names, when the
     * selection holds several elements.
     *
     * The answer is one JSON object: `{"kind":"handle","name":"e","box":[…]}`,
     * `{"kind":"body","box":[…]}`, `{"kind":"none"}` or
     * `{"kind":"rotate","centre":[x,y],"box":[…]}`, the box being the
     * selection's common bounds in CSS pixels — the box the resize gesture
     * starts from. The corners are the four handles the desktop draws, each
     * grabbed with the square `pointer` names — `"pen"` sixteen pixels,
     * `"touch"` twenty-eight, anything else, or nothing, the mouse's eight;
     * the borders answer within the side-resizing threshold even though
     * nothing there is painted, which is upstream's own split
     * (`packages/element/src/resizeTest.ts`); the body is the
     * interior, and dragging it moves the selection whole. The turn answer
     * names the pivot the gesture needs — the common box's centre — so the
     * client never rebuilds it. A selection of one element answers `none` —
     * its chrome is the element record's, and `hitChromeAtScreen` already
     * speaks for it.
     */
    hitSelectionChromeAtScreen(x: number, y: number, pointer?: string | null): string;
    /**
     * The same as [`hit_test`](Self::hit_test), but taking the point in CSS pixels
     * relative to the canvas top-left rather than in scene units.
     *
     * The point the browser hands the client is a screen position; the kernel
     * needs the same point in scene units. Inverting the viewport transform
     * (pan and zoom) is the kernel's job, not the client's: the math is small
     * but it is *the* place where a wrong sign shows up as "the click landed
     * on the wrong element", and a future zoom-at-cursor anchor will change
     * the formula. Keeping the conversion here means the client only ever
     * speaks in screen pixels.
     */
    hitTestAtScreen(screen_x: number, screen_y: number, tolerance: number): string[];
    /**
     * The ids of every element whose shape contains the point, topmost first.
     */
    hitTest(x: number, y: number, tolerance: number): string[];
    /**
     * Where a picture of `width`×`height` pixels belongs on the current viewport:
     * the same document [`imagePlacement`](Self::image_placement) answers, for a
     * size the caller already knows.
     *
     * This is the other half of that method, and it exists because the two
     * halves are not the same knowledge. A header is bytes: this build reads
     * four formats' worth and reports honestly that it cannot read the rest.
     * A decoded picture is pixels: a browser knows the size of an SVG, a BMP or
     * an AVIF, and it knows it by having decoded it. Upstream asks the browser
     * for the size and keeps the arithmetic; this method is where that answer
     * comes back in.
     *
     * The arithmetic does not come with it. The box is computed by the same
     * kernel call, with the same centring, the same cap and the same refusal
     * of a picture with no area — so a size measured in a browser and a size
     * read from a header land the same picture in the same place. Two ways of
     * knowing a size, one way of placing a picture.
     *
     * `undefined` when the size is one the kernel refuses to place, which today
     * means a height of zero: the width follows the height, so a picture with
     * no height has no ratio to preserve and no box to draw into.
     */
    imagePlacementFor(width: number, height: number): string | undefined;
    /**
     * Where an image data URL belongs on the current viewport:
     * `{"x":…,"y":…,"width":…,"height":…}`, or `undefined` when the URL is not one
     * whose header this build reads.
     *
     * One call per import, and it answers both halves of the question on purpose.
     * A caller that took the size from here and computed the position itself would
     * own a second copy of the viewport transform — the same arithmetic
     * [`frame`](Self::frame) already applies — and the two copies would
     * disagree about where the canvas centre is at the pixel where the picture's
     * edge lands.
     *
     * Unlike [`groupIdOf`](Self::group_id_of) this is not stateless: the answer moves
     * when the user pans and zooms, which is what "lands where you are looking"
     * means, and which is why it reads the session rather than being a free
     * function. The client sets the viewport through
     * [`setViewportSize`](Self::set_viewport_size) and never computes this itself.
     */
    imagePlacement(data_url: string): string | undefined;
    /**
     * The `dataURL` of the image element `id`, or `undefined` when `id` is not an
     * image, is not in the scene, or carries no bytes.
     *
     * The other half of [`imagePlacement`](Self::image_placement): that one answers
     * *where* a picture goes when the user imports it, this one answers *what it
     * is* when the renderer reaches it. Between them the payload crosses exactly
     * once — on import — instead of on every frame, which is what H8.2 measured
     * as the single largest cost the boundary had.
     *
     * `undefined` is deliberately not `""`. An empty string is a valid thing to
     * paint nothing with, and a client that cannot tell the two apart will cache
     * the empty one under the element's id and keep painting a blank rectangle
     * after the bytes arrive.
     *
     * The caller is expected to ask once per element and cache the answer. Asking
     * again is correct and only slow, which is what makes this safe to ship
     * before the client caches.
     */
    imageText(id: string): string | undefined;
    /**
     * The scene as an SVG document, ready to hand to a download.
     *
     * The pen — the stroke width, the hatch spacing, the three dash patterns — is a JSON
     * argument rather than something the kernel decides, because it is the same set of
     * numbers the client paints with and it is not the kernel's to know. A core that
     * chose its own would be the second truth about one number, in the one place nobody
     * looks.
     *
     * The pen carries **no colour** since H6.14: a colour belongs to the element, the op
     * carries it and the exporter writes it. A palette here would be the second truth
     * about the same colour, and the first one was the wrong one.
     *
     * The export may name its elements: a JSON array of ids when the file is
     * to hold a selection — the scene's own draw order, the file sized by
     * their ink — or `null` when it is to hold the whole scene. `background`
     * paints one rectangle of paper under the drawing when given a colour,
     * and leaves the file carrying no paint of its own when `null`.
     *
     * # Errors
     *
     * `bad_pen: …` if the pen is not the JSON object [`Pen`] deserialises. The tag is
     * `bad_pen` rather than a serde variant because a client that sent `{}` wants to know it
     * left out every field, and `missing field \`lineWidth\`` already says that — but it does
     * not say the caller should not guess defaults. `bad_export_ids: …` when the ids do not
     * parse as an array, and the session's own errors when an id names nothing.
     * Lay one library piece down on the drawing, centred on the scene point.
     *
     * The piece arrives as the JSON array of elements the library file
     * carried, and the machinery is the paste's own: fresh identities, the
     * piece's own references remapped to them, the whole piece one entry in
     * the history. The answer is the new ids, in scene order, so the client
     * can select what it laid down.
     *
     * # Errors
     *
     * The paste's own errors, `bad_library_item: …` when the array does
     * not read as elements, and the codec's refusal — tagged — when the piece
     * is too big to be laid down. A piece that carries a stroke with a million
     * points costs the same to lay down as one that arrived in a document, and
     * the document's door refuses it.
     */
    insertLibraryItem(elements_json: string, scene_x: number, scene_y: number): string;
    /**
     * Add a vertex to one of a linear element's segments.
     *
     * The index is the **segment**: the midpoint between the points `i` and
     * `i + 1` is the segment `i`, and that is the number the chrome
     * publishes for a midpoint. The new vertex takes the index `i + 1`.
     *
     * The coordinates are in **scene** units, like [`Session::move_vertex`].
     *
     * # Errors
     *
     * `unknown_element` for an id the session does not hold, and
     * `no_such_segment` for a segment the element does not have.
     */
    insertVertex(id: string, segment: number, scene_x: number, scene_y: number): void;
    /**
     * Insert one element.
     *
     * The stamped fields — seed, styles, version, index — come from the caller rather than
     * being defaulted here, because the `.excalidraw` format already carries them and a
     * default would silently discard a document's own values on reload.
     *
     * `ends` names the two ends of an arrow that is born tied: the scene
     * positions the pointer drew them at, as `{"start": [x, y], "end": [x, y]}`.
     * The kernel ties each end to whatever shape is under it, and the
     * creation and the tying are one undo step — the arrow and the pointing
     * are one thing the user did, and undoing it has to take both away.
     *
     * The capture that holds them together is opened and closed by the kernel,
     * so a refusal in the middle of it cannot leave it open. An open capture
     * is worse than a failed one: it moves the scene live without touching
     * the history, and the undo stops working with nothing to say so.
     *
     * # Errors
     *
     * [`scene_err_text`] of whatever [`apply`] returned: `duplicate_id` for an id already in
     * the scene. `the ends do not parse` for ends that are not two points.
     */
    insert(json: string, ends?: string | null): void;
    /**
     * The same as [`intersecting`], but taking the rectangle in CSS pixels
     * relative to the canvas top-left. The kernel applies the viewport
     * transform (pan and zoom) the same way [`hit_test_at_screen`] does,
     * so the client only ever speaks in screen pixels for the marquee —
     * the one gesture the user is actually drawing with the mouse.
     *
     * # Errors
     *
     * `bad_geometry` if `rect` does not hold four numbers.
     */
    intersectingAtScreen(rect: Float64Array): string[];
    /**
     * Every id whose AABB intersects the scene-units rectangle `[x1, y1, x2, y2]`.
     *
     * The input is normalised — a drag the user drew right-to-left is the
     * same answer as a left-to-right one — and a zero-area rect returns
     * `[]`, which is the only honest answer for a degenerate input. The
     * client uses [`intersecting_at_screen`](Self::intersecting_at_screen)
     * directly; this scene-units form is exposed for tests and for a
     * future headless renderer that does its own viewport math.
     *
     * # Errors
     *
     * `bad_geometry` if `rect` does not hold four numbers.
     */
    intersecting(rect: Float64Array): string[];
    /**
     * Whether the element is a turning arrow — the flag a document spells
     * `elbowed` and the double click reads to decide whose gesture it is:
     * upstream routes a turning arrow's double click to its label editor
     * and a plain one's to the line editor (`App.tsx:6224-6229`), so the
     * client needs the word and the client must not re-read it out of a
     * second copy of the document. `false` for every element that is not
     * an arrow: a shape, a line, and a plain arrow all answer `false`.
     */
    isElbowed(id: string): boolean;
    /**
     * Whether the session holds no elements.
     *
     * `js_name` is explicit on every method here, including this one, because `wasm-bindgen`
     * does not camel-case for you: without it the surface would be `hitTest`, `boundsOf`,
     * `fromJson`, `toJson` and then `is_empty`, which is the kind of inconsistency a client
     * discovers by writing `session.isEmpty()` and getting a TypeError.
     */
    isEmpty(): boolean;
    /**
     * Whether the element `id` is locked.
     *
     * An id the scene does not know is not locked. That is the same answer
     * the kernel gives everywhere else about an absent id: "not in the
     * state you are asking about" rather than an error, because the caller
     * here is asking a question about an element, not commanding one.
     */
    isLocked(id: string): boolean;
    /**
     * Whether a closed path has come back to where it started.
     *
     * The line tool's question, asked on every press: a path whose ends
     * meet within the threshold read through the zoom closes into a
     * polygon. The rule is the kernel's; the client asks, and the answer
     * it draws with is the answer the commit will act on.
     */
    isPathALoop(points: string, zoom: number): boolean;
    /**
     * Whether `id` is currently selected.
     */
    isSelected(id: string): boolean;
    /**
     * Whether `id` names a fixed-size text element (`autoResize === false`).
     *
     * Invalid, absent, and non-text ids answer `false`; callers use this as a
     * menu predicate, not as validation of an explicit mutation.
     */
    isTextFixed(id: string): boolean;
    /**
     * Read an element's variant name, as the `.excalidraw` format spells it.
     *
     * This is the question "is this element a text?", asked without building
     * anything to answer it. `selectionOutlines` used to be where the client
     * asked it — every chrome record carried a `kind`, and double-click read
     * it — but H5.13 unified that field to `"polygon"` because a chrome
     * record draws as a polygon whatever it wraps. The question survived,
     * the field did not, so the gesture went dead rather than wrong.
     *
     * Seven tokens, one per variant, and `kindOf` is their only reader:
     * `rectangle`, `diamond`, `ellipse`, `line`, `arrow`, `image`, `text`.
     * A missing id is `unknown_element`, the same as every other accessor,
     * so the client branches on absence the way it does everywhere else.
     */
    kindOf(id: string): string;
    /**
     * Leave the group being edited, keeping its members selected.
     *
     * Upstream's Escape inside a group (`actionDeselect`): the group just left becomes the
     * selection, the parent group becomes the edited one when the group was nested, and
     * the dashed box stays as a selected group's. A no-op when no group is being edited.
     */
    leaveGroup(): void;
    /**
     * Read the current stroke width of an element, as the width selector's
     * token `"thin" | "medium" | "bold"`, or nothing when the element
     * carries a width the selector has no button for.
     *
     * The element carries a **number**, and the token is derived from it
     * the way upstream derives it
     * (`packages/excalidraw/actions/actionProperties.tsx:696-705`): the
     * name is the one whose number *for this element* is the number the
     * element carries. A document written with a width of `3` therefore
     * has no name, and the honest answer is "no button is lit" rather than
     * lighting the closest one.
     *
     * `undefined` on the JS side, not `null`: `wasm-bindgen` marshals a
     * `None` `Option<String>` as an absent value, and a client comparing it
     * with `===` against a button's token gets `false` either way.
     *
     * `unknown_element` for an absent id, so the JS side can branch
     * the same way it does for every other absent-id error in the
     * surface.
     */
    lineWidthOf(id: string): string | undefined;
    /**
     * The address one element carries, or nothing when it carries none. The
     * home is the kind's own: the variant for `Embeddable`, the bag for
     * everyone else — the same two homes the write has, read back.
     */
    linkOf(id: string): string | undefined;
    /**
     * Load a document and say what the reader had to do to open it.
     *
     * The same load [`Self::load_json`] does, with the account kept: an element that was
     * repaired, an element that was carried whole because this build cannot read one of
     * its fields, an element that was left out because it had no usable identity. The
     * report is JSON text, because the browser is the one that tells the user and the
     * sentence it shows is the browser's business.
     *
     * The report is empty when the document opened exactly as it was written, which is
     * the case for every document this build wrote itself.
     *
     * # Errors
     *
     * Whatever [`nextdraw_codec::parse_with_report`] returns, tagged by
     * [`codec_err_text`]. The session is left as it was: a document that does not open
     * does not replace the one that does.
     */
    loadJsonWithReport(json: string): string;
    /**
     * Load a document into the session this is, replacing what it held.
     *
     * A session that can only be created from a document is a session that cannot open
     * a second one, and opening a file is the whole point of the button that calls this.
     * The history goes with the document: undoing past the point where the drawing
     * changed would walk the user into a scene they have never seen.
     *
     * The load does not say what it had to do to open the document; [`Self::load_json_with_report`]
     * is the same load with the account kept, and it is the one the "open" button calls.
     *
     * # Errors
     *
     * Whatever [`nextdraw_codec::parse`] returns, tagged by [`codec_err_text`]. The
     * session is left as it was: a document that does not open does not replace the one
     * that does.
     */
    loadJson(json: string): void;
    /**
     * Whether midpoint binding targets are visible.
     */
    midpointSnapping(): boolean;
    /**
     * Move one vertex of a linear element.
     *
     * The coordinates are in **scene** units, the same units
     * [`Session::screen_to_scene`] answers in. The client converts once, at
     * the pointer, and the kernel works in the document's own units from then
     * on.
     *
     * The index is the vertex's own index in the element's point list — the
     * number the chrome record publishes, so the client moves the vertex it is
     * holding and no other.
     *
     * This is one undo step on its own. A drag that calls it on every
     * pointermove would be one undo step per pointermove, so a drag holds a
     * capture instead: see [`Session::vertex_drag_begin`].
     *
     * # Errors
     *
     * `unknown_element` for an id the session does not hold, and
     * `unknown_vertex` for an element that has no such vertex.
     */
    moveVertex(id: string, index: number, scene_x: number, scene_y: number): void;
    /**
     * Walk the flowchart the way the arrow key names (`Alt+Arrow`, upstream
     * excalidraw PR #12502). `direction` is `"left"`, `"right"`, `"up"` or
     * `"down"`; the selection the key leaves behind is the destination plus
     * the arrows that tie it back to where the key came from.
     *
     * The key is quiet — the selection does not change — when the selection
     * names no single node or nothing lies that way within the diagram. The
     * selection is not on the undo stack, like every selection setter.
     *
     * # Errors
     *
     * `bad_flow_direction` for an unrecognised string, so the JS side can
     * branch on a stable prefix rather than matching a message.
     */
    navigateFlowchart(direction: string): void;
    /**
     * A session over an empty scene.
     */
    constructor();
    /**
     * Rotate every selected element by `delta_radians` in one atomic
     * transition. Mirrors `Session::nudge_rotate`. Empty selection and a
     * zero delta push no history entry.
     *
     * # Errors
     *
     * `unknown_element` when the selection names nothing the scene holds:
     * there was no element to turn.
     */
    nudgeRotate(delta_radians: number): void;
    /**
     * Translate every selected element by `(dx, dy)` in one atomic
     * transition. Mirrors `Session::nudge`, the keyboard-arrow gesture:
     * `↑↓←→` and `Shift+↑↓←→` for a coarser step. Empty selection, empty
     * delta, and a delta that leaves the scene byte-identical all push
     * no history entry.
     */
    nudge(dx: number, dy: number): void;
    /**
     * Pan by a screen-pixel delta, translated to scene units by the current
     * zoom. Negative `dx` moves the viewport left; positive `dx` moves it
     * right. A trackpad swipe and the middle-mouse drag go through the same
     * call, with the sign convention the client already uses for pointer
     * events.
     */
    pan(dx: number, dy: number): void;
    /**
     * Paste what the system clipboard holds, centred on the given point of
     * the scene, returning the new ids in scene order.
     *
     * The text is read as a payload: a drawing when it says so and carries a
     * list of elements, and a body of text otherwise. A body of text is laid
     * out under the point as one label per line, and a drawing is centred on
     * it.
     *
     * # Errors
     *
     * `empty_clipboard` if the text holds nothing to put down, and the
     * codec's own refusal — tagged — when the drawing the clipboard carries
     * is too big to be one. A drawing that is too much of a thing this build
     * understands is not text, and a refusal that arrives as an empty paste is
     * a door that closed without saying why.
     */
    pasteClipboard(text: string, x: number, y: number): string[];
    /**
     * Drop the clipboard into the scene, centred on the given point of
     * the scene, returning the new ids in scene order. Mirrors
     * [`Session::paste`].
     *
     * The point is where the block lands, not how far it moves: the block is
     * measured, and its centre is put on the point. The caller therefore does
     * not need to know how big what it is pasting is.
     *
     * # Errors
     *
     * `empty_clipboard` if there is nothing to put down.
     */
    paste(x: number, y: number): string[];
    /**
     * What a shape being drawn would look like, asked before it exists.
     *
     * The draft door (TASK-132): the live preview of a draw gesture is the
     * commit's own element — the same json the release will hand back, read
     * here and answered as a frame packet the client's reader already decodes.
     * The bytes are a [`FramePacket`] whose only present section is the static
     * one, so a draft crosses in the vocabulary the frame crosses in and no
     * second encoding of "what a mark looks like" can grow.
     *
     * The door is a question, not a change: `&self`, and the scene, the
     * revisions and the history it was asked of are the ones that answer.
     * Upstream previews from the element it inserted on pointer-down; this
     * kernel keeps the document free of what the hand has not committed to
     * and answers the geometry instead — a draft a browser took away
     * (`pointercancel`) leaves nothing to discard because there is nothing to
     * discard.
     *
     * # Errors
     *
     * The refusals [`insert`](crate::Session::insert) answers, with the same
     * words: the json is read by the parser the insert reads, so the draft and
     * the commit can never disagree about what an element is.
     */
    previewOps(json: string): Uint8Array;
    /**
     * What a resize would show if the pointer were released here.
     *
     * The arguments are [`resize_by`](Self::resize_by)'s and the box is built
     * by the same function; the answer is the one
     * [`preview_translate_by`](Self::preview_translate_by) documents.
     *
     * # Errors
     *
     * The refusals the release would answer, with the same words.
     */
    previewResizeBy(ids: string[], handle: string, x1: number, y1: number, x2: number, y2: number, dx: number, dy: number, min_size: number): Uint8Array;
    /**
     * What turning the selection would show if the pointer were released here.
     *
     * The arguments are [`rotate_all`](Self::rotate_all)'s; the answer is the
     * one [`preview_translate_by`](Self::preview_translate_by) documents.
     *
     * # Errors
     *
     * The refusals the release would answer, with the same words.
     */
    previewRotateAll(to_x: number, to_y: number, discrete: boolean): Uint8Array;
    /**
     * What turning one element would show if the pointer were released here.
     *
     * The arguments are [`rotate_by`](Self::rotate_by)'s; the answer is the
     * one [`preview_translate_by`](Self::preview_translate_by) documents.
     *
     * # Errors
     *
     * The refusals the release would answer, with the same words.
     */
    previewRotateBy(id: string, to_x: number, to_y: number, discrete: boolean): Uint8Array;
    /**
     * What a move would show if the pointer were released here.
     *
     * The arguments are [`translate_by`](Self::translate_by)'s, and the move
     * is built by the same function the release goes through: a preview that
     * computed its own move would be a second answer to where the drag lands,
     * and the two would drift the first time one of them learnt a rule (the
     * snap, a bound arrow, a frame's children) the other did not.
     *
     * The answer is the band header and frame packet
     * `preview_packet` writes, described there. The door is a
     * question: the document, its revisions and its history stay where they
     * were.
     *
     * # Errors
     *
     * The refusals the release would answer, with the same words.
     */
    previewTranslateBy(ids: string[], from_x: number, from_y: number, to_x: number, to_y: number): Uint8Array;
    /**
     * Re-apply a previously undone action, returning `true` if the scene changed.
     *
     * The mirror of [`undo`]: a no-op (with `false` returned) when the redo stack is
     * empty, which is the case the moment the user takes a new action after an undo.
     *
     * [`undo`]: Session::undo
     */
    redo(): boolean;
    /**
     * Release one of a turning arrow's pinned segments.
     *
     * The index is the **segment**: the segment between the points `i` and
     * `i + 1` is the segment `i`, and that is the number the chrome publishes
     * for the handle of a segment.
     *
     * Upstream releases a segment when the user double-clicks its handle
     * (`packages/excalidraw/components/App.tsx:6292`).
     *
     * # Errors
     *
     * `unknown_element` for an id the session does not hold,
     * `not_a_turning_arrow` for an element that is not a turning arrow, and
     * `no_such_segment` for a segment the element does not have pinned.
     */
    releaseFixedSegment(id: string, segment: number): void;
    /**
     * Remove one vertex of a linear element.
     *
     * The index is the vertex's own index in the element's point list — the
     * number the chrome record publishes, so the vertex that goes is the one
     * the user pointed at.
     *
     * The remaining vertices keep their places and the element takes up the
     * slack, the same re-anchoring a move does: upstream's `deletePoints`
     * (`packages/element/src/linearElementEditor.ts:1576`) normalises the
     * surviving points so that the first one is at the local origin.
     *
     * The selection follows the deletion, the way upstream's does
     * (`packages/excalidraw/actions/actionDeleteSelected.tsx:262-269`): the
     * vertex that was picked is gone, and the one before it is the closest
     * thing to what the user was pointing at.
     *
     * # Errors
     *
     * `unknown_element` for an id the session does not hold, `unknown_vertex`
     * for a vertex the element does not have, and `too_few_vertices` for an
     * element that would be left with a single point — a polyline of one
     * point is a dot, not a line.
     */
    removeVertex(id: string, index: number): void;
    /**
     * Apply the same z-order op to every selected element in one
     * atomic transition. Same `op` vocabulary as [`Session::reorder`].
     * Empty selection is a free no-op at the boundary.
     *
     * # Errors
     *
     * `unknown_element` when the selection names nothing the scene holds:
     * there was no element to reorder.
     */
    reorderAll(op: string): void;
    /**
     * Move an element to one of the four canonical z-positions.
     *
     * `op` is one of `"front"`, `"back"`, `"forward"`, `"backward"`. Anything
     * else is reported as `bad_reorder_op` so the JS side can branch on a stable
     * prefix, the same way the other errors do.
     *
     * Atomic with the scene state the kernel reads: a collaborative client that
     * asks for `forward` gets the right answer even if the array moved between
     * the gesture and the dispatch, which is the reason the upstream routes its
     * toolbar through `changeZIndex` rather than `moveElementTo`.
     *
     * # Errors
     *
     * `bad_reorder_op` for an unknown op string, `unknown_element` for an absent
     * id. `forward` on the topmost and `backward` on the bottommost are no-ops,
     * not errors.
     */
    reorder(id: string, op: string): void;
    /**
     * Resize the named elements out of one gesture on their **common box**.
     *
     * The client measures the box on the screen, converts its corners to
     * scene units and names the handle or border the drag started from; the
     * kernel reads the scales off the two boxes, keeps the aspect where
     * upstream keeps it — a turned shape, a text or a grouped member — and
     * rescales every member through the same per-kind rules the single
     * resize uses. One apply, one history entry, atomic the way every
     * `*All` is.
     *
     * # Errors
     *
     * `unknown_element` for an id the session does not hold;
     * `unresizable` when the box or a member cannot be scaled.
     */
    resizeAll(ids: string[], handle: string, x: number, y: number, width: number, height: number): void;
    /**
     * The box a resize drag is at, in screen pixels.
     *
     * The box starts from the one the chrome drew and follows the handle the
     * drag took: each handle is anchored at the opposite side, and the edge
     * the pointer holds tracks the pointer's travel. The floor is the
     * caller's number — how small a box may be dragged is a choice about the
     * editing, not a rule of the geometry — and it is what stops a drag from
     * turning the box inside out.
     *
     * The answer is a JSON object with `left`, `top`, `right` and `bottom`,
     * in the same screen pixels the chrome is drawn in.
     *
     * # Errors
     *
     * `unknown_handle` for a handle the vocabulary does not have.
     */
    resizeBox(handle: string, x1: number, y1: number, x2: number, y2: number, dx: number, dy: number, min_size: number): string;
    /**
     * Resize the named elements by the pointer's travel.
     *
     * The box starts from the one the chrome drew and follows the handle the
     * drag took; the kernel measures it, converts it to the scene and applies
     * it as one transition.
     *
     * One element is resized alone and several are resized together, because
     * the two are different rules and not two spellings of one: a group is
     * resized through the scales the kernel reads off the two boxes, keeping
     * the aspect where upstream keeps it.
     *
     * A lone turned element ignores the box: the kernel resizes it in its own
     * frame, so the handle changes the side it names there and the opposite
     * corner stays put on the screen.
     *
     * A lone element whose drag crosses the opposite side is **flipped**: the
     * box the gesture measured is signed, and the kernel mirrors the element
     * over the anchor instead of stopping it at a minimum.
     *
     * # Errors
     *
     * `unknown_element` for an id the session does not hold, `unknown_handle`
     * for a handle the vocabulary does not have, and `unresizable` for a box
     * or a member that cannot be scaled.
     */
    resizeBy(ids: string[], handle: string, x1: number, y1: number, x2: number, y2: number, dx: number, dy: number, min_size: number): void;
    /**
     * Resize an element to a target box.
     *
     * Four scalars because the resize gesture moves the origin: a drag of the top-left
     * handle pulls the top-left to the cursor while the bottom-right stays put, and the
     * only way to say that is to give the kernel all four numbers. Closed shapes get
     * them written verbatim; a polyline rescales and translates its points to fit, so
     * the points stay inside the box the caller asked for. A text box also re-wraps
     * its body to the width it was given (H6.1), so the height that comes back is the
     * one the wrapped body needs rather than the one the caller sent — the caller
     * asked for a width, not a height, and the two have to agree.
     *
     * # Errors
     *
     * `unknown_element` for an id the session does not hold, and `unresizable` for two
     * different refusals (H6.3). The first is about the *element*: a polyline with no
     * points has nothing to scale. The second is about the *request*: a box whose width or
     * height is zero, negative or not finite is not a smaller box, it is not a box. The
     * second existed at the kernel only from H6.3 — until then the only guard was a clamp
     * in `client/index.js`, and the comment above that clamp claimed this function
     * already refused.
     */
    resize(id: string, x: number, y: number, width: number, height: number): void;
    /**
     * A counter of everything a frame reads: the scene, the viewport and the selection.
     *
     * It crosses as a string because JavaScript has no `u64`, and a number would lose
     * precision past 2^53 — silently, at which point two different revisions read as
     * one and a frame that changed stops being asked for. The comparison is all the
     * client does with it, and a string compares exactly.
     *
     * The decision of *what* wakes a client lives in Rust, beside the write that causes
     * it. A client that decided it would keep its own copy of the invalidation rule,
     * which is the duplicated source of truth of H5.29 with its matching failure: a
     * frame that has stopped being true and raises nothing.
     */
    revision(): string;
    /**
     * Turn the whole selection to the angle the pointer names about its centre.
     *
     * The centre is the one of the box that holds the selection, and every
     * member orbits it (upstream's `rotateMultipleElements`); the pointer and
     * `discrete` are [`Session::rotate_by`]'s. The kernel resolves the
     * selection and applies the turn in one atomic transition: one swing, one
     * history entry.
     *
     * # Errors
     *
     * `unknown_element` when the selection names nothing the scene holds.
     */
    rotateAll(to_x: number, to_y: number, discrete: boolean): void;
    /**
     * Turn an element to the angle the pointer names about its centre.
     *
     * The pointer is in screen pixels, where it was when the rotator was
     * dragged. The angle is upstream's (`rotateSingleElement`): the one from
     * the element's centre to the pointer, zero with the pointer straight
     * above it. It does not depend on where the drag started, so a press on
     * the rotator turns nothing until the pointer moves. `discrete` is the
     * Shift key, which locks the angle to fifteen degrees.
     *
     * # Errors
     *
     * `unknown_element` for an id the session does not hold.
     */
    rotateBy(id: string, to_x: number, to_y: number, discrete: boolean): void;
    /**
     * Rotate an element by a delta in radians, added to its current `angle`.
     *
     * The gesture sends the screen-space `atan2` delta from the centre of the element
     * to the cursor, which is the only thing a pointer device gives a number for, and
     * the kernel adds it to the current angle. The geometry is left alone — the render
     * path re-applies the new angle on the next `frame`. A zero delta is a no-op
     * that does not advance `version`, the same rule as `translate` and `resize`.
     *
     * # Errors
     *
     * `unknown_element` for an id the session does not hold.
     */
    rotate(id: string, delta_radians: number): void;
    /**
     * Read the sketch level of an element as its wire token, or nothing when the element
     * carries a level the format does not name.
     *
     * "Nothing" is `undefined` on the JS side, not `null`: `wasm-bindgen` marshals a
     * `None` `Option<String>` as an absent value, and a client comparing it with `===`
     * against a button's token gets `false` either way. The distinction is worth being
     * exact about, because a doc that promises `null` sends the next reader looking for a
     * value that was never there.
     *
     * The `None` is the point of this signature. The sibling getters return `String`
     * because their models are closed enums and every value has a name; `Roughness` is
     * deliberately not, so a document from Excalidraw or a future build can arrive with
     * `7` and this reports it as "no button is active" instead of snapping it to
     * `cartoonist`. The number itself is untouched on disk and in the scene — only the
     * toolbar's highlight is absent, which is the honest answer for a value with no name.
     */
    roughnessOf(id: string): string | undefined;
    /**
     * The drawing as a library file: the whole scene, one piece.
     *
     * The envelope is the reference's second version, and the elements are
     * written the way a document is written — the bytes this build carries
     * go back as they arrived — so a file a user saves carries what their
     * drawing carried.
     *
     * # Errors
     *
     * Whatever an element's own serialisation refuses, as `serialize: …`.
     */
    saveLibrary(): string;
    /**
     * The ids of the elements the scene holds, in the scene's order.
     *
     * The question is "which elements are still here?", and it is the scene's
     * own answer — the client asks because it holds something that has to
     * agree with it: the picture cache. An element that leaves the scene
     * takes its picture with it, and the cache cannot know that on its own
     * when the leaving was the history's doing (an undo swaps whole scenes,
     * so no deletion happened and no id was reported).
     *
     * The answer is the ids and not the elements: the client compares them
     * against the ids it holds and releases the ones the scene no longer
     * names. What it does with that is the client's business; what the
     * elements *are* is the kernel's.
     *
     * The scene's order, not a sorted list: the ids are what they are for —
     * a set to compare against — and the order costs nothing to keep and
     * would cost a sort to lose.
     */
    sceneIds(): string[];
    /**
     * Scale and pan a scene point into canvas coordinates.
     *
     * The mirror of [`Session::screen_to_scene`], and it exists because the client had
     * no way to draw a scene-space point — the rotation ghost's centre and the chrome
     * hit-test's centre — at a viewport that is not the identity. It reached for a
     * `scene * zoom` of its own, which is the third copy of this transform in the
     * repository and the one that drops the scroll term entirely.
     */
    sceneToScreen(scene_x: number, scene_y: number): Float64Array;
    /**
     * Convert a screen-space point (CSS pixels, canvas-relative) to scene
     * units. Returns `[scene_x, scene_y]`. The same formula
     * `hit_test_at_screen` uses internally; exposing it lets the client
     * place a new element at the exact click position without re-deriving
     * the viewport transform.
     */
    screenToScene(screen_x: number, screen_y: number): Float64Array;
    /**
     * Replace the selection with every id in the scene. Mirrors
     * `Cmd+A`. The empty-scene case is a noop.
     */
    selectAll(): void;
    /**
     * Select `id` itself and mark its innermost group as the group being edited.
     *
     * The Ctrl/Cmd-click of upstream's selection tool (`WF-SELECT-06`): a plain click
     * expands a grouped element to its group, and this one does not — it selects the
     * element and keeps the group as the editing group, which is what makes the
     * reference draw the group's dashed box around a one-element selection.
     *
     * No undo step: the document did not move.
     */
    selectDeep(id: string): void;
    /**
     * The selection a plain click makes: the element's outermost group inside the group
     * being edited, or the element itself.
     *
     * The click half of `WF-SELECT-08`. Outside an edited group this is the familiar
     * "a click on a member selects the group"; inside one, it selects the member (or the
     * group just inside it) and keeps the group being edited, which is what makes the
     * group's dashed box stay while the user works inside it. A click on a locked or
     * deleted element selects nothing.
     *
     * No undo step: the click moved no element.
     */
    selectUnit(id: string): void;
    /**
     * Select one vertex of the element being edited, or none of them.
     *
     * The index is the vertex's own index in the element's point list. Passing
     * `undefined` unselects, which is what a click on empty canvas means.
     *
     * The selection lives in the kernel because the mode does: the mode ends
     * when the element leaves the selection, and that is an event the client
     * does not own. A selection the client held would go on naming a vertex
     * that is no longer on the screen.
     */
    selectVertex(index?: number | null): void;
    /**
     * The unit a click on `id` selects, as the kernel answers it: the outermost group
     * inside the edited group, or the element itself.
     *
     * Alt-click's cycle steps by this name, so a group under the pointer is one step and
     * not one per member (`WF-SELECT-12`), and a group nested in the edited one is a step
     * of its own.
     */
    selectableUnitOf(id: string): string | undefined;
    /**
     * The ids that are currently selected, in sorted order.
     */
    selectedIds(): string[];
    /**
     * The vertex that is selected in the element being edited, if any.
     *
     * `undefined` when no vertex is picked, which is the usual case: the mode
     * is open and the user has not touched a point yet.
     */
    selectedVertex(): number | undefined;
    /**
     * Navigate from `id` by a named relation and answer with the targets.
     *
     * Relations: `next`, `previous`, `parent`, `children`, `incoming`,
     * `outgoing` and the four spatial directions. The answer is
     * `{"version":1,"relation":…,"targets":[ids],"freeEnd":bool}`; a free
     * arrow end is reported and is never turned into a target.
     *
     * # Errors
     *
     * An empty id, an unknown relation or a serialisation failure names
     * itself as `semantic_navigate_invalid:`/`semantic_navigate_failed:`.
     */
    semanticNavigate(id: string, relation: string): string;
    /**
     * The same projection, filtered and paginated: the filter is JSON with
     * `kind` (a token), `offset` and `limit`, and nothing else.
     *
     * # Errors
     *
     * A filter that is not JSON, or that names a key the contract does not
     * have, fails as `semantic_query_invalid:`; the caller gets a sentence,
     * not an empty list that looks like a scene with no elements.
     */
    semanticQuery(filter: string): string;
    /**
     * The semantic projection of this document, as compact JSON (contract v1).
     *
     * One crossing for the whole scene, on demand: the caller asks when a
     * consumer needs the model, not on every frame. The contract is the one
     * [`nextdraw_core::semantic::SemanticScene::contract_json`] documents —
     * ids, kinds, labels, bounds, memberships and relations, with no dataURL,
     * clipboard or embedded HTML — and it is versioned so an old consumer
     * refuses a newer contract instead of guessing.
     *
     * # Errors
     *
     * The projection is numbers and strings; the `Result` is the honest
     * signature and names the failure as `semantic_snapshot_failed:`.
     */
    semanticSnapshot(): string;
    /**
     * Show a region of an image's bitmap, or the whole one again.
     *
     * The region arrives as the document spells it — natural pixels and the
     * natural size — or as an explicit `null` to show the whole bitmap. The
     * kernel validates the region before writing it.
     *
     * # Errors
     *
     * `unknown_element`, `not_an_image`, or `crop_outside_the_bitmap`.
     */
    setCrop(id: string, region_json?: string | null): void;
    /**
     * Set the author's accessibility metadata in the versioned namespace
     * `customData.nextdrawAccessibility` (TASK-187). `meta` is JSON with
     * `name`/`alt`/`description`; an absent field is left alone, an empty
     * string clears it, unknown keys and over-long values are refused.
     */
    setElementMeta(ids: string[], meta: string): void;
    /**
     * Set the grid step; `undefined` (or any non-positive number) switches
     * the grid off. View-only: it repaints the frame and never touches the
     * document.
     */
    setGridStep(step?: number | null): void;
    /**
     * Record the vertex of an element that the pointer last moved over.
     *
     * The index is the vertex's own index in the element's point list, and
     * the element travels with it because the same index on another
     * element's list names another point: the chrome publishes the disk for
     * the element it names and for no other. Passing `undefined` is the
     * pointer's move off every point, and the disk goes out.
     *
     * The fact lives in the kernel because the disk is painted from the
     * chrome the kernel builds: a client-held hover would light a point the
     * drawing does not, and the two would drift apart on the first zoom.
     *
     * # Errors
     *
     * An id that is not a name the session can carry.
     */
    setHoverVertex(id: string, index?: number | null): void;
    /**
     * Set the address every named element carries, in one undoable transition.
     * An empty string clears the address; a `None` on the kernel side is what
     * the clear becomes. The address is sanitized here, at the only door a
     * client reaches it through: the allowlist is the kernel's
     * (`nextdraw_core::link::sanitize`), and a refusal names itself —
     * `bad_link: …` — the way every other vocabulary refusal on this surface
     * does. A stored `javascript:` address is a stored hazard, so the write
     * is where the line sits.
     */
    setLink(ids: string[], link: string): void;
    /**
     * Enable or disable midpoint targets for the local elbow endpoint-binding flow.
     */
    setMidpointSnapping(on: boolean): void;
    /**
     * Name a frame, or clear the name with `null`.
     *
     * A frame only: the name is the frame's field, and any other kind is
     * refused by name (`not_a_frame`) the way `setText` refuses a
     * non-text. The empty string is a *name* — upstream's editor stores what
     * the input carries, and an empty title is a frame titled with nothing,
     * which is a different thing from a frame with no title at all
     * (`getFrameLikeTitle`, `frame.ts:1009-1011`, falls back to "Frame" for
     * the `null` only).
     */
    setName(id: string, name?: string | null): void;
    /**
     * Replace the current selection.
     *
     * The selection is *not* on the undo stack, by design. Undoing a translate
     * that put an element on the selection does not deselect it: the user who
     * hit `Cmd+Z` wanted the document back, not their attention reshuffled.
     * This matches Excalidraw's split between `elements` and
     * `appState.selectedElementIds`.
     */
    setSelection(ids: string[]): void;
    /**
     * Turn alignment guides on or off. View-only, like the grid.
     */
    setSnapGuides(on: boolean): void;
    /**
     * Say where the document came from.
     *
     * Set once, by the client, to the origin the page is served from — which is what
     * upstream writes (`packages/common/src/constants.ts`, `getExportSource`).
     */
    setSource(source: string): void;
    /**
     * Write one style patch onto every element in `ids`, in one atomic transition.
     *
     * `patch` is a JSON object whose keys are the same vocabulary [`Session::styles_of`]
     * answers: `fill`, `stroke`, `lineWidth`, `roughness`, `opacity` and `edges`. The
     * reading door and the writing door speak one language, so a client that knows how
     * to read a family knows how to write it, and the answer a family gives is a request
     * that family accepts — the round trip is exact.
     *
     * ```text
     * session.setStyle(ids, JSON.stringify({ fill: "hachure" }));
     * session.setStyle(ids, JSON.stringify({ opacity: 40 }));
     * ```
     *
     * More than one property in one patch is one transition: a selection that gets a new
     * texture *and* a new dash is one entry in the history, not two.
     *
     * The multi-id shape keeps one undo per gesture: a four-element selection picking a
     * new texture is one entry in the history, not four. An empty list is a free no-op
     * and the version does not move, the contract the kernel's `*All` actions carry. An
     * id the scene does not hold is dropped rather than refused — unless nothing
     * survives, and then the call is refused by name, because a call that quietly did
     * nothing would be a lie about what happened.
     *
     * The **name** of a stroke width travels as a name and not as a number: the number a
     * name means depends on the element (a freehand stroke is written at half the width
     * of a shape), so the kernel resolves it per element, where the element is known.
     *
     * # Errors
     *
     * `bad_style: …` for a property the vocabulary does not have, for a value outside
     * that property's own vocabulary, and for a patch that is not an object — one prefix
     * for the whole door, so the client branches once.
     *
     * `unknown_element` when none of the named ids is in the scene: there was no element
     * to write to.
     */
    setStyle(ids: string[], patch: string): void;
    /**
     * Replace the body of a text element.
     *
     * The `body` argument is the literal text the kernel stores in the
     * variant's `text`; an empty string is a valid body (a label may be
     * a placeholder while the user is editing), and the round-trip is
     * `textOf(id) === body` afterwards.
     *
     * # Errors
     *
     * `unknown_element` if `id` is not in the scene, `not_a_text` if it is
     * anything but a `Text`. A body equal to the current one is a no-op
     * that does not advance the element's version, on the same rule the
     * `Update` patch follows.
     */
    setText(id: string, body: string): void;
    /**
     * Resize the viewport. The next [`frame`](Self::frame) reflects the new bounds.
     *
     * The same call is `set_viewport_size` on the kernel side; the JS name is
     * explicit because the surface in this crate is `setViewportSize` and a
     * client that wrote `session.setViewport(0, 0)` would get a TypeError.
     */
    setViewportSize(width: number, height: number): void;
    /**
     * Set the zoom level directly.
     *
     * Used by the keyboard shortcut `Ctrl+0` and the fit-to-content button; the
     * mouse-wheel zoom goes through [`zoom_at_centre`] because the anchor
     * matters there.
     */
    setZoom(zoom: number): void;
    /**
     * Where the shape switch's panel hangs from, as `[x, y]` in canvas pixels.
     *
     * The bottom-left corner of the one convertible element turned with it, or of the
     * common bounds of several, carried through the viewport; `undefined` when the
     * selection holds nothing the panel can convert.
     */
    shapeSwitchAnchor(): Float64Array | undefined;
    /**
     * What the conversion panel offers for the current selection, as one string.
     *
     * `"generic:rectangle"`, `"generic:diamond"`, `"generic:ellipse"`, `"linear:line"`,
     * `"linear:sharpArrow"`, `"linear:curvedArrow"` or `"linear:elbowArrow"` when every
     * convertible member shares that kind; `"generic:mixed"` or `"linear:mixed"` when they
     * differ; and `undefined` when neither family has a candidate — the panel has nothing
     * to show then. The prefix is the family, because a mix needs to say which row of
     * buttons it lights none of.
     */
    shapeSwitchState(): string | undefined;
    /**
     * Ask where a translation of `ids` by a **screen** travel of `(dx, dy)`
     * would land under the current grid and guide settings — without moving
     * anything.
     *
     * Returns JSON: `{"dx": …, "dy": …, "guides": [{"axis": "vertical",
     * "at": …}, …]}`. The travel and the answer are both in **screen pixels**,
     * because that is the space the pointer reports and the space the painter
     * draws in; the question is asked in scene units inside the kernel and the
     * answer comes back converted, so a client that converted either way
     * itself would be holding a copy of the transform (ADR-007).
     *
     * The client paints the guides while the gesture is in flight and rounds
     * nothing itself: the commit path ([`Self::translate_by`],
     * [`Self::nudge`]) consults the same pure question, so what was
     * painted mid-flight is what the committed delta answered to. A stale
     * id answers the raw delta with no guides — the same honest answer the
     * kernel gives a gesture that holds nothing.
     * What a creation drag's end would snap to, asked before the shape lands.
     *
     * The draft's painting query for the object snap (SNAP-05): the pair of
     * offsets, in **scene** units, that [`Session::insert_with_drag_end`]
     * would answer for a drag end at the scene point `(x, y)` — the same
     * pairing [`Session::snap_preview`] keeps for the move. The client adds
     * the pair to the point it builds the draft from, so the shape the user
     * watches grow is the shape the release lands; the commit still decides
     * from the raw end through the same pure rule, so a query that answers
     * and a commit that decides cannot drift.
     *
     * The door is a question: `&self`, and the scene it reads is the
     * committed one — a draft the browser took away leaves nothing behind.
     */
    snapCreateEnd(x: number, y: number): Float64Array;
    /**
     * Whether alignment guides are on.
     */
    snapGuides(): boolean;
    snapPreview(ids: string[], dx: number, dy: number): string;
    /**
     * Where the document says it came from.
     *
     * Upstream writes this beside the elements (`packages/excalidraw/data/json.ts`,
     * `serializeAsJSON`), and a document that does not say is a document that cannot be
     * traced back to the app that wrote it.
     */
    source(): string;
    /**
     * The scene-space side length of a newly placed sticky note.
     *
     * The client uses this when a click creates a note without a drag. Keeping the
     * value here makes the gesture consume the core's default instead of carrying a
     * second copy of it in JavaScript.
     */
    stickyNoteDefaultSize(): number;
    /**
     * The points of the stroke in flight, written into the travels themselves.
     *
     * The JSON door serialises four times for one stroke: the client
     * stringifies the travels, serde parses them, serde writes the answer and
     * the client parses it back. This door carries the travels as the f64s
     * they are: the caller hands a flat `Float64Array` of
     * `[x0, y0, x1, y1, …]` screen travels and the answer — the same scene
     * points the JSON door answers — is written into the same buffer, in
     * place. The marshalling copies the buffer in and back, which is the copy
     * the boundary already pays for every number, and no string crosses
     * anywhere. The JSON door stays: it is the oracle the flat answer is
     * compared against, bit for bit, by the artifact's own suite.
     *
     * # Errors
     *
     * `the travels do not pair` for an odd crossing, `the travels are not
     * finite` for a travel that is not a real place, and `no_stroke` when no
     * stroke is in flight — the same tag the JSON door answers with.
     */
    strokePointsFlat(travels: Float64Array): void;
    /**
     * The points of the stroke in flight, in scene units relative to its origin.
     *
     * The travels are the pointer's travels from the press, in screen pixels,
     * as a JSON array of `[x, y]` pairs. The answer is the same shape in scene
     * units.
     *
     * # Errors
     *
     * `no_stroke` when no stroke is in flight: a stroke with no zoom to be
     * measured with is not a stroke.
     */
    strokePoints(travels_json: string): string;
    /**
     * Read the current stroke style of an element, as the wire token
     * the SVG export already understands (`"solid" | "dashed" |
     * "dotted"`). Used by the toolbar to know which of the three stroke
     * buttons to render as active. The token is what `setStyle` accepts for
     * the `stroke` property, so the round-trip is exact.
     *
     * `unknown_element` for an absent id, so the JS side can branch the
     * same way it does for every other absent-id error in the surface.
     */
    strokeStyleOf(id: string): string;
    /**
     * All four style tokens for the session's own selection, as one JSON object.
     *
     * This is the answer to "which button of each toolbar is lit", which a paint
     * asks on every frame and used to ask four times. It takes no argument for the
     * same reason `selectionOutlines` takes none: the ids are the kernel's own, and
     * a paint already reads them for the click handlers — shipping them across a
     * second time would buy nothing and cost bytes per frame.
     *
     * `null`, not an object of empty strings, when nothing is selected. The client
     * compares a button's token with `===` and lights it on a match, so "no
     * selection" and "no value" have to land on the same branch, and `null` is
     * what both of them already produce today: an empty selection never reached the
     * getters, and an unnamed `Roughness` serialises as a JSON `null`.
     *
     * The keys are `fill`, `stroke`, `lineWidth` and `roughness` — the camelCase
     * spelling of each toolbar's `data-` attribute, which is the same word the
     * client's `datasetProp` derives. `scripts/smoke.test.mjs` compares this key
     * set against the client's `STYLES` table, so a rename on either side is red
     * rather than a toolbar that quietly lights nothing.
     */
    stylesOf(): string;
    /**
     * The bindable shape a straight arrow would tie to if its end were let go
     * at this scene point, with the geometry the client paints the hint from.
     *
     * The shape is the kernel's own answer — `Session::suggested_binding_at`,
     * the query the tie reads, so what the hint names and what the drop ties
     * is one statement, not two implementations kept in step. The client asks
     * on every move of an arrow's creating drag or of a straight arrow's
     * endpoint drag, paints the answer, and asks nothing when Ctrl/Cmd is
     * held, which silences the suggestion without silencing the tie.
     *
     * The JSON, all of it in screen pixels:
     *
     * - `id` — the suggested shape;
     * - `width` — the pen to stroke the outline with, already in screen
     *   pixels: upstream's `clamp(1.75, strokeWidth, 4) / max(0.25, zoom)`,
     *   with a frame's highlight stroked at the frame style's width. The
     *   client draws the number it is given and knows no zoom of its own —
     *   the same answer the chrome's own sizes ride behind;
     * - `dotRadius` — the midpoint dots' radius, `4 / max(0.25, zoom)`, in
     *   screen pixels for the same reason;
     * - `lines` — straight pieces, `[x1, y1, x2, y2]` each, the shape's ideal
     *   outline (no roughness — upstream strokes the deconstructed ideal
     *   here, not the drawn path) carried through the viewport and turned
     *   with the shape;
     * - `curves` — cubic pieces, `[p0x, p0y, c1x, c1y, c2x, c2y, p3x, p3y]`
     *   each, the rounded corners the same way;
     * - `ellipse` — `[cx, cy, rx, ry]` for an ellipse, `null` otherwise;
     * - `midpoints` — the side midpoints the reference dots the suggestion
     *   with: for a simple arrow only the one nearest the pointer, and only
     *   when it stands within twice the binding reach of it and the pointer
     *   is not inside the shape. The dots ride the suggestion the way the
     *   reference paints them with its midpoint snapping booted on; the
     *   port's own midpoint mode (TASK-149) keeps its standing markers and
     *   its elbow targets, and this hint is not their surface. The elbow's
     *   own targets already come from `bindingMidpoints`.
     *
     * `undefined` names no suggestion.
     */
    suggestedBindingAt(scene_x: number, scene_y: number, dragging?: string | null): string | undefined;
    /**
     * Switch the selected convertible elements to `shape`, the name the panel's button
     * carries, in one undoable action.
     *
     * The names are upstream's: `rectangle`, `diamond` and `ellipse` for the generic
     * family, and `line`, `sharpArrow`, `curvedArrow` and `elbowArrow` for the linear one.
     * The conversion only touches members of the target's own family, so a button aimed at
     * the other row is a no-op. Returns `false` when nothing changes, and writes no history
     * then. Unknown names are rejected with `bad_shape`.
     */
    switchSelectedShape(shape: string): boolean;
    /**
     * Take the frame if it has moved; answer zero if it has not.
     *
     * This is the crossing the client's paint asks, and it is one call where the
     * revision probe, the pointer and the length used to be three. The question
     * "has the frame moved?" is answered here, against the session's own counter,
     * instead of being asked across the boundary as `revision()` and compared in
     * JavaScript: the counter still crosses as a string for the callers that read
     * it, but a paint no longer pays a crossing to read a number and two more to
     * read the frame it licenses.
     *
     * # The answer
     *
     * Zero means the frame the client already decoded is still the frame: no bytes
     * were written, no view is valid, nothing is handed over. Any other value packs
     * the answer in its two halves — the offset into linear memory in the low 32
     * bits, the byte length in the high 32 — because a pointer and a length do not
     * fit in one `u32`, and on wasm32 a pointer *is* a u32, so the packing is exact
     * where the boundary lives. It crosses as a `u64`, which JavaScript reads as a
     * `BigInt`: the one crossing that pays the unboxing is the one that used to pay
     * for a pointer, a length and a string.
     *
     * Zero is an answer about *this session's takes*, not about the bytes in
     * [`Session::frame_buf`]: it says the last take of this session encoded a frame
     * that is still current. A caller that never took one — a freshly built cache
     * over a session another cache held, a page remounting over a live session —
     * has no frame to reuse, which is why the client's cold read still goes through
     * `buildFrame`/`frameLen` and zero is only read on a warm ask. `build_frame`
     * itself does not touch [`Session::frame_revision`]: the pair stays the honest
     * "encode now" primitive, and the takes are the only thing that can say
     * "unchanged".
     *
     * # Why `&mut self`
     *
     * The same reason [`Session::build_frame`] takes one — it may rewrite the
     * buffer a client may be holding a view over — and one more: recording which
     * revision the bytes answer is a write. This crate has no interior mutability,
     * so both writes live behind the one `&mut`.
     *
     * The view over the packed bytes is read in the same turn it is answered, for
     * the same three reasons `buildFrame`'s dies: the next take, the session
     * dropping, and any call that grows linear memory. The client's reader builds
     * the view, decodes and drops it inside the one function.
     */
    takeFrame(resources_revision: number): bigint;
    /**
     * What a double click on an element should edit.
     *
     * The answer is the kernel's: which kinds of element hold a text, and
     * whether this one already holds it, are rules of the format and not of
     * the page. The client asks and gets one of two answers:
     *
     * - `{"kind":"label","id":"…"}` — the label to edit, which is the element
     *   itself when it is a text, and the container's label when the
     *   container already holds one;
     * - `{"kind":"container","id":"…"}` — the container to bind a **new**
     *   label to.
     *
     * The answer says *label* and not *text* on purpose: a client's own copy
     * of the element vocabulary is what drifts out of step, and the answer
     * must not sound like the client is naming an element type.
     *
     * `null` for an element that has no text to edit and cannot hold one.
     */
    textEditTarget(id: string): string;
    /**
     * Read the body of a text element, as the raw string the user wrote.
     *
     * The body is the `text` field of the text variant (and `originalText`
     * behind it when a resize wrapped it); the kernel has no font measurer and so
     * no business with the string in `bound`, `patch`, `bounds` or
     * `hit_test`. The client uses this getter for two things: drawing the
     * glyph run on the canvas (`ctx.fillText`, with the `ctx.font` the text
     * record carries) and answering the SVG exporter's question when the
     * body has to be in the file. The `id` is a scene id; the response is
     * the body, or `unknown_element` if the id is not in the scene.
     *
     * An element that is not a text element returns an empty string rather
     * than `unknown_element`, so a caller that walks the scene asking
     * every element for its text body does not have to branch on the
     * element's kind first.
     *
     * H6.1: the answer is the body the *user* wrote. A text element whose
     * box has been dragged narrow carries the wrapped form under `text` —
     * that is what the frame paints — and the sentence behind it under
     * `originalText`, which is this. The distinction is the one the editor
     * needs: opening a box that has been wrapped twice must not hand the
     * user a paragraph riddled with breaks they never typed, and re-saving
     * it must not turn the layout into the source.
     */
    textOf(id: string): string;
    /**
     * What a click with the **text tool** at this screen point would do.
     *
     * The reference's own target rule for the tool
     * (`packages/excalidraw/components/App.textTool.ts:131-166`): a text under
     * the pointer is edited; an empty container whose centre the click is near
     * gets a label; anywhere else makes free text. The answer speaks the same
     * vocabulary as [`text_edit_target`](Self::text_edit_target), so the page
     * translates one answer shape and not two.
     *
     * The point is in **CSS pixels relative to the canvas**, the space the
     * pointer events arrive in: the tool reads the pointer, and the kernel
     * owns the viewport inversion (the same split as `hitTestAtScreen`).
     */
    textToolTargetAtScreen(screen_x: number, screen_y: number, tolerance: number): string;
    /**
     * The scene as a `.excalidraw` document.
     *
     * Returns text rather than bytes because the client hands it straight to a download or a
     * `localStorage.setItem`, and neither wants a `Uint8Array` it has to decode.
     *
     * # Errors
     *
     * `serialize: …` if the scene cannot be written. Reaching that would be a defect in
     * `nextdraw-codec`, not a user error, so the tag says which crate to look at.
     */
    toJson(): string;
    /**
     * Lock the selected elements, or unlock them if they are already locked.
     *
     * One call, one transition, one history entry. The rule is upstream's
     * (`packages/excalidraw/actions/actionElementLock.ts:23-24`): the
     * selection is locked when **every** selected element is unlocked, and
     * unlocked otherwise — so a selection that mixes locked and unlocked
     * elements unlocks, which is what makes the shortcut a toggle that
     * always converges instead of a question.
     *
     * Locking empties the selection, because a locked element cannot be
     * selected (`actionElementLock.ts:115-116`) and a selection of elements
     * that cannot be selected is a lie the client would then paint as a
     * ring. Unlocking keeps it.
     *
     * An empty selection is a free no-op. It matters: the rule above is
     * *vacuously true* of an empty selection, so without the guard the
     * shortcut with nothing selected would lock the whole document.
     */
    toggleLocked(): void;
    /**
     * Toggle the endpoint bindings of the sole selected arrow in one kernel action.
     * Returns `false` when the selection is not exactly one arrow.
     */
    toggleSelectedArrowBinding(): boolean;
    /**
     * Flip one id in the selection: add it if absent, remove it if present.
     *
     * The shift-click primitive. A method that only added would force the
     * client to read the state, branch, and call the right setter, which is
     * three crossings for what is one semantic gesture.
     */
    toggleSelection(id: string): void;
    /**
     * Wrap the selected non-frame elements, or unwrap their selected frame, in one undoable transition.
     *
     * Answers with the ids the transition leaves standing — the new frame
     * after a wrap, the released children after an unwrap — so the page
     * re-selects exactly what upstream leaves selected
     * (`actionFrame.ts:259-267`, `:199-205`).
     */
    toggleWrap(frame_json: string, selected_ids: string[]): string[];
    /**
     * Translate every id in the supplied list by `(dx, dy)` in one
     * atomic transition. Used by the pointerup commit on a multi-
     * element drag, where the expanded group membership differs
     * from the kernel's current selection. Empty list is a free
     * no-op; a stale id throws `unknown_element` without mutation.
     */
    translateAll(ids: string[], dx: number, dy: number): void;
    /**
     * Move the named elements by the pointer's travel.
     *
     * The travel is the distance between two points on the screen, and the
     * kernel measures it in the scene: the zoom of the view is the only part
     * of the transform that scales a difference, so the travel the document
     * records is the travel the pointer made.
     *
     * The move is the same one the wire's `translateAll` makes, snapping and
     * all: a drag that lands somewhere else than the arrow keys would is a
     * drag and a keystroke that disagree about where a move lands.
     *
     * # Errors
     *
     * `unknown_element` for an id the session does not hold.
     */
    translateBy(ids: string[], from_x: number, from_y: number, to_x: number, to_y: number): void;
    /**
     * Move an element by a delta.
     *
     * # Errors
     *
     * `unknown_element` for an id the session does not hold.
     */
    translate(id: string, dx: number, dy: number): void;
    /**
     * Clear one end's binding and leave the end where it stands: the drop made
     * with the binding key held.
     *
     * The shape the end was hanging from keeps naming the arrow, the way the
     * reference's own record does, and the end does not move.
     *
     * # Errors
     *
     * `unknown_element` for an id the session does not hold.
     */
    unbindArrowEnd(id: string, endpoint: string): void;
    /**
     * Revert the last successful action, returning `true` if the scene changed.
     *
     * A no-op (with `false` returned) when there is nothing to undo: a fresh session
     * has no history, and a session that has been undone to the bottom of its history
     * stops there. The boolean is the contract the client binds the `Cmd+Z` keypress
     * to: `true` means "the scene moved, re-paint"; `false` means "nothing happened,
     * do nothing". The kernel does not signal through errors here because an empty
     * history is not an error, it is a state.
     *
     * After an undo the redo stack holds the scene the user just left, so a `Cmd+Shift+Z`
     * brings it back. A new action — anything other than `undo` or `redo` — clears the
     * redo stack, which is the conventional branch-of-history shape and is the
     * only one that makes `undo; apply-other; redo` not silently re-apply the
     * original.
     */
    undo(): boolean;
    /**
     * Release every element from every named group in `group_ids`, in one
     * atomic transition. The wire counterpart of `Cmd+Shift+G` on a
     * multi-group selection: one undo reverses every release. An empty
     * list, or every id being unknown to the scene, is a free no-op.
     * The caller is responsible for deduplicating `group_ids`; passing
     * the same id twice is harmless but pointless.
     *
     * # Errors
     *
     * None today: a group id that no element carries names a group nobody
     * is in, and releasing it releases nothing.
     */
    ungroupAll(group_ids: string[]): void;
    /**
     * Release every element that belongs to the group with id `group_id`.
     *
     * An unknown `group_id` is a no-op, not an error: a `Cmd+Shift+G` that
     * fires on a selection with no group simply does nothing, the same shape
     * as `reorder("backward")` on the bottommost element.
     *
     * # Errors
     *
     * `bad_element_id` if `group_id` is the empty string — the same
     * `ElementId::new` rejection the other id-taking methods share.
     */
    ungroup(group_id: string): void;
    /**
     * Unlock every locked element in the scene, in one atomic transition.
     *
     * Upstream's `actionUnlockAllElements`
     * (`packages/excalidraw/actions/actionElementLock.ts:160-219`), which is
     * a canvas action rather than a shortcut: it appears when nothing is
     * selected and something is locked, because that is the only state in
     * which a locked element can be reached at all — it cannot be clicked,
     * and it cannot be selected.
     *
     * The elements it unlocks are selected afterwards
     * (`actionElementLock.ts:206-208`), so the user sees what just came
     * loose. With nothing locked this is a free no-op.
     */
    unlockAll(): void;
    updateArrowLabel(body: string): void;
    /**
     * Begin dragging a vertex.
     *
     * The drag is the gesture, and the gesture is one thing the user did: a
     * capture is opened, so every move that follows is part of one undo step
     * and the document is written once, when the gesture ends.
     *
     * # Errors
     *
     * `unknown_element` for an id the session does not hold.
     */
    vertexDragBegin(id: string, index: number): void;
    /**
     * Move the vertex being dragged.
     *
     * The scene moves live: the line follows the pointer while it is being
     * dragged, the way upstream's does
     * (`packages/element/src/linearElementEditor.ts:1421-1433`). The history
     * does not move with it — that is what the capture is for.
     *
     * # Errors
     *
     * `unknown_vertex` for an index the element does not have, and
     * `unknown_element` when no drag is in progress.
     */
    vertexDragMove(scene_x: number, scene_y: number): void;
    /**
     * Begin adding a vertex to one of the element's segments.
     *
     * The segment is the one the midpoint belongs to: the midpoint between
     * the points `i` and `i + 1` is the segment `i`.
     *
     * # Errors
     *
     * `unknown_element` for an id the session does not hold.
     */
    vertexInsertBegin(id: string, segment: number): void;
    /**
     * Move the vertex being added.
     *
     * The first move adds the vertex where the pointer is and the later ones
     * move it, which is upstream's shape: the point is created when the
     * pointer passes the drag threshold, and it is dragged from there
     * (`packages/element/src/linearElementEditor.ts:1784-1843`).
     *
     * The whole thing is one undo step, because the gesture holds a capture
     * from the first move to the last.
     *
     * # Errors
     *
     * `no_such_segment` for a segment the element does not have, and
     * `unknown_element` when no gesture is in progress.
     */
    vertexInsertMove(scene_x: number, scene_y: number): void;
    /**
     * The paper the document asks for, as the envelope carries it.
     *
     * Upstream paints `appState.viewBackgroundColor` into the canvas before it
     * draws (`bootstrapCanvas`, `renderer/helpers.ts:73`) — the paper is
     * **document state**, not the page's stylesheet: a document that declares
     * a cream background paints cream, here and everywhere else the document
     * is opened. A document that carries none — every fresh one, until the
     * envelope learns the key — asks for white, which is upstream's own
     * default (`appState.ts:123`, `COLOR_PALETTE.white`).
     *
     * The string crosses verbatim: the client owns whether it is a colour the
     * canvas accepts, exactly as upstream owns it in `bootstrapCanvas` — that
     * function seeds white first and skips the fill for `"transparent"`, and
     * the client mirrors the same branch rather than a second copy of the
     * rule here. `"transparent"` and colours the canvas cannot parse are
     * therefore answered as they were written, and the fall-through is only
     * for the key that is missing or is not a string at all.
     */
    viewBackground(): string;
    /**
     * Set the zoom level, keeping the centre of the viewport fixed.
     *
     * Mouse-wheel zoom feels right when the centre stays where the cursor
     * pointed; without an explicit anchor, `set_zoom` shifts the visible
     * rectangle and the content slides out from under the cursor.
     */
    zoomAtCentre(zoom: number): void;
    /**
     * Set the zoom level, keeping the canvas point `(x, y)` fixed.
     *
     * The point is in **canvas pixels** — where the pointer is — so a zoom with the
     * wheel leaves the drawing under the cursor where it was, which `zoomAtCentre`
     * cannot do for a cursor that is not in the middle.
     */
    zoomAt(x: number, y: number, zoom: number): void;
    /**
     * The current zoom level (screen pixels per scene unit).
     */
    zoom(): number;
    /**
     * Number of elements currently held in the clipboard.
     *
     * Cheap read; the kernel exposes the size without the elements
     * themselves so the `Cmd+V` affordance can be enabled only when
     * there is something to put down.
     */
    readonly clipboardLen: number;
    /**
     * How many elements the session holds.
     */
    readonly len: number;
}

/**
 * Trivial arithmetic, proving numbers cross the boundary with full `f64` fidelity.
 *
 * Kept even though it earns nothing: if this returns a wrong answer, every later
 * measurement is untrustworthy, and a smoke test that cannot fail is not a smoke test.
 */
export function add(a: number, b: number): number;

/**
 * The hosts and the schemes a frame may point at.
 *
 * The kernel owns the rule that decides which host a frame may name, and the
 * rule has a shape the reader of this answer needs: a host is matched bare
 * and exactly, so every plain entry answers to two spellings, and a wildcard
 * entry names a family. The list is published already expanded, because a
 * reader that had to re-derive the expansion would be a second copy of the
 * rule, and a second copy of a rule is where the drift starts.
 *
 * The other side of the boundary uses this to build the page's
 * Content-Security-Policy: the policy has to name at least every host the
 * kernel allows, or the browser refuses a frame the kernel would have built.
 */
export function allowedFrameHosts(): string;

/**
 * The version string the `.wasm` module reports. Proves the artifact loaded at all.
 */
export function build_id(): string;

/**
 * Read a `.excalidraw` document and report how many elements it holds.
 */
export function count_elements(json: string): number;

/**
 * The limits a document has to fit inside, as the kernel declares them.
 *
 * The kernel owns the fence, and a consumer that needs to know where the fence
 * stands asks for it instead of writing the number down: a limit written in two
 * places is a limit that can disagree with itself, and a limit that disagrees with
 * itself is not a limit.
 *
 * The numbers are the ones the codec applies, read from the declaration it applies
 * them from and not copied here. A reader that wants to know how long a document
 * may be does not have to read the source to find out.
 */
export function documentLimits(): string;

/**
 * Every element type this build models, in upstream's vocabulary.
 *
 * Published so the other side of the boundary does not have to guess: the client's
 * guard against re-spelling an element type used to grep the kernel's source for a
 * function signature, which broke the day the signature changed and would have broken
 * again the day a variant was added. The vocabulary is the kernel's, and this is where
 * it comes from.
 *
 * The list is the *modelled* types. An element of a type the kernel does not model is
 * carried through the document, and the client is not expected to know about it — it
 * arrives in the frame as something to draw, not as a type to compare against.
 */
export function elementKinds(): string[];

/**
 * The policy one embeddable address answers to: whether a frame may show the
 * page, and whether that page may share the document's origin. The kernel
 * owns the rule; the client that builds the iframe reads the answer instead
 * of keeping a copy of the list.
 */
export function embeddable_policy(link?: string | null): string;

/**
 * Install the hook that turns a panic into a tagged error.
 *
 * It runs when the module is instantiated, before anything calls it, so a
 * panic in the very first crossing is still a panic with words.
 *
 * Installing replaces whatever hook was there: this one is the boundary's
 * policy — a panic has to arrive with words — and a hook that said something
 * else would say it instead.
 */
export function install_panic_hook(): void;

/**
 * The tag a panic carries, published for the other side of the boundary.
 *
 * The page asks the artifact rather than writing the tag down, so the two
 * cannot disagree about what a panic looks like.
 */
export function kernelPanicTag(): string;

/**
 * Contract version of the WASM surface, so a stale JS bundle fails loudly rather than
 * reading a changed shape as valid.
 */
export function model_version(): number;

/**
 * A panic on purpose, so the panic path can be measured.
 *
 * No ordinary drawing panics: every refusal at this boundary is a `Result`,
 * and the kernel's own invariants hold. That is the good news and also the
 * problem — a path nothing can reach is a path nothing has measured, so the
 * artifact carries one deliberate panic, the way it already carries
 * [`crate::scene_selftest`].
 *
 * The boundary's own test calls it and looks at what arrives: the message
 * with its tag, and a module that still answers afterwards.
 */
export function panicProbe(): void;

/**
 * Distance from a point to the nearest point on a segment.
 *
 * Ports upstream `distanceToLineSegment`, `segment.ts:119`. This is the primitive a hit
 * test is built from: compare it against a pixel threshold.
 */
export function point_segment_distance(p: Float64Array, segment: Float64Array): number;

export function scene_selftest(): string;

/**
 * Where two segments cross, treating both as bounded: `[]`, or `[x, y]`.
 *
 * Ports upstream `lineSegmentIntersectionPoints`, `packages/math/src/segment.ts:149`.
 */
export function segment_intersection(a: Float64Array, b: Float64Array): Float64Array;

/**
 * Where two segments cross, using upstream's stricter parametric test: `[]`, or `[x, y]`.
 *
 * Ports upstream `segmentsIntersectAt`, `segment.ts:72`. It returns `[]` where
 * [`segment_intersection`] returns a point whenever the crossing lands at the start of
 * `b`. That difference is upstream's and is load-bearing for shapes that share a corner.
 */
export function strict_segment_intersection(a: Float64Array, b: Float64Array): Float64Array;

/**
 * The words the client reads without a frame: the style families' tokens, the
 * kinds the chrome and the hit answers use, and the full font-family catalog,
 * and the tags a refusal carries.
 *
 * Every list is the kernel's own table read through, not a copy of it: the
 * style tokens come from the types that parse and print them, the chrome and
 * handle names from the builder's own consts, the families from the font
 * table, and the errors from [`WireError`]. A vocabulary published beside
 * its rule is a vocabulary that can disagree with it; this one cannot, and
 * the boundary's suite walks each list against the rule that owns it.
 *
 * It crosses as JSON for the same reason [`wire_schema`] does: the client
 * mounts it once, at startup, and compares the words it is about to use
 * against the build that is about to draw with them.
 */
export function vocabulary(): string;

/**
 * The vocabulary the frame's bytes are written in.
 *
 * The frame crosses as postcard bytes, and postcard is not self-describing: a reader
 * has to know, before it reads a single byte, that the byte it is about to read is an
 * op and not something else. So the reader needs the variants, the tokens and the
 * order they are numbered in — and those used to be tables written by hand on the
 * client, kept honest by guards that read this crate's **source** with a regular
 * expression.
 *
 * The vocabulary is data now. The client mounts it at startup, and the guard that
 * used to scrape the source reads the artifact instead.
 *
 * The JSON carries the kernel's vocabulary and this boundary's error tags, because
 * the tags are the boundary's spelling of the kernel's refusals and the client is
 * the one that branches on them.
 */
export function wireSchema(): string;

/**
 * Serialise a scene to the `.excalidraw` envelope, proving the codec is reachable from JS.
 */
export function write_scene(json: string): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_session_free: (a: number, b: number) => void;
    readonly add: (a: number, b: number) => number;
    readonly allowedFrameHosts: (a: number) => void;
    readonly build_id: (a: number) => void;
    readonly count_elements: (a: number, b: number, c: number) => void;
    readonly documentLimits: (a: number) => void;
    readonly elementKinds: (a: number) => void;
    readonly embeddable_policy: (a: number, b: number, c: number) => void;
    readonly install_panic_hook: () => void;
    readonly kernelPanicTag: (a: number) => void;
    readonly model_version: () => number;
    readonly panicProbe: () => void;
    readonly point_segment_distance: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly scene_selftest: (a: number) => void;
    readonly segment_intersection: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly session_alignAll: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly session_anyLocked: (a: number) => number;
    readonly session_beginArrowLabel: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly session_beginEditing: (a: number, b: number, c: number) => number;
    readonly session_beginShapeSwitch: (a: number) => void;
    readonly session_beginStroke: (a: number, b: number, c: number, d: number) => void;
    readonly session_bindArrowEnd: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => void;
    readonly session_bindText: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly session_bindingMidpoints: (a: number, b: number) => void;
    readonly session_boundsOf: (a: number, b: number, c: number, d: number) => void;
    readonly session_buildFrame: (a: number, b: number) => number;
    readonly session_canRedo: (a: number) => number;
    readonly session_canUndo: (a: number) => number;
    readonly session_cancelArrowLabel: (a: number, b: number) => void;
    readonly session_checkDocumentBytes: (a: number, b: number, c: number) => void;
    readonly session_clearScene: (a: number, b: number) => void;
    readonly session_clearSelection: (a: number) => void;
    readonly session_clipboardLen: (a: number) => number;
    readonly session_clipboardText: (a: number, b: number) => void;
    readonly session_copy: (a: number, b: number, c: number, d: number) => void;
    readonly session_cropOf: (a: number, b: number, c: number, d: number) => void;
    readonly session_cut: (a: number, b: number, c: number, d: number) => void;
    readonly session_cycleSelectedShape: (a: number, b: number, c: number) => void;
    readonly session_delete: (a: number, b: number, c: number, d: number) => void;
    readonly session_deleteAll: (a: number, b: number) => void;
    readonly session_distributeAll: (a: number, b: number, c: number, d: number) => void;
    readonly session_documentRevision: (a: number, b: number) => void;
    readonly session_duplicate: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly session_duplicateAll: (a: number, b: number, c: number, d: number) => void;
    readonly session_duplicateTranslateBy: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
    readonly session_editDragCancel: (a: number) => void;
    readonly session_editDragEnd: (a: number) => void;
    readonly session_editingGroupId: (a: number, b: number) => void;
    readonly session_editingId: (a: number, b: number) => void;
    readonly session_embeddablesView: (a: number, b: number) => void;
    readonly session_enableTextAutoResize: (a: number, b: number, c: number, d: number) => void;
    readonly session_endEditing: (a: number) => void;
    readonly session_enterGroup: (a: number, b: number, c: number) => number;
    readonly session_eraserBegin: (a: number, b: number, c: number, d: number) => void;
    readonly session_eraserCancel: (a: number) => void;
    readonly session_eraserEnd: (a: number, b: number) => void;
    readonly session_eraserMove: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly session_eraserTrail: (a: number, b: number, c: number) => void;
    readonly session_exportSvg: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => void;
    readonly session_fillStyleOf: (a: number, b: number, c: number, d: number) => void;
    readonly session_finishArrowLabel: (a: number, b: number, c: number, d: number) => void;
    readonly session_fitContent: (a: number, b: number) => void;
    readonly session_fitSelection: (a: number, b: number) => void;
    readonly session_fixedSegmentDragBegin: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly session_fixedSegmentDragMove: (a: number, b: number, c: number, d: number) => void;
    readonly session_flip: (a: number, b: number, c: number, d: number) => void;
    readonly session_frame: (a: number, b: number) => void;
    readonly session_frameLen: (a: number) => number;
    readonly session_frameRange: (a: number, b: number, c: number, d: number) => void;
    readonly session_fromJson: (a: number, b: number, c: number) => void;
    readonly session_gridLines: (a: number, b: number) => void;
    readonly session_gridStep: (a: number, b: number) => void;
    readonly session_group: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly session_groupIdOf: (a: number, b: number, c: number, d: number) => void;
    readonly session_groupIdsOf: (a: number, b: number, c: number, d: number) => void;
    readonly session_groupMembersOf: (a: number, b: number, c: number, d: number) => void;
    readonly session_hasSelectedArrow: (a: number) => number;
    readonly session_historyDepth: (a: number) => number;
    readonly session_hitChromeAtScreen: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
    readonly session_hitFrameTitle: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => number;
    readonly session_hitSelectionChromeAtScreen: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly session_hitTest: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly session_hitTestAtScreen: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly session_imagePlacement: (a: number, b: number, c: number, d: number) => void;
    readonly session_imagePlacementFor: (a: number, b: number, c: number, d: number) => void;
    readonly session_imageText: (a: number, b: number, c: number, d: number) => void;
    readonly session_insert: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly session_insertLibraryItem: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly session_insertVertex: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly session_intersecting: (a: number, b: number, c: number, d: number) => void;
    readonly session_intersectingAtScreen: (a: number, b: number, c: number, d: number) => void;
    readonly session_isElbowed: (a: number, b: number, c: number) => number;
    readonly session_isEmpty: (a: number) => number;
    readonly session_isLocked: (a: number, b: number, c: number) => number;
    readonly session_isPathALoop: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly session_isSelected: (a: number, b: number, c: number) => number;
    readonly session_isTextFixed: (a: number, b: number, c: number) => number;
    readonly session_kindOf: (a: number, b: number, c: number, d: number) => void;
    readonly session_leaveGroup: (a: number) => void;
    readonly session_len: (a: number) => number;
    readonly session_lineWidthOf: (a: number, b: number, c: number, d: number) => void;
    readonly session_linkOf: (a: number, b: number, c: number, d: number) => void;
    readonly session_loadJson: (a: number, b: number, c: number, d: number) => void;
    readonly session_loadJsonWithReport: (a: number, b: number, c: number, d: number) => void;
    readonly session_midpointSnapping: (a: number) => number;
    readonly session_moveVertex: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly session_navigateFlowchart: (a: number, b: number, c: number, d: number) => void;
    readonly session_new: () => number;
    readonly session_nudge: (a: number, b: number, c: number, d: number) => void;
    readonly session_nudgeRotate: (a: number, b: number, c: number) => void;
    readonly session_pan: (a: number, b: number, c: number) => void;
    readonly session_paste: (a: number, b: number, c: number, d: number) => void;
    readonly session_pasteClipboard: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly session_previewOps: (a: number, b: number, c: number, d: number) => void;
    readonly session_previewResizeBy: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number) => void;
    readonly session_previewRotateAll: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly session_previewRotateBy: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly session_previewTranslateBy: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
    readonly session_redo: (a: number) => number;
    readonly session_releaseFixedSegment: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly session_removeVertex: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly session_reorder: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly session_reorderAll: (a: number, b: number, c: number, d: number) => void;
    readonly session_resize: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
    readonly session_resizeAll: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => void;
    readonly session_resizeBox: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number) => void;
    readonly session_resizeBy: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number) => void;
    readonly session_revision: (a: number, b: number) => void;
    readonly session_rotate: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly session_rotateAll: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly session_rotateBy: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly session_roughnessOf: (a: number, b: number, c: number, d: number) => void;
    readonly session_saveLibrary: (a: number, b: number) => void;
    readonly session_sceneIds: (a: number, b: number) => void;
    readonly session_sceneToScreen: (a: number, b: number, c: number, d: number) => void;
    readonly session_screenToScene: (a: number, b: number, c: number, d: number) => void;
    readonly session_selectAll: (a: number) => void;
    readonly session_selectDeep: (a: number, b: number, c: number) => void;
    readonly session_selectUnit: (a: number, b: number, c: number) => void;
    readonly session_selectVertex: (a: number, b: number) => void;
    readonly session_selectableUnitOf: (a: number, b: number, c: number, d: number) => void;
    readonly session_selectedIds: (a: number, b: number) => void;
    readonly session_selectedVertex: (a: number) => number;
    readonly session_semanticNavigate: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly session_semanticQuery: (a: number, b: number, c: number, d: number) => void;
    readonly session_semanticSnapshot: (a: number, b: number) => void;
    readonly session_setCrop: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly session_setElementMeta: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly session_setGridStep: (a: number, b: number, c: number) => void;
    readonly session_setHoverVertex: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly session_setLink: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly session_setMidpointSnapping: (a: number, b: number) => void;
    readonly session_setName: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly session_setSelection: (a: number, b: number, c: number) => void;
    readonly session_setSnapGuides: (a: number, b: number) => void;
    readonly session_setSource: (a: number, b: number, c: number) => void;
    readonly session_setStyle: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly session_setText: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly session_setViewportSize: (a: number, b: number, c: number) => void;
    readonly session_setZoom: (a: number, b: number) => void;
    readonly session_shapeSwitchAnchor: (a: number, b: number) => void;
    readonly session_shapeSwitchState: (a: number, b: number) => void;
    readonly session_snapCreateEnd: (a: number, b: number, c: number, d: number) => void;
    readonly session_snapGuides: (a: number) => number;
    readonly session_snapPreview: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly session_source: (a: number, b: number) => void;
    readonly session_stickyNoteDefaultSize: (a: number) => number;
    readonly session_strokePoints: (a: number, b: number, c: number, d: number) => void;
    readonly session_strokePointsFlat: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly session_strokeStyleOf: (a: number, b: number, c: number, d: number) => void;
    readonly session_stylesOf: (a: number, b: number) => void;
    readonly session_suggestedBindingAt: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly session_switchSelectedShape: (a: number, b: number, c: number, d: number) => void;
    readonly session_takeFrame: (a: number, b: number) => bigint;
    readonly session_textEditTarget: (a: number, b: number, c: number, d: number) => void;
    readonly session_textOf: (a: number, b: number, c: number, d: number) => void;
    readonly session_textToolTargetAtScreen: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly session_toJson: (a: number, b: number) => void;
    readonly session_toggleLocked: (a: number, b: number) => void;
    readonly session_toggleSelectedArrowBinding: (a: number, b: number) => void;
    readonly session_toggleSelection: (a: number, b: number, c: number) => void;
    readonly session_toggleWrap: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly session_translate: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly session_translateAll: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly session_translateBy: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
    readonly session_unbindArrowEnd: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly session_undo: (a: number) => number;
    readonly session_ungroup: (a: number, b: number, c: number, d: number) => void;
    readonly session_ungroupAll: (a: number, b: number, c: number, d: number) => void;
    readonly session_unlockAll: (a: number, b: number) => void;
    readonly session_updateArrowLabel: (a: number, b: number, c: number, d: number) => void;
    readonly session_vertexDragBegin: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly session_vertexDragMove: (a: number, b: number, c: number, d: number) => void;
    readonly session_vertexInsertBegin: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly session_vertexInsertMove: (a: number, b: number, c: number, d: number) => void;
    readonly session_viewBackground: (a: number, b: number) => void;
    readonly session_zoom: (a: number) => number;
    readonly session_zoomAt: (a: number, b: number, c: number, d: number) => void;
    readonly session_zoomAtCentre: (a: number, b: number) => void;
    readonly strict_segment_intersection: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly vocabulary: (a: number) => void;
    readonly wireSchema: (a: number) => void;
    readonly write_scene: (a: number, b: number, c: number) => void;
    readonly __wbindgen_export: (a: number, b: number) => number;
    readonly __wbindgen_export2: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
    readonly __wbindgen_export3: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
