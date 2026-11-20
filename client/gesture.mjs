// What a gesture *is*, in one place.
//
// Ten gestures exist: pan, rotate, resize, draw, marquee, translate, freedraw,
// eraser, pinch and vertex.
// Until now each of
// them was a string literal written at the point of creation, and each of them had its
// own hand-written commit branch on pointer-up. Nothing compared the two lists. That is
// the shape of a whole family of defects, and this repo has already paid for it once:
// H5.15 shipped an `Arrowhead` variant that reached the canvas and no arm drew it, under
// a fully green suite, because the guard watched names and not variants.
//
// So the list is declared once, with the facts that differ between gestures, and the
// page is wired to it. A ninth gesture now cannot be added without saying what it does
// on lift and what it draws while it is alive — and the structural guard in
// `wiring.test.mjs` fails if a gesture can be created that nothing commits, or committed
// that nothing creates.
//
// Why three facts and not one: "does lifting the pointer change the drawing?", "is there
// something on screen while the pointer is down?" and "does lifting the pointer leave a
// new element in the document?" are genuinely independent. A pan is neither a commit nor
// a preview — that is what "only moves the view" means. The two drawing gestures commit
// and preview: upstream's signature is a shape growing under the pointer while it is
// dragged, and the port draws the same thing — the *commit's own element*, answered by
// the kernel's draft door (`Session.previewOps`) from the gesture's state, painted by
// the frame's own op painter, and never in the scene, the history or the frame until the
// release inserts it. The table's earlier no said "a rubber band would be a new
// affordance"; the affordance stopped being new the day the door existed. Collapsing the
// three facts into one flag would still force one of them to lie. The third fact is the
// one that says what a gesture *leaves behind*: a gesture that creates an element leaves
// it chosen and the tool ready for the next one, and a gesture that does not leaves the
// page exactly as it found it.

/**
 * The gesture kinds. A frozen table rather than a Rust enum because these never cross
 * the frontier: a gesture is a thing that only exists between two DOM events on a canvas,
 * and no kernel method has ever heard of one.
 */
export const GESTURES = Object.freeze({
    PAN: "pan",
    ROTATE: "rotate",
    RESIZE: "resize",
    DRAW: "draw",
    MARQUEE: "marquee",
    TRANSLATE: "translate",
    FREEDRAW: "freedraw",
    ERASER: "eraser",
    LASER: "laser",
    PINCH: "pinch",
    VERTEX: "vertex",
    MIDPOINT: "midpoint",
    SEGMENT: "segment",
    CROP: "crop",
});

/**
 * One row per gesture: what lifting the pointer commits, and what is drawn meanwhile.
 *
 * `commits: false` means the gesture is a view change — there is no start value to
 * record, nothing to hand the kernel, and nothing to put in the history, because the
 * user moved the view to look at something rather than changing the drawing.
 *
 * The freehand stroke is a gesture of its own rather than a flavour of `DRAW`, and the
 * reason is the difference between what the two commit. `DRAW` commits a **box**: two
 * corners of a drag, and the kernel reads the box and nothing else. A freehand stroke
 * commits a **path**: the whole list of points the pointer travelled through, and the
 * kernel reads that list and derives the box from it. A single branch that read "the
 * corners of the drag" could not produce the second, and a branch that read "the points"
 * would have to un-read them for every other draw tool.
 *
 * The eraser is a gesture of its own for the same reason and one more: it commits a
 * **removal**, and it previews. The preview is upstream's own — the trail of ink under the
 * pointer, fading behind it — and it is the only thing that tells the user where the eraser
 * is about to bite.
 */
