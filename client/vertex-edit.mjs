// The edit mode for the vertices of a polyline.
//
// Upstream's rule is that a double click on a linear element starts editing
// its vertices (`packages/excalidraw/components/App.tsx:6205`), and that the
// vertices are the **only** control on screen while it lasts: the box is not
// drawn, because a vertex of a polyline sits on the corner of its own box,
// and two controls on the same pixel is a question the pointer cannot answer
// (`packages/excalidraw/renderer/transformHandles.ts:328-340`).
//
// This module holds the two decisions that decide that, and nothing else: the
// element a double click would edit, and the vertex under the pointer. Both
// are asked of the kernel, because the kernel is where the chrome is built
// and where the rule about which shapes have vertices lives. A client copy of
// that rule would be a second truth about a rule that has to agree with the
// drawing's own.
//
// The three answers the mode needs — which element, which vertex, and what a
// vertex drag commits — are all here so that they can be tested without a
// browser, which is the same reason `text-edit.mjs` exists for the text
// editor.

/**
 * The kinds whose vertices can be edited.
 *
 * A line and an arrow are the same shape with a head, and both are polylines
 * with a list of points. Every other kind — a rectangle, a diamond, an
 * ellipse, a text, an image, a freehand stroke — has no vertices to edit:
 * upstream's `LinearElementEditor` is reached from the linear element's own
 * double click and from nowhere else.
 */
const EDITABLE_KINDS = new Set(["line", "arrow"]);

/**
 * The id of the element whose vertices a double click at (`x`, `y`) would
 * edit, or `null`.
 *
 * The coordinates are CSS pixels, the space the pointer is in, and they are
 * handed to the kernel's own hit test so that the answer is the same one the
 * drawing would give.
 *
 * @param {{ hitTestAtScreen(x: number, y: number, tolerance: number): { at(i: number): string | undefined }, kindOf(id: string): string, isElbowed?(id: string): boolean }} session
 * @param {number} x
 * @param {number} y
 * @returns {string | null}
 */
export function vertexEditableIdAt(session, x, y, modified = false) {
    const id = session.hitTestAtScreen(x, y, 0).at(0);
    if (!id) {
        return null;
    }
    const kind = session.kindOf(id);
    if (!EDITABLE_KINDS.has(kind)) {
        return null;
    }
    if (kind === "arrow" && (!modified || session.isElbowed(id))) {
        return null;
    }
    return id;
}

/**
 * The handle the pointer is over, or `null`.
 *
 * There are three kinds of handle on a linear element in the edit mode, and they
 * do different things: a **vertex** is moved, a **midpoint** is the place a
 * new vertex is added, and a **segment's** handle is the place a segment of a
 * turning arrow is pinned. The kernel draws the midpoint smaller and in another
 * colour, and it answers the grab with the same distinction, so the client
 * does not have to guess which one it is holding.
 *
 * The index is the vertex's own index in the element's point list, or the
 * **segment's** index for a midpoint and for the handle of a segment: the
 * midpoint between the points `i` and `i + 1` is the segment `i`, and a vertex
 * is added to a segment and a segment is pinned by its own.
 *
 * The kernel answers `null` for a pointer that is not over a handle, and also
 * for an element that is not being edited: the handles are only shipped
 * while the mode is on.
 *
 * @param {{ hitChromeAtScreen(x: number, y: number, id: string): string }} session
 * @param {number} x
 * @param {number} y
 * @param {string} id the element being edited
 * @returns {{ kind: "vertex" | "midpoint" | "segment", index: number } | null}
 */
export function handleAt(session, x, y, id) {
    const hit = JSON.parse(session.hitChromeAtScreen(x, y, id));
    if (
        (hit.kind === "vertex" ||
            hit.kind === "midpoint" ||
            hit.kind === "segment") &&
        typeof hit.index === "number"
    ) {
        return { kind: hit.kind, index: hit.index };
    }
    return null;
}

/**
 * What the `Supr` takes, according to the kernel's own answers.
 *
 * The three answers are the kernel's, and the client does not keep a copy of
 * any of them: the edit mode is the session's, the picked vertex is the
 * session's, and the element being edited is the session's. The mode ends
 * when the element leaves the selection — an event this module does not own —
 * so a selection the client kept would go on naming a vertex that is not on
 * the screen any more.
 *
 * The three answers are told apart by **what they are about**, not by a name:
 * a name the page spells out is a name the page owns, and "vertex" is already
 * the name of a gesture in the table
 * (`client/gesture.mjs`). So the answer says which point goes, or that the
 * selection goes, or that nothing goes — and the page asks about those.
 *
 * - `{ id, index }` — the picked point goes. This is upstream's rule while a
 *   linear element is being edited
 *   (`packages/excalidraw/actions/actionDeleteSelected.tsx:225-270`): the
 *   element is the thing being edited, and the point is the thing the user
 *   pointed at.
 * - `{ elements: true }` — the edit mode is off, so the selection goes, as it
 *   always did.
 * - `{ elements: false }` — the edit mode is on and no point is picked.
 *   Upstream does nothing at all here, because deleting the whole element is
 *   most likely a mistake: the user meant to take a point out and did not
 *   pick one
 *   (`packages/excalidraw/actions/actionDeleteSelected.tsx:236-240`).
 *
 * @param {{ editingId(): string | undefined, selectedVertex(): number | undefined }} session
 * @returns {{ id?: string, index?: number, elements?: boolean }}
 */
export function deleteTarget(session) {
    const id = session.editingId();
    if (id === undefined) {
        return { elements: true };
    }
    const index = session.selectedVertex();
    if (index === undefined) {
        return { elements: false };
    }
    return { id, index };
}

/**
 * The pinned segment a double click is asking to release, or `null`.
 *
 * Upstream releases a segment when the user double-clicks the handle of a
 * segment that is pinned
 * (`packages/excalidraw/components/App.tsx:6292`), and the chain is derived
 * again without it.
 *
 * The answer is the chrome's: the handles of the segments are only on the
 * screen while the element is being edited, so a double click on the handle of
 * an element that is not being edited finds nothing — and the page opens the
 * edit mode instead, the way upstream does.
 *
 * @param {{ hitChromeAtScreen(x: number, y: number, id: string): string }} session
 * @param {number} x the pointer, in canvas pixels
 * @param {number} y the pointer, in canvas pixels
 * @param {string} id the element being edited
 * @returns {{ id: string, segment: number } | null}
 */
export function releaseTarget(session, x, y, id) {
    const handle = handleAt(session, x, y, id);
    if (handle === null || handle.kind !== "segment") {
        return null;
    }
    return { id, segment: handle.index };
}
