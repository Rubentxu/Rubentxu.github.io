// Who owns the gesture in flight, and what a pointer that arrives in the middle of one
// is allowed to do.
//
// # The question this module exists to answer
//
// A gesture used to belong to nobody. The page kept a single variable and whichever
// pointer event arrived last could move it, end it or replace it. With a mouse that
// never shows, because a mouse has one pointer; with a finger it shows at once:
//
// - a second finger was read as the start of a pinch only while exactly two fingers were
//   down, so a third finger was read as a fresh press and replaced the pinch with a
//   drawing;
// - a finger that had been refused could still lift and commit the drawing that another
//   finger had started;
// - a mouse pressing a button while a finger was drawing took the drawing away from it.
//
// None of those is a defect in the gesture that was in flight. They are defects in a
// question the page never asked: *who is this gesture for?* A gesture has an owner — the
// pointer that began it — and only the owner may move it or end it.
//
// # The rule
//
// A pointer that arrives while a gesture is in flight is admitted only when it can be
// the second finger of a pinch. Anything else is refused, and a refused pointer never
// reaches the canvas: it does not move the gesture, it does not end it, and it does not
// join the pinch.
//
// The functions here are pure. They answer questions about a stream of pointers without
// a DOM, a canvas or a kernel, so a sequence of fingers can be written down and read
// back — which is the only way to tell a rule that holds from a rule that held on the
// afternoon it was written.

/**
 * What a pointer that arrives while a gesture is in flight may do.
 *
 * The names are the three answers, and the third is the common one: a pointer with no
 * business here touches nothing.
 */
export const ADMISSION = Object.freeze({
    /** No gesture is in flight, so this pointer may begin one. */
    START: "start",
    /** A second finger: the gesture in flight is discarded and a pinch begins. */
    PINCH: "pinch",
    /** The pointer has no business here and changes nothing. */
    REFUSE: "refuse",
});

/**
 * What a pointer down is allowed to do, given the gesture in flight.
 *
 * The three inputs are the whole of the question: who owns the gesture that is running,
 * which pointers are fingers on the glass, and what kind of pointer just arrived.
 *
 * The order of the tests is the order of the refusals, and each refusal closes a hole:
 *
 * 1. **Nothing in flight** — the pointer may begin a gesture. This is the only answer
 *    that lets anything happen.
 * 2. **The pointer is not a finger** — refused. A mouse pressing a button while a
 *    finger is drawing does not take the drawing away from it. Two pointers of
 *    different kinds are two unrelated intentions, and the second one does not cancel
 *    the first.
 * 3. **The gesture in flight is not the first finger's own** — refused. A pinch already
 *    owns two fingers, and a third one cannot replace it.
 * 4. **There is more than one finger on the glass** — refused. A pinch is two fingers
 *    and no more, so a third finger is turned away instead of making the view lurch
 *    under a stray palm.
 *
 * What is left is the second finger of a pinch: the gesture in flight is discarded and
 * the two fingers become the pinch. That is the one case where a pointer that arrives
 * late is allowed to cancel what was running, and it is allowed because the user asked
 * for it with two fingers at once.
 *
 * @param {{owners: string[], touches: string[]}} stream The gesture in flight and the
 *   pointers on the glass. `owners` are the pointer ids that own the running gesture and
 *   `touches` are the ids of the fingers currently down.
 * @param {{pointerId: string, pointerType: string}} event The pointer that arrived.
 * @returns {string} One of the `ADMISSION` values.
 */
export function admitPointerDown(stream, event) {
    const owners = stream.owners;
    if (owners.length === 0) {
        return ADMISSION.START;
    }
    if (event.pointerType !== "touch") {
        return ADMISSION.REFUSE;
    }
    if (owners.length !== 1 || !stream.touches.includes(owners[0])) {
        return ADMISSION.REFUSE;
    }
    if (stream.touches.length !== 1) {
        return ADMISSION.REFUSE;
    }
    return ADMISSION.PINCH;
}

/**
 * Whether the pointer owns the gesture in flight.
 *
 * The pinch is the gesture with two owners, and both of them own it: either finger may
 * move the view, and either finger lifting ends the pinch. That is what makes a pinch
 * one gesture rather than two that happen to agree.
 *
 * @param {string[]} owners The pointer ids that own the gesture.
 * @param {string} pointerId The pointer that wants to act.
 * @returns {boolean}
 */
export function ownsGesture(owners, pointerId) {
    return owners.includes(pointerId);
}