export const GESTURE_BEHAVIOUR = Object.freeze({
    [GESTURES.PAN]: Object.freeze({ commits: false, previews: false, creates: false }),
    [GESTURES.ROTATE]: Object.freeze({ commits: true, previews: true, creates: false }),
    [GESTURES.RESIZE]: Object.freeze({ commits: true, previews: true, creates: false }),
    [GESTURES.DRAW]: Object.freeze({ commits: true, previews: true, creates: true }),
    [GESTURES.MARQUEE]: Object.freeze({ commits: true, previews: true, creates: false }),
    [GESTURES.TRANSLATE]: Object.freeze({ commits: true, previews: true, creates: false }),
    [GESTURES.FREEDRAW]: Object.freeze({ commits: true, previews: true, creates: true }),
    [GESTURES.ERASER]: Object.freeze({ commits: true, previews: true, creates: false }),
    // The laser pointer's trail. It commits nothing — nothing the gesture
    // does ever reaches the document, which is the whole point of the tool —
    // and it previews the same way the eraser's ink does: the trail *is* the
    // thing the user is looking at, and it keeps decaying after the pointer
    // lifts. It creates nothing: the tool exists to point at a drawing, not
    // to add to it.
    //
    // The trail itself is not in this gesture and does not die with it. It
    // lives beside the gesture in the pipeline (the same place the eraser's
    // marks live in the kernel), because the fade runs on the clock and not
    // on the pointer: lifting the hand does not switch the laser off, it only
    // stops feeding it.
    [GESTURES.LASER]: Object.freeze({ commits: false, previews: true, creates: false }),
    // The pinch is the second gesture that is only the view. Two fingers on the
    // glass change what is on screen and nothing else: there is no start value to
    // record, no shape to hand the kernel, and nothing to put in the history. It
    // previews nothing either — the zoom *is* the preview, because the canvas
    // repaints with the new scale — so a second flag would be a second way of
    // saying "the picture already shows it".
    [GESTURES.PINCH]: Object.freeze({ commits: false, previews: false, creates: false }),
    // The vertex drag. It commits, because the drawing is different when the
    // pointer lifts, and it previews, because the kernel moves the vertex
    // **live**: the line follows the pointer while it is being dragged, the way
    // upstream's does (`packages/element/src/linearElementEditor.ts:1421-1433`).
    // The whole drag is one undo step, because the gesture holds a capture while
    // it lasts.
    //
    // It creates nothing: the element was already there, and the drag only
    // moves a point of it.
    [GESTURES.VERTEX]: Object.freeze({ commits: true, previews: true, creates: false }),
    // The midpoint drag. It commits, because the drawing has one more vertex
    // when the pointer lifts, and it previews, because the kernel adds the
    // vertex live and the line follows the pointer. The whole thing is one
    // undo step, because the gesture holds a capture while it lasts.
    //
    // It creates nothing: the element was already there, and the drag only
    // adds a point to it.
    [GESTURES.MIDPOINT]: Object.freeze({ commits: true, previews: true, creates: false }),
    // The drag of a segment of a turning arrow. It commits, because the elbow
    // is different when the pointer lifts — the segment is pinned and the chain
    // is built around it— and it previews, because the kernel pins the segment
    // **live**: the elbow follows the pointer while it is being dragged, the
    // way upstream's does (`packages/element/src/linearElementEditor.ts:2269-2350`).
    // The whole drag is one undo step, because the gesture holds a capture while
    // it lasts.
    //
    // It creates nothing: the element was already there, and the drag only
    // pins one of its segments.
    [GESTURES.SEGMENT]: Object.freeze({ commits: true, previews: true, creates: false }),
    // The region drag of a crop. It commits, because what the image shows is
    // different when the pointer lifts, and it previews, because the rectangle
    // the drag is choosing is drawn over the image while it is being dragged.
    // It creates nothing: the element was already there, and the drag only
    // names what part of its bitmap shows. The region lands in one `setCrop`
    // call on release, so the drag is one undo step without holding a capture —
    // nothing moves in the document while the pointer is down, which is why
    // the preview is a ghost over the image and not the image itself.
    [GESTURES.CROP]: Object.freeze({ commits: true, previews: true, creates: false }),
});

/**
 * Does lifting the pointer turn this gesture into a change to the drawing?
 *
 * A kind nobody declared answers `false`, which is the safe direction to be wrong in: an
 * unrecognised gesture moves the view instead of editing the document. The opposite
 * default would let a typo in a string literal invent an edit.
 *
 * @param {string} kind
 * @returns {boolean}
 */
export function commits(kind) {
    return GESTURE_BEHAVIOUR[kind]?.commits === true;
}

/**
 * Is there chrome on screen for this gesture between pointer-down and pointer-up?
 *
 * @param {string} kind
 * @returns {boolean}
 */
export function previews(kind) {
    return GESTURE_BEHAVIOUR[kind]?.previews === true;
}

/**
 * Does lifting the pointer leave a new element in the document?
 *
 * The two that do are the two that put something where there was nothing: a drag with a
 * draw tool leaves a shape, and a freehand drag leaves a stroke. Every other gesture
 * works on what is already there — it moves it, resizes it, turns it, groups it or
 * takes it away — so it leaves the document as it found it.
 *
 * The fact is asked here because the page needs to answer two questions about the same
 * gesture: what it leaves behind, and how the page is left afterwards. A gesture that
 * creates an element leaves it chosen and the tool back to selection, so the next drag
 * moves the shape instead of drawing over it; a gesture that does not leaves the choice
 * and the tool exactly as they were.
 *
 * @param {string} kind
 * @returns {boolean}
 */
export function createsElement(kind) {
    return GESTURE_BEHAVIOUR[kind]?.creates === true;
}

