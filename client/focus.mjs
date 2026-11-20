// Focus decisions, kept apart from the elements they move.
//
// Two small questions recur in every sheet that takes the keyboard: where does
// `Tab` go next, and where does the focus go back to when the sheet closes. Both
// have answers that do not need a DOM, so they live here and are tested without
// one.

/**
 * Where `Tab` goes next inside a group that holds the focus.
 *
 * It wraps: a sheet that lets `Tab` walk out of it leaves the user typing into
 * a page they cannot see. With nothing focusable there is nowhere to go.
 *
 * @param {number} count How many focusable elements the sheet holds.
 * @param {number} current Which one has the focus, or `-1` when none does.
 * @param {boolean} backwards Whether `Shift` is held.
 * @returns {number} The index to focus, or `-1` when `count` is zero.
 */
export function cycleIndex(count, current, backwards) {
    if (count <= 0) {
        return -1;
    }
    if (current < 0 || current >= count) {
        return backwards ? count - 1 : 0;
    }
    return backwards ? (current - 1 + count) % count : (current + 1) % count;
}

/**
 * Remember what has the focus now, and say how to give it back.
 *
 * The returned function restores once: a second call does nothing, because a
 * sheet that settles twice must not steal the focus from whatever came next.
 * An element that has since lost its `focus` (it was removed, or it was never
 * an element) is skipped rather than thrown at.
 *
 * @param {{ activeElement: unknown }} doc
 * @returns {() => void}
 */
export function rememberFocus(doc) {
    let previous = doc.activeElement;
    return () => {
        const target = previous;
        previous = null;
        if (target !== null && target !== undefined && typeof target.focus === "function") {
            target.focus();
        }
    };
}
