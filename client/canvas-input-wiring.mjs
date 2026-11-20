// The canvas's input wiring: the wheel, the pointer, the browser's own menu, the resize,
// the pan key and the keyboard.
//
// # What this file is
//
// The listeners the page's entry point used to hold inline. They have one thing in
// common: each takes a browser event and hands it to the owner of the rule. The wheel
// goes to `wheelMove`, the pointer to the gesture pipeline, a key to the command
// registry. Nothing here decides what a gesture or a verb means; it only says whose
// event it is and what to do when the owner refuses.
//
// # What it is handed
//
// Everything the page owns arrives by name. The session is **not** one of them by value:
// a panic rebuilds the session and the page keeps using the new one, so the binder takes
// `currentSession` and every handler reads it when the event arrives. A handler that
// captured the session at bind time would keep driving a dead kernel. `menu` and
// `palette` are thunks for the same reason: they are bound after the page's first
// listeners, and the keyboard must see whichever is up when the key arrives.
// Every listener is registered with the mount's `signal`, so `destroy` releases it.
//
// # What it keeps
//
// The wheel's accumulator. Deltas that have not yet added up to a notch must survive
// between events, and nothing else reads them, so they live here.

import { wheelMove } from "./navigation.mjs";
import { commandForKey, commandState } from "./commands.mjs";
import { isPaletteToggle } from "./palette.mjs";
import { isControlTarget, isWidgetTarget } from "./key-scope.mjs";

/**
 * Put the canvas's input on the page.
 *
 * @param {object} deps what the page owns, by name.
 */