/**
 * The screen delta the view must move by since the last pointer event, or `null` when
 * this gesture is not the view.
 *
 * Incremental from the last position rather than from the start, because a pointer
 * capture can deliver a move for a coordinate the pointer passed through, and summing
 * from the start counts that coordinate twice.
 *
 * The delta is in CSS pixels and is not scaled: `session.pan` divides by the zoom itself,
 * because the scroll lives in scene units. A consumer that divides here as well makes the
 * gesture run at `1 / zoom` speed, which is invisible at 100% and wrong everywhere else.
 *
 * @param {{ kind: string, currentScreen: { x: number, y: number } } | null} gesture
 * @param {{ x: number, y: number }} next
 * @returns {{ x: number, y: number } | null}
 */
export function panBy(gesture, next) {
    if (gesture === null || gesture.kind !== GESTURES.PAN) {
        return null;
    }
    return { x: next.x - gesture.currentScreen.x, y: next.y - gesture.currentScreen.y };
}

/**
 * Which elements a translate drag should move.
 *
 * The two natural cases, in order:
 *
 * 1. The user grabbed an element that is already selected. They mean "move the whole
 *    selection"; dragging only one would feel wrong. The selection may include one or
 *    two members of a group but not all of them, so each selected id is expanded to
 *    its group's full membership — otherwise a translate drag would silently leave
 *    the rest of the group behind, and the user would have to notice and Cmd+G to
 *    fix it.
 * 2. The user grabbed an element that is NOT in the selection. They mean "move just
 *    this one", and the drag itself is the moment the selection becomes this one
 *    element.
 *
 * The selection change for case 2 is dispatched on pointerup, because shift-click on
 * the same element must still be a deselect even when a drag started.
 *
 * **A `Set`, and not a list.** The answer is asked once per pointermove and then
 * asked again, per record, to decide whether that record moves with the drag. A list
 * answers that question by scanning itself, so a drag of `S` selected elements cost
 * `S × S` comparisons per frame — a quadratic that only shows up once a user selects
 * a lot and drags. A set answers in constant time, and the commit can still hand the
 * frontier a list, because the frontier takes a list.
 *
 * @param {string | null} hitId
 * @param {{ isSelected(id: string): boolean, selectedIds(): string[], groupMembersOf(id: string): string[] }} session
 * @returns {Set<string>}
 */
export function dragTargetsFor(hitId, session) {
    if (hitId === null) {
        return new Set();
    }
    if (session.isSelected(hitId)) {
        const out = new Set();
        for (const id of session.selectedIds()) {
            for (const member of session.groupMembersOf(id)) {
                out.add(member);
            }
        }
        return out;
    }
    // The grabbed id was not selected — but a plain click selects the whole group, and
    // the same gesture in drag form must move the whole group. Without this, dragging
    // a single group member from a non-selected state would split the group apart on
    // the canvas.
    const group = session.groupMembersOf(hitId);
    return group.length > 0 ? new Set(group) : new Set([hitId]);
}

/**
 * Discard a gesture the browser took away.
 *
 * A `pointercancel` is not a release. It means the browser took the pointer over — a
 * palm rejection, a scroll that carried the pointer off, a system gesture — and no
 * `pointerup` will follow. Upstream says so in its own code, with the reason written
 * next to it: *the browser took the pointer over — no pointerup will follow*
 * (`handleCanvasPointerCancel` → `maybeCleanupAfterMissingPointerUp`).
 *
 * So the gesture is **discarded**, and a discarded gesture commits nothing: a drag the
 * browser took away must not move the drawing, a box the browser took away must not
 * appear, and a rotation must not turn. The rule lives here, apart from the release
 * path, so that "cancelled" and "released" cannot be the same code with a different
 * name — that is exactly what they were, and a cancelled drag confirmed itself.
 *
 * The eraser is the one gesture that needs its own way to say it. It **marks** the
 * elements it crosses while the pointer is down and deletes them when the pointer is
 * released, so ending the gesture would delete everything it marked — the opposite of
 * abandoning it. `eraserCancel` is how the session puts those marks back.
 *
 * The vertex drag needs one for the same reason, and it is the same shape of problem:
 * it moves the drawing **live**, so the scene it left behind has to be put back when
 * the gesture is thrown away. A cancelled drag that kept its move would be a drawing
 * the user never asked for, committed by a gesture that was abandoned.
 *
 * @param {string} kind the gesture that was in flight
 * @param {{ eraserCancel(): void, editDragCancel(): void }} session the kernel session
 * @param {() => void} repaint redraw the canvas from the scene
 * @returns {void}
 */
export function cancelGesture(kind, session, repaint) {
    if (kind === GESTURES.ERASER) {
        session.eraserCancel();
    }
    if (kind === GESTURES.VERTEX || kind === GESTURES.MIDPOINT || kind === GESTURES.SEGMENT) {
        session.editDragCancel();
    }
    repaint();
}
