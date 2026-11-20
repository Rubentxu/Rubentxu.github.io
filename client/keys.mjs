// How a shortcut is written down, and how a key press is read against it.
//
// # Why this file exists
//
// The client used to spell its shortcuts in three different ways at once:
// `event.key` compared against a lowercase letter in one place,
// `event.key.toLowerCase()` in another, and a literal `"l"` with a hand-written
// modifier test in a third. Three spellings of one question are three answers
// waiting to disagree — and they already did.
//
// The commands whose letter Shift capitalises never fired. The reference
// editor compares the pressed key against the *capital* letter, while the
// client compared it against the *lowercase* one. Under Shift the browser
// reports `"G"`, so the comparison never matched and the shortcut was dead.
// The same held for select-all and for both ends of the bracket pair, where
// `Shift+]` types `"}"` and the client was looking for `"]"`.
//
// So there is one spelling now, and one place that reads it. A shortcut is a
// descriptor:
//
//     { key: "g", mod: true, shift: true }        // by the character it types
//     { code: "BracketRight", mod: true }          // by the physical key it sits on
//
// `mod` is the platform's "the command modifier" — `Cmd` on a Mac, `Ctrl`
// everywhere else — and the client treats the two as the same key on purpose:
// one binding covers both, and nobody has to know which one their keyboard
// has.
//
// # The rule that makes a descriptor mean something
//
// **A modifier that is not written down is not pressed.** `Ctrl+Shift+L` does
// not mean "Ctrl+L, and Shift happens to be there too": it means exactly that
// combination and no other.
//
// Without the rule, every reader decides for itself which modifiers matter,
// and the readers disagree. `Alt+Shift+H` was both a mirror of the selection
// and an alignment to the centre — the flip read the letter and ignored
// `Alt`, and the alignment read `Alt+Shift` and ignored the fact that the flip
// had already claimed the key. One keystroke, two commands, and the second one
// was unreachable because the first one had swallowed it.
//
// The rule is also what keeps `Shift+V` a mirror rather than a mirror *and* a
// tool switch: a tool is only reached when Shift is absent.

/**
 * The key itself, by character or by physical key.
 *
 * Two ways to name a key, and the difference between them is the layout. The
 * bracket pair is named by its *code* — `BracketRight` — because the character
 * it types depends on Shift and on the keyboard's layout: `]` on a US layout,
 * `}` under Shift, and something else entirely on a French one. The code names
 * the key itself; the character is what the layout produces from it.
 *
 * The letters are named by their character instead, and compared in lower case,
 * so that a user with CapsLock on still reaches the shortcut.
 *
 * @param {KeyboardEvent} event
 * @param {{ key?: string | string[], code?: string }} spec
 * @returns {boolean}
 */
import { isControlTarget } from "./key-scope.mjs";

function matchesTheKey(event, spec) {
    if (spec.code !== undefined) {
        return event.code === spec.code;
    }
    if (spec.key === undefined) {
        return false;
    }
    const pressed = typeof event.key === "string" ? event.key.toLowerCase() : "";
    const wanted = Array.isArray(spec.key) ? spec.key : [spec.key];
    return wanted.some((key) => key.toLowerCase() === pressed);
}

/**
 * The modifiers, and the rule that binds them.
 *
 * Each modifier is compared as a *pair of claims*: the descriptor says whether
 * it is pressed, the event says whether it is, and the two have to agree. A
 * descriptor that says nothing about Shift and a press that carries Shift
 * disagree, and the press is not the one the descriptor named.
 *
 * @param {KeyboardEvent} event
 * @param {{ mod?: boolean, shift?: boolean, alt?: boolean }} spec
 * @returns {boolean}
 */
function matchesTheModifiers(event, spec) {
    const mod = event.metaKey === true || event.ctrlKey === true;
    if ((spec.mod === true) !== mod) {
        return false;
    }
    if ((spec.shift === true) !== (event.shiftKey === true)) {
        return false;
    }
    if ((spec.alt === true) !== (event.altKey === true)) {
        return false;
    }
    return true;
}

/**
 * Does this key press name this shortcut?
 *
 * @param {KeyboardEvent} event The press.
 * @param {{ key?: string | string[], code?: string, mod?: boolean, shift?: boolean, alt?: boolean }} spec
 * @returns {boolean} Whether the press is the shortcut.
 */
export function matchesKey(event, spec) {
    // A verb without a shortcut claims no press: the undefined descriptor is
    // the answer "this verb is not on the keyboard", which is a fact about the
    // verb and not an error about the event.
    if (spec === undefined) {
        return false;
    }
    return matchesTheKey(event, spec) && matchesTheModifiers(event, spec);
}

