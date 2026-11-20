// When a drag moves the view instead of the drawing.
//
// Four questions, all pure, all small enough that a whole module is the honest
// size: when does a pointer mean "pan", what should the cursor say while it
// does, which button opens the menu, and how far the pointer may travel before
// that button stops meaning "menu" and starts meaning "pan".
//
// Why two triggers for one gesture: the middle button is what a drawing app
// already trained the hand to try, and space is what the same app's cursor
// advertises. They are the same predicate over two facts, so the code path
// after it is written once; adding a third later is a one-line change here
// rather than a new branch in the pointer handler.
//
// Why panning is not zoom-at-a-point, which is the obvious alternative: panning
// moves nothing in the document, so it needs no kernel support beyond the
// scroll it already owns, and it cannot corrupt a drawing by landing in the
// wrong place. Zooming at a point has to convert that point through the
// transform *and* move the scroll so the point stays put, which is a second
// derivation to get wrong. Pan first: it is the smaller claim, and without it a
// user who zooms in is trapped.

/**
 * The secondary button, in the DOM's own numbering.
 *
 * `0` is the primary and `1` is the middle, so `2` is the right one — the
 * button the platform calls "secondary".
 */
export const SECONDARY_BUTTON = 2;

/**
 * How far the pointer may travel before a secondary press becomes a pan.
 *
 * Five pixels, which is the same boundary the browser's own drag threshold
 * uses: a travel of exactly five pixels is still a right-click and the pan
 * starts at six. This module keeps that boundary and says so where the
 * comparison is made, because a threshold that is off by one is a press that
 * opens a menu when the user meant to drag.
 */
export const SECONDARY_PAN_THRESHOLD = 5;

/**
 * Does this pointer event start a pan?
 *
 * `button` is the DOM's own numbering, so 1 is the middle button and 0 is the primary.
 * `spaceHeld` is tracked by the keyboard handler rather than read off the event,
 * because a `PointerEvent` does not carry "is space down" — a keydown and a pointerdown
 * are different streams and the only honest bridge between them is a variable this
 * module's caller owns.
 *
 * @param {{ button: number, spaceHeld: boolean }} event
 * @returns {boolean}
 */
export function isPanGesture({ button, spaceHeld }) {
    // The middle button only. The right button has its own meaning, and it is
    // not a pan: it is the menu, and it becomes a pan only once the pointer
    // travels far enough — which is what `secondaryDragged` asks.
    return button === 1 || spaceHeld === true;
}

/**
 * Is this pointer press the one that opens the menu?
 *
 * The secondary button opens a *session*, not a menu: the menu opens when the
 * button is released without a drag, and a drag with the same button pans the
 * view. The session is what lets the two be told apart at the end.
 *
 * @param {{ button: number }} event
 * @returns {boolean}
 */
export function isSecondaryPress({ button }) {
    return button === SECONDARY_BUTTON;
}

/**
 * Has the pointer travelled far enough for the session to be a pan?
 *
 * The distance is measured from where the button went down, not from the last
 * move, because the question is "has the hand moved since it pressed" and not
 * "has it moved since the last frame".
 *
 * @param {{ x: number, y: number }} start Where the button went down.
 * @param {{ x: number, y: number }} current Where the pointer is now.
 * @returns {boolean}
 */
export function secondaryDragged(start, current) {
    const distance = Math.hypot(current.x - start.x, current.y - start.y);
    // `<=` and not `<`: the threshold is inclusive, so a travel of exactly the
    // threshold is still a right-click.
    return distance > SECONDARY_PAN_THRESHOLD;
}

/** Begin the pure state machine for one secondary-button press. */
export function beginSecondaryPress(owner, at) {
    return { kind: "pressed", owner, startScreen: at, currentScreen: at };
}

/** Advance the press state; only its owner can move it. */
export function moveSecondaryPress(state, owner, at) {
    if (state === null || state.owner !== owner) {
        return { state, startedPan: false, panStart: null };
    }
    const current = { ...state, currentScreen: at };
    if (state.kind === "pressed" && secondaryDragged(state.startScreen, at)) {
        return {
            state: { ...current, kind: "panning" },
            startedPan: true,
            panStart: at,
        };
    }
    return { state: current, startedPan: false, panStart: null };
}

/** Resolve release into a presentation intent, without performing the effect. */
export function finishSecondaryPress(state, owner) {
    if (state === null || state.owner !== owner) {
        return { matched: false, state, intent: null };
    }
    return {
        matched: true,
        state: null,
        intent: state.kind === "pressed"
            ? { kind: "open-menu", at: state.startScreen }
            : { kind: "finish-pan" },
    };
}

/** Cancellation discards only the session owned by the cancelled pointer. */
export function cancelSecondaryPress(state, owner) {
    return state !== null && state.owner === owner ? null : state;
}

/**
 * The cursor the canvas shows, or `null` to leave it to the active tool.
 *
 * `grabbing` while a pan is in flight and `grab` while space is held but nothing has
 * moved yet: the user needs to see that the gesture is armed *before* they drag, or
 * they will never find out it exists.
 *
 * @param {{ panning: boolean, spaceHeld: boolean }} state
 * @returns {string | null}
 */
export function panCursor({ panning, spaceHeld }) {
    if (panning) {
        return "grabbing";
    }
    return spaceHeld ? "grab" : null;
}