export function bindCanvasInput(deps) {
    const {
        canvas, window, lifecycle, ctx, currentSession, canvasRect, paint, statusLine,
        renderStatus, syncViewport, syncCursor, viewOnlyNow, pageState, runCommand,
        menu, palette, persistScheduler,
        onPointerDown, onPointerMove, onPointerUp, onPointerCancel,
        pendingGesture, liveMultipoint, isSpaceHeld, setSpaceHeld, pointerAt,
    } = deps;
    /**
     * Whether a keyboard event landed where a word is being typed.
     *
     * The browser's own answer is a class — `HTMLInputElement` — and the class
     * belongs to the browser: a page mounted over a document that is not the
     * browser's has no such class to ask. The DOM's own answer is the same
     * answer, spelled with what the document knows about itself: the tag of the
     * element, and whether it is editable. A shortcut that fires while the user
     * is typing eats the user's word, and that has to stay true wherever the
     * page is mounted.
     *
     * Tests may inject the predicate to isolate event routing; production uses
     * the DOM-shape check owned by this binder.
     *
     * @param {object | null | undefined} target the element the event landed on.
     * @returns {boolean} whether the keyboard belongs to the user here.
     */
    const isTextEntry = deps.isTextEntry ?? ((target) => {
        if (target === null || target === undefined) return false;
        const tag = target.tagName ?? "";
        return tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable === true;
    });
    // Wheel deltas waiting to add up to a notch. It has to survive between events, so
    // it lives here rather than in the listener below; it is deliberately not reset on
    // a pointerdown, because a user can zoom and then draw without lifting the wheel.
    let pendingWheel = 0;
    // The wheel. One notch per `WHEEL_THRESHOLD` of accumulated delta rather than per
    // event, because a trackpad sends a stream of small deltas and a mouse sends a
    // large one: without the accumulator the two devices zoom at wildly different
    // speeds through the same gesture.
    canvas.addEventListener(
        "wheel",
        (event) => {
            const session = currentSession();
            // The page must not scroll underneath the canvas: `preventDefault` is why
            // this listener is not passive, which is the only reason to ask for that.
            event.preventDefault();
            const { move, pending } = wheelMove(event, session.zoom(), pendingWheel);
            pendingWheel = pending;
            if (move === null) {
                return;
            }
            try {
                if ("dx" in move) {
                    session.pan(move.dx, move.dy);
                } else {
                    // The anchor is where the pointer was, not where the wheel
                    // event claims it is: upstream reads `viewport.lastPosition`
                    // because its updater runs after React flushed, by which
                    // time the pointer may have moved on (`App.wheel.ts:
                    // 130-133`). A wheel carries no pointermove, so the anchor
                    // is the last pointer the page remembered — the wheel event
                    // itself never writes it.
                    session.zoomAt(pointerAt.x, pointerAt.y, move.zoomTo);
                }
                paint(session, ctx);
            } catch (error) {
                statusLine.setProblem(`view failed: ${error.message ?? error}`);
                renderStatus();
            }
        },
        { passive: false, signal: lifecycle.signal },
    );
    // Re-paint on resize. The kernel culls on every paint, so a resize is a
    // `setViewportSize` and a `frame`; nothing else has to happen.
    window.addEventListener("resize", () => {
        const session = currentSession();
        const next = syncViewport(session);
        paint(session, next);
    }, { signal: lifecycle.signal });
    // Pointer events cover a click (selection), a translate drag, and a corner-anchored
    // resize in one path: the browser's `click` is a strict subset of "pointerdown +
    // pointerup with no movement". `setPointerCapture` keeps a drag that goes off-canvas
    // (second monitor, window edge) still receiving `pointermove` and `pointerup`, so a
    // translation that runs off-screen still commits.
    //
    // A move asks for a frame and `client/frame.mjs` collapses the asks that land inside
    // one, so a drag does not paint once per event.
    canvas.addEventListener("pointerdown", (event) => onPointerDown(event, currentSession(), ctx), { signal: lifecycle.signal });
    canvas.addEventListener("pointermove", (event) => {
        const session = currentSession();
        onPointerMove(event, session);
        if (pendingGesture() !== null || liveMultipoint() !== null) {
            paint(session, ctx);
        }
    }, { signal: lifecycle.signal });
    canvas.addEventListener("pointerup", (event) => onPointerUp(event, currentSession(), ctx), { signal: lifecycle.signal });
    // Cancellation is not a release, and it does not share a handler with one. The
    // browser took the pointer over — a palm rejection, a scroll that carried it off,
    // a system gesture — and no `pointerup` will follow. Routing both events to
    // `onPointerUp` made the difference a string comparison inside the commit logic,
    // and the gestures that remembered to check it were only two of the six.
    canvas.addEventListener("pointercancel", (event) => onPointerCancel(event, currentSession(), ctx), { signal: lifecycle.signal });
    // The end of a gesture asks for the save the gesture held back. These listeners
    // run after the ones above, so the gesture is already over when they ask.
    for (const ending of ["pointerup", "pointercancel"]) {
        canvas.addEventListener(ending, () => persistScheduler.resume(), { signal: lifecycle.signal });
    }
    // The native menu is always suppressed: the menu the user gets is the one this app
    // draws, opened by the client's own `pointerup` and not by this event, because the
    // native event arrives at a different moment on every platform. So the listener
    // does exactly one thing, and that thing is to stop the browser's own menu.
    canvas.addEventListener("contextmenu", (event) => event.preventDefault(), { signal: lifecycle.signal });
    // Space arms the pan. It is tracked on its own listener rather than inside the
    // keyboard handler below because it is not a command: it changes no state and maps
    // to nothing in the tool table, and a shortcut table that listed it would suggest it
    // does. The `preventDefault` is the other half — without it the browser scrolls the
    // page under the canvas while the user drags, which is the same gesture read twice
    // by two different owners.
    window.addEventListener("keydown", (event) => {
        // A text entry holding the focus owns the space: the character the
        // user is typing, not the pan's arm — and a `preventDefault` here
        // would take the character away before the editor ever saw it. The
        // dispatcher below carries the same guard for its own shortcuts.
        if (isTextEntry(event.target) || isControlTarget(event.target, event)) {
            return;
        }
        if (event.code !== "Space" || event.repeat || isSpaceHeld()) {
            return;
        }
        setSpaceHeld(true);
        event.preventDefault();
        syncCursor();
    }, { signal: lifecycle.signal });
    window.addEventListener("keyup", (event) => {
        if (event.code !== "Space" || !isSpaceHeld()) {
            return;
        }
        setSpaceHeld(false);
        syncCursor();
    }, { signal: lifecycle.signal });
    // A pan that ends with the window unfocused — alt-tab mid-drag — would otherwise keep
    // `grabbing` on the cursor forever, because no keyup ever arrives for a key the
    // browser never saw go down.
    window.addEventListener("blur", () => {
        if (isSpaceHeld()) {
            setSpaceHeld(false);
            syncCursor();
        }
    }, { signal: lifecycle.signal });

    // Keyboard shortcuts. This handler is a dispatcher, not an implementer: the registry
    // names the verb a key press means and `runCommand` runs it, the same door the menu
    // and the palette go through. `event.metaKey || event.ctrlKey` is the only piece of
    // platform knowledge: Mac's Command and everyone else's Control are one binding.
    window.addEventListener("keydown", (event) => {
        // A future change that wraps a Ctrl+Z listener higher up the
        // tree would otherwise be double-handled. Bail out the moment
        // somebody else has already claimed the event.
        if (event.defaultPrevented) {
            return;
        }
        // Typing in a text field is the one situation where the user
        // genuinely wants Backspace to delete a character. The canvas
        // has no inputs today, but a future contenteditable would land
        // the event on a different target and we do not want to delete
        // the selection on top of that.
        const target = event.target;
        if (isTextEntry(target)) {
            return;
        }
        // A tree, a dialog, a menu or a combobox owns Tab, the arrows, Space
        // and Enter while the focus is inside it. The canvas shortcuts must not
        // fire underneath, and a widget that lives in a shadow root is seen
        // through `composedPath`.
        if (isWidgetTarget(event)) {
            return;
        }
        // A menu that is open owns the keyboard. While it is up the arrows
        // walk it and `Escape` closes it, and the page's own shortcuts must
        // not fire underneath: a `v` that switched the tool while the user
        // was choosing "Copy" would be the menu's key and the page's
        // shortcut at the same time.
        const openMenu = menu();
        if (openMenu !== null && openMenu.isOpen()) {
            return;
        }
        // The palette is opened and closed by one gesture, and the gesture is
        // the page's own: the key the browser reserves for its command palette
        // never reaches a page, so the palette also answers to the same
        // gesture without the Shift.
        //
        // While the palette is up it owns the keyboard, and it claims the keys
        // it handles by cancelling the event — so this branch only ever runs
        // with the palette closed, and the palette's own handler answers the
        // same gesture when it is open.
        if (isPaletteToggle(event)) {
            event.preventDefault();
            const palettePanel = palette();
            if (palettePanel !== null) {
                if (palettePanel.isOpen()) {
                    palettePanel.close();
                } else {
                    palettePanel.open();
                }
            }
            return;
        }
        // The registry answers the rest.
        //
        // The state is asked for here and is *lazy*: the registry reads it
        // only for the one verb whose key needs the document to disambiguate
        // it, so a key press that names nothing reads nothing at all.
        const session = currentSession();
        const command = commandForKey(event, commandState(session, viewOnlyNow, pageState));
        if (command === null) {
            return;
        }
        // We own every one of these shortcuts. Browsers also have ideas
        // about Cmd+Z (undo input), Cmd+D (bookmark), Cmd+[ / Cmd+]
        // (history navigation in some shells), and the user can forget
        // the canvas is focused. Stopping the event is the cheaper and
        // clearer answer than a confirmation dialog.
        event.preventDefault();
        // The registry named a verb and this handler runs it. The bodies live in
        // `runCommand` and the menu reaches them through the same door — so a
        // verb cannot do one thing from the keyboard and another from the menu.
        runCommand(command, session, ctx);
    }, { signal: lifecycle.signal });
}