/**
 * How a shortcut is written on a menu, a tooltip or a line of help.
 *
 * The label is derived from the descriptor rather than written beside it: a
 * table that holds both the shortcut and its spelling has two places to keep in
 * step, and the second one is the one nobody remembers.
 *
 * `Ctrl` is the spelling rather than `Cmd` because the client answers to
 * either, and the toolbar's own tooltips already say `Ctrl+` (`index.html`).
 * On a Mac the same key is `Cmd`, and the binding is the same one.
 *
 * @param {{ key?: string | string[], code?: string, mod?: boolean, shift?: boolean, alt?: boolean }} spec
 * @returns {string}
 */
export function spellKey(spec) {
    // A verb can reach the menus without a shortcut — the link verbs answer
    // through the menu and the editor alone — and a verb without a key has no
    // spelling: the empty string, not a crash on the first field of nothing.
    if (spec === undefined) {
        return "";
    }
    const parts = [];
    if (spec.mod === true) {
        parts.push("Ctrl");
    }
    if (spec.shift === true) {
        parts.push("Shift");
    }
    if (spec.alt === true) {
        parts.push("Alt");
    }
    parts.push(keyLabel(spec));
    return parts.join("+");
}

/**
 * Every name the key of a shortcut answers to.
 *
 * Most keys have one name. A key that answers to two — `Delete` and
 * `Backspace` are two keys for the same verb — answers to both, and the first
 * of them is the one that is written on screen.
 *
 * @param {{ key?: string | string[], code?: string }} spec
 * @returns {string[]} The names, as they are written.
 */
function keyNames(spec) {
    if (spec.code !== undefined) {
        return [CODE_LABELS[spec.code] ?? spec.code];
    }
    const key = Array.isArray(spec.key) ? spec.key : [spec.key];
    return key.filter((name) => typeof name === "string" && name.length > 0);
}

/**
 * The label of the key itself, without its modifiers.
 *
 * A single character is shown in upper case, because a shortcut written
 * `Ctrl+x` reads like a typo; a name is shown as it is, because `Delete` and
 * `Backspace` are already written the way the keyboard writes them.
 *
 * @param {{ key?: string | string[], code?: string }} spec
 * @returns {string}
 */
function keyLabel(spec) {
    const key = keyNames(spec)[0];
    if (key === undefined) {
        return "";
    }
    return key.length === 1 ? key.toUpperCase() : key;
}

/**
 * How a physical key is written when it is named by its code.
 *
 * Only the two the client uses. A code nobody has a name for is shown as the
 * code itself, which is a worse label than the right one and still a true one.
 */
const CODE_LABELS = Object.freeze({
    BracketLeft: "[",
    BracketRight: "]",
});

/**
 * Does a typed query name this shortcut?
 *
 * The query is compared against the shortcut *as it is written on screen*, so
 * that what the user reads beside a verb and what the user types are the same
 * string.
 *
 * The `+` is what tells the two questions apart:
 *
 * - A query that carries a `+` is naming the whole shortcut, and it has to
 *   match it exactly. `Ctrl+Shift+]` and `Ctrl+]` are two different
 *   combinations, and a query that matched either of them loosely would answer
 *   for both.
 * - A query without a `+` is naming the key alone, and it matches the key by
 *   its beginning: `]` finds the key that ends the bracket pair, `del` finds
 *   `Delete`, and `back` finds the same verb by the other key it answers to.
 *
 * The first rule is strict and the second is loose on purpose. A combination
 * has exactly one name and the name has to be the whole of it; a key has a
 * long name and nobody remembers whether it is `Delete` or `Backspace`.
 *
 * @param {string} query What the user typed, already trimmed and lower-cased.
 * @param {{ key?: string | string[], code?: string, mod?: boolean, shift?: boolean, alt?: boolean }} spec
 * @returns {boolean}
 */
export function queryNamesShortcut(query, spec) {
    // A verb with no shortcut (the link verbs) is named by no key: the palette asks
    // this of every candidate whose label did not answer, so it must not crash on them.
    if (spec === undefined || query.length === 0) {
        return false;
    }
    if (query.includes("+")) {
        return spellKey(spec).toLowerCase() === query;
    }
    return keyNames(spec).some((name) => name.toLowerCase().startsWith(query));
}

/**
 * Whether a press landed on a control the browser moves focus through: a button, a
 * select, a link, a field or an editable region. The keys the page reads for itself
 * (Tab above all) are the browser's there, and claiming them would make the control
 * unreachable without a mouse.
 *
 * @param {object | null | undefined} target The element the press landed on.
 * @returns {boolean}
 */
export function isOnControl(target) {
    // The native controls and the ARIA widgets alike: a role=tree owns Tab as
    // much as a button does, and the scope is asked in one place
    // (`client/key-scope.mjs`) so the two cannot disagree.
    return isControlTarget(target);
}
