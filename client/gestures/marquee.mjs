// The marquee gesture: the rubber-band rectangle dragged over empty canvas.
//
// # What it is
//
// A press on nothing, dragged, chooses by area: every element the rectangle crosses
// becomes the selection. Shift keeps what was already chosen and adds to it, the way a
// shift-click on one element does.
//
// # The four moments
//
// `start` is the press: it keeps where the pointer went down and whether the selection is
// additive. `move` returns the gesture with the pointer at its new place. `commit` asks the
// kernel which elements the rectangle crosses and sets the selection once, so the choice
// is one crossing and not one per element. `preview` is the rectangle the page paints
// while the pointer is down. A press that never became a drag is a click on empty space,
// and that is the pipeline's to answer; it does not reach `commit`.
//
// The rectangle is the same one in `commit` and in `preview`, and it is normalised: a drag
// from the right to the left chooses what a drag from the left to the right would.
//
// Nothing here catches: a refusal from the kernel is the pipeline's to report.

import { GESTURES } from "../gesture.mjs";

/**
 * @typedef {{ left: number, top: number, right: number, bottom: number }} ScreenRect
 */

/**
 * The gesture a press on empty canvas begins.
 *
 * A press with Ctrl/Cmd on an element is the one that starts a marquee **inside** a
 * selection (`WF-SELECT-05`): upstream disables the drag of the pressed element and grows
 * the box instead, and the element under the press is the gesture's fallback when the box
 * catches nothing. That element rides along as `hit`, and `commit` gives it the rule.
 *
 * @param {{ x: number, y: number }} startScreen Where the pointer went down.
 * @param {boolean} additive Whether the chosen elements join the current selection.
 * @param {{ hit?: string|null }} [inside] The element under a Ctrl/Cmd press, when there was one.
 * @returns {object} The payload for a new gesture, without its owners.
 */
export function start(startScreen, additive, inside = {}) {
    return {
        kind: GESTURES.MARQUEE,
        startScreen,
        currentScreen: startScreen,
        additive: additive === true,
        hit: inside.hit ?? null,
    };
}

/**
 * The gesture with the pointer at its new place. The start never moves.
 *
 * @param {object} gesture
 * @param {{ x: number, y: number }} next
 * @returns {object}
 */
export function move(gesture, next) {
    return { ...gesture, currentScreen: next };
}

/**
 * The rectangle the two corners span, with its edges in order.
 *
 * @param {{ startScreen: { x: number, y: number }, currentScreen: { x: number, y: number } }} gesture
 * @returns {ScreenRect}
 */
export function rectOf(gesture) {
    return {
        left: Math.min(gesture.startScreen.x, gesture.currentScreen.x),
        top: Math.min(gesture.startScreen.y, gesture.currentScreen.y),
        right: Math.max(gesture.startScreen.x, gesture.currentScreen.x),
        bottom: Math.max(gesture.startScreen.y, gesture.currentScreen.y),
    };
}

/**
 * Choose what the rectangle crosses. An additive marquee keeps the previous selection and
 * adds the crossed elements, each once.
 *
 * A marquee started with Ctrl/Cmd on an element follows upstream's box rule
 * (`App.selectionTool.ts:handleBoxSelectionOnPointerMove`): the boxed elements replace the
 * selection, and the element under the press is kept only when the box caught nothing. The
 * chosen set is then expanded to whole groups, the way every selection is — a box that
 * catches one member of a group selects the group, and so does the fallback press.
 *
 * @param {{ intersectingAtScreen: Function, selectedIds: Function, setSelection: Function,
 *   groupMembersOf: Function }} session
 * @param {object} gesture
 */
export function commit(session, gesture) {
    const { left, top, right, bottom } = rectOf(gesture);
    const hits = session.intersectingAtScreen([left, top, right, bottom]);
    if (gesture.hit !== null && gesture.hit !== undefined) {
        commitInside(session, gesture, hits);
        return;
    }
    if (gesture.additive) {
        const chosen = new Set(session.selectedIds());
        for (const id of hits) {
            chosen.add(id);
        }
        session.setSelection([...chosen]);
        return;
    }
    session.setSelection(hits);
}

/**
 * The selection a Ctrl/Cmd marquee ends with: the box's catch, or the press when it caught
 * nothing, expanded to whole groups.
 *
 * @param {object} session
 * @param {object} gesture
 * @param {string[]} hits the elements the box crosses.
 */
function commitInside(session, gesture, hits) {
    const boxed = new Set(hits);
    const chosen = gesture.additive ? [...session.selectedIds()] : [];
    if (boxed.size > 0) {
        for (const id of boxed) {
            chosen.push(id);
        }
        // Upstream drops the pressed element when the box caught anything else
        // (`App.selectionTool.ts`, the `delete nextSelectedElementIds[hit.element.id]`
        // line): the box is the gesture's answer, and keeping both would select what the
        // user dragged away from.
        if (gesture.additive && !boxed.has(gesture.hit)) {
            const at = chosen.indexOf(gesture.hit);
            if (at !== -1) chosen.splice(at, 1);
        }
    } else {
        chosen.push(gesture.hit);
    }
    session.setSelection(wholeGroupsOf(session, chosen));
}

/**
 * The chosen ids with every group they touch, each once, in first-seen order.
 *
 * @param {{ groupMembersOf: Function }} session
 * @param {string[]} ids
 * @returns {string[]}
 */
function wholeGroupsOf(session, ids) {
    const chosen = [];
    const seen = new Set();
    for (const id of ids) {
        for (const member of session.groupMembersOf(id)) {
            if (seen.has(member)) continue;
            seen.add(member);
            chosen.push(member);
        }
    }
    return chosen;
}

/**
 * The rectangle the page paints while the gesture lives.
 *
 * @param {object | null} gesture
 * @returns {ScreenRect | null}
 */
export function preview(gesture) {
    if (gesture?.kind !== GESTURES.MARQUEE) {
        return null;
    }
    return rectOf(gesture);
}
