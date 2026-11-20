/**
 * The text bound to a shape.
 *
 * # What the kernel says and what the page does
 *
 * The kernel answers a question the page cannot answer for itself: a double
 * click on a shape means "put a label in it", and a double click on a label
 * means "edit that label" — and which of the two an element is depends on the
 * rules of the format (which kinds of shape hold a text, and whether this
 * one already holds it), not on the rules of the page.
 *
 * So the kernel answers in its own vocabulary
 * (`{"kind":"label","id":…}` or `{"kind":"container","id":…}`) and this module
 * translates it into the two things the page has to *do*: edit a text, or put
 * a new label in a shape. The page never spells the kernel's vocabulary, so
 * the two cannot drift.
 */

/**
 * The page's two answers from the kernel's one vocabulary.
 *
 * The kernel names a `label` (a text to edit) or a `container` — and, for a
 * turning arrow, `arrow-label`, the road whose label is born when the editor
 * opens. The page never spells those words anywhere else.
 *
 * @param {{ kind: string, id: string } | null} answer what the kernel said.
 * @returns {{ text: string } | { container: string, arrowLabel?: boolean } | null}
 */
function targetFromAnswer(answer) {
    if (answer === null || answer === undefined) {
        return null;
    }
    if (answer.kind === "label") {
        return { text: answer.id };
    }
    // A turning arrow's label is born when the editor opens, not when it
    // closes: the kernel names the road (`arrow-label`) and the caller
    // creates the label before it mounts the editor — upstream's own
    // editor creates the bound text before it mounts
    // (`App.text.ts` `startTextEditing`), and the executed oracle names
    // the difference: the `elbow-release-segment` receipt ends the
    // gesture with the empty label bound, no submit in between.
    if (answer.kind === "arrow-label") {
        return { container: answer.id, arrowLabel: true };
    }
    return { container: answer.id };
}

/**
 * What a double click on an element should edit.
 *
 * `null` for an element that has no text to edit and cannot hold one: a line,
 * an image, a freehand stroke. A turning arrow answers `arrowLabel` — its
 * label is born when the editor opens, not when it closes — and a plain
 * arrow answers `null`: its double click is the pointer's, not a label's.
 *
 * @param {{ textEditTarget(id: string): string }} session
 * @param {string} id The element under the pointer.
 * @returns {{ text: string } | { container: string, arrowLabel?: boolean } | null}
 */
export function editTarget(session, id) {
    return targetFromAnswer(JSON.parse(session.textEditTarget(id)));
}

/**
 * What a click with the **text tool** at (`x`, `y`) would edit.
 *
 * A different question from the double click's, and the kernel answers it as
 * such: the text under the pointer is edited; an empty container whose
 * *centre* the click is near gets a label; anywhere else is free text
 * (`null`). The point is in CSS pixels relative to the canvas, the space the
 * pointer events arrive in — the kernel owns the viewport inversion.
 *
 * The container is looked for by box, not by ink: an unfilled rectangle has
 * no interior for the hit test, and the reference binds to it anyway. That is
 * the difference `TEXT-03` measured.
 *
 * @param {{ textToolTargetAtScreen(x: number, y: number, tolerance: number): string }} session
 * @param {number} x the point, in CSS pixels relative to the canvas.
 * @param {number} y the point, in CSS pixels relative to the canvas.
 * @returns {{ text: string } | { container: string, arrowLabel?: boolean } | null}
 */
export function textToolTargetAt(session, x, y) {
    return targetFromAnswer(JSON.parse(session.textToolTargetAtScreen(x, y, 0)));
}
