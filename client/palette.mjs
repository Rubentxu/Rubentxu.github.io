// The command palette: a view of the command registry.
//
// # What this file is
//
// The third view of the same registry the keyboard and the context menu read.
// The palette asks the registry which verbs the document can honour right
// now, narrows them by what the user typed, and runs the one that is chosen —
// through the same door the other two affordances use, so a verb cannot do
// one thing from the keyboard and another from the palette.
//
// # Why the palette shows exactly what the menu shows
//
// Because they are the same question. The menu asks the registry "what can
// this document do?" and draws the answer; the palette asks the very same
// question and draws the answer in a search box.
//
// A palette that showed *more* would be holding a second opinion about the
// document, and a second opinion is a second source of truth — the thing a
// single registry exists to end. A verb the document cannot honour right now
// is not in the palette, exactly as it is not in the menu.
//
// The price is worth naming. A verb that acts on the selection is not in the
// palette while nothing is selected, so a user who has not drawn anything yet
// cannot learn by looking that "Duplicate" exists. The menu has the same
// property, and there it is right: a menu is *about* the document — it opens
// on the document and shows the document's powers. The palette inherits that,
// and it inherits it on purpose.
//
// # The way out of a locked element is still one keystroke away
//
// A locked element cannot be selected — the hit test never finds one — so a
// verb that acts only on the selection cannot unlock it. The way out is the
// verb that acts on the scene, and that verb is available exactly when
// something is locked. So the palette lists it whenever something is locked:
// the locked elements are the ones that nothing else can reach.
//
// # Why the palette groups results
//
// The query still ranks commands, while headings collect each result group so
// related actions can be scanned together without changing availability.
//
// # What the keyboard owns while the palette is open
//
// The palette takes the keyboard while it is up, the way the context menu
// does. The page's own shortcuts must not fire underneath it: a `v` that
// switched the tool while the user was typing "v" to filter would be the
// palette's letter and the page's shortcut at the same time.
//
// The palette claims the keys it handles by cancelling the event, and the
// page's keyboard handler stands down for an event somebody else has already
// claimed. That is the same rule the rest of the page follows, and it means
// the palette needs no special case in the page's handler at all.
//
// # Why the outside click is a listener that only exists while the palette is open
//
// The listener is added when the palette opens and removed when it closes, so
// a page with no palette open has no listener on it at all. A permanent
// listener that checked whether the palette is open would be a listener that
// runs on every pointer press of the page forever, for a palette that is
// closed ninety-nine per cent of the time.

import { searchCommands } from "./commands.mjs";
import { matchesKey } from "./keys.mjs";

/**
 * The keys that open and close the palette.
 *
 * Two, because the obvious one belongs to the browser: `Ctrl+Shift+P` is the
 * browser's own command palette, and a browser that reserves it never hands
 * the key to the page at all — the palette would be unreachable on every
 * platform that takes it. The second is the same gesture without the Shift,
 * and it reaches the page everywhere.
 */
const TOGGLE_KEYS = Object.freeze([
    { key: "p", mod: true, shift: true },
    { key: "/", mod: true },
]);

/**
 * Is this key press the gesture that opens or closes the palette?
 *
 * @param {KeyboardEvent} event The press.
 * @returns {boolean}
 */
export function isPaletteToggle(event) {
    return TOGGLE_KEYS.some((spec) => matchesKey(event, spec));
}

/**
 * The palette, bound to its parts.
 *
 * The container, the field and the list are three separate elements because
 * they are three separate things: the container is the layer that covers the
 * page, the field is what the user types into, and the list is what the
 * registry's verbs are drawn into. They are injected rather than reached for
 * so that the palette can be exercised without a browser.
 *
 * `readState` is a function because the answer changes: the palette asks for
 * the document's state when it opens and again whenever the query changes,
 * and it asks once per render so that a verb which reads the selection does
 * not read it sixteen times.
 *
 * @param {{
 *     root: Element,
 *     input: Element,
 *     list: Element,
 *     createElement: (tag: string) => Element,
 *     doc: Document,
 *     run: (id: string) => void,
 *     readState: () => object,
 *     labelOf?: (command: object) => string,
 *     emptyText?: string,
 *     signal?: AbortSignal,
 * }} options
 * `signal` ends the palette: its abort closes it and takes every listener it put on the page off.
 *
 * @returns {{ open: () => void, close: () => void, isOpen: () => boolean }}
 */
export function bindPalette({
    root,
    input,
    list,
    createElement,
    doc,
    run,
    readState,
    labelOf = (command) => command.label,
    emptyText = "No matching command",
    signal,
}) {
    /** The verbs on screen, in order. Every one of them can be run. */
    let rows = [];
    /** Which of the rows the keyboard is on, or `-1` when there is none. */
    let current = -1;
    let open = false;
    /** Where the focus was when the palette opened, so that it can go back. */
    let restoreFocusTo = null;

    /**
     * A pointer press outside the palette closes it.
     *
     * Capture, because a press that lands on the page under the palette has
     * to close it before the page acts on it: without the capture the canvas
     * would draw a stroke and the palette would close over it.
     */
    function onOutsidePointerDown(event) {
        if (root.contains(event.target)) {
            return;
        }
        close();
    }

    /**
     * Close the palette and give the focus back to wherever it came from.
     */
    function close() {
        if (!open) {
            return;
        }
        open = false;
        doc.removeEventListener("pointerdown", onOutsidePointerDown, true);
        // The field lets go of the focus before anything else happens.
        //
        // Hiding a field does not take the focus away from it, and a field
        // that keeps a focus it cannot show is a trap: the page's shortcuts
        // stand down for a field, so the keystroke that follows the close
        // would be swallowed by an input the user cannot even see. The
        // browser only sorts the focus out on its own, a frame later, and
        // a frame is long enough to lose a key.
        if (doc.activeElement === input) {
            input.blur();
        }
        root.hidden = true;
        list.replaceChildren();
        rows = [];
        current = -1;
        input.value = "";
        const previous = restoreFocusTo;
        restoreFocusTo = null;
        if (previous !== null && typeof previous.focus === "function") {
            previous.focus();
        }
    }

    /**
     * Move the highlight by `step` rows, wrapping around.
     *
     * Every row is a verb the document can honour, so the walk never lands on
     * a row that would do nothing.
     */
    function move(step) {
        if (rows.length === 0) {
            return;
        }
        current = (current + step + rows.length) % rows.length;
        highlight();
    }

    /**
     * Mark the highlighted row, and tell the field which one it is.
     *
     * The field carries the name of the highlighted row because the focus
     * stays in the field: the user is typing, and taking the focus away to
     * walk a list would stop the typing. The link between the two is what a
     * reader follows to find out which of the rows is the current one.
     */
    function highlight() {
        for (const node of rows) {
            const selected = node === rows[current];
            node.setAttribute("aria-selected", selected ? "true" : "false");
        }
        const active = rows[current];
        if (active === undefined) {
            input.removeAttribute("aria-activedescendant");
            return;
        }
        input.setAttribute("aria-activedescendant", active.id);
    }

    /**
     * Run the highlighted verb, if there is one.
     */
    function runCurrent() {
        const active = rows[current];
        if (active === undefined) {
            return;
        }
        close();
        run(active.dataset.command);
    }

    root.addEventListener("keydown", (event) => {
        if (isPaletteToggle(event)) {
            // The gesture that opens the palette also closes it, and the
            // slash is not typed into the field on the way.
            event.preventDefault();
            event.stopPropagation();
            close();
            return;
        }
        if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            close();
            return;
        }
        if (event.key === "ArrowDown") {
            event.preventDefault();
            event.stopPropagation();
            move(1);
            return;
        }
        if (event.key === "ArrowUp") {
            event.preventDefault();
            event.stopPropagation();
            move(-1);
            return;
        }
        if (event.key === "Home") {
            // The two ends of the list, in one keystroke each. A list the
            // user cannot jump to either end of is a list they have to walk.
            event.preventDefault();
            event.stopPropagation();
            current = 0;
            highlight();
            return;
        }
        if (event.key === "End") {
            event.preventDefault();
            event.stopPropagation();
            current = rows.length - 1;
            highlight();
            return;
        }
        if (event.key === "Enter") {
            event.preventDefault();
            event.stopPropagation();
            runCurrent();
        }
    }, { signal });

    input.addEventListener("input", () => {
        render(input.value);
    }, { signal });
    signal?.addEventListener("abort", close, { once: true });

    /**
     * Draw the verbs the query names, among those the document can honour.
     *
     * The registry answers both questions at once — which verbs exist for
     * this document, and which of them the query names — so there is no
     * second opinion here to reconcile.
     *
     * @param {string} query What the user typed.
     */
    function render(query) {
        const state = readState();
        const available = searchCommands("", state, labelOf);
        const commands = searchCommands(query, state, labelOf);
        const built = [];
        const drawn = [];
        if (commands.length === 0) {
            built.push(empty(createElement, emptyText));
        }
        const grouped = new Map();
        for (const command of commands.length === 0 ? suggestionsByGroup(available) : commands) {
            const group = command.group ?? "other";
            if (!grouped.has(group)) {
                grouped.set(group, []);
            }
            grouped.get(group).push(command);
        }
        for (const [group, members] of grouped) {
            const heading = createElement("li");
            heading.className = "palette-category";
            heading.setAttribute("role", "presentation");
            heading.textContent = groupLabel(group);
            built.push(heading);
            for (const command of members) {
                const node = entry(createElement, command, drawn.length, run, close, labelOf(command), signal);
                built.push(node);
                drawn.push(node);
            }
        }
        list.replaceChildren(...built);
        rows = drawn;
        current = rows.length > 0 ? 0 : -1;
        highlight();
    }

    /**
     * Open the palette on the verbs the document can honour.
     */
    function openPalette() {
        // An open palette is replaced by the new one rather than stacked on
        // it: two palettes at once is not a thing the user can have meant.
        close();
        rows = [];
        current = -1;
        input.value = "";
        render("");
        root.hidden = false;
        open = true;
        restoreFocusTo = doc.activeElement;
        doc.addEventListener("pointerdown", onOutsidePointerDown, { capture: true, signal });
        input.focus();
    }

    return {
        open: openPalette,
        close,
        isOpen: () => open,
    };
}

/**
 * One verb, as a row of the list.
 *
 * The label and the shortcut are two elements rather than one string, so that
 * the shortcut can sit at the other end of the row without a layout table:
 * `span` for the verb and `kbd` for the key, in a row that puts them apart.
 *
 * A row that is in the list is a row that can be run, so the click has
 * nothing to check.
 *
 * @param {(tag: string) => Element} createElement
 * @param {object} command The verb.
 * @param {number} position Where the row sits in the list.
 * @param {(id: string) => void} run What to call when it is chosen.
 * @param {() => void} close How the palette goes away.
 * @param {AbortSignal} [signal] Its abort takes the row's listener off.
 * @returns {Element}
 */
function entry(createElement, command, position, run, close, text, signal) {
    const row = createElement("li");
    row.setAttribute("role", "option");
    row.setAttribute("aria-selected", "false");
    row.id = `palette-option-${position}`;
    row.dataset.command = command.id;
    const label = createElement("span");
    label.textContent = text;
    const hint = createElement("kbd");
    hint.textContent = command.hint;
    row.appendChild(label);
    row.appendChild(hint);
    row.addEventListener("click", () => {
        close();
        run(command.id);
    }, { signal });
    return row;
}

/**
 * The row that says nothing matched.
 *
 * @param {(tag: string) => Element} createElement
 * @returns {Element}
 */
function empty(createElement, text) {
    const row = createElement("li");
    row.setAttribute("role", "presentation");
    row.className = "palette-empty";
    row.textContent = text;
    return row;
}

function suggestionsByGroup(commands) {
    const firstByGroup = new Map();
    for (const command of commands) {
        if (!firstByGroup.has(command.group)) {
            firstByGroup.set(command.group, command);
        }
    }
    return [...firstByGroup.values()];
}

function groupLabel(group) {
    return group.replace(/[-_]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
