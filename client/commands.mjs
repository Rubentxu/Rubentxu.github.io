// The vocabulary of commands: the one place a verb is named.
//
// # What this file is
//
// The reference editor keeps its actions in one registry, and every affordance
// is a *view* of it. The keyboard filters the registry by key and runs the one
// that matches; the context menu filters it by predicate and draws the ones
// that are available; the palette filters it by the same predicate and narrows
// the result by typing. Three affordances, one registry, and the registry is
// the only place an action's name is written.
//
// NextDraw had the opposite: a chain of `if` statements in the keydown handler
// that spelled out twenty shortcuts, and no menu at all. This file is the
// registry, and it is what the keyboard, the menu and the palette will read.
//
// # The two filters, and why they are not one
//
// A command carries two questions, and they are kept apart on purpose:
//
// - `match(event, state)` — *which key is this?* The keyboard asks it, and it
//   never consults the document: `Ctrl+V` is `Ctrl+V` whether or not the
//   clipboard is empty.
// - `available(state)` — *may this happen right now?* The menu asks it, and it
//   is the document's answer.
//
// They are apart for a reason that is visible in the reference editor's own
// code: the keyboard runs its key test over *every* registered action and
// refuses to run when more than one matches. If the predicate were folded into
// the key test, an action that is unavailable would simply stop being a
// shortcut — and the user would lose a key they had learned, rather than press
// it and see that it had nothing to do.
//
// # The one key that names two verbs
//
// `Ctrl+Shift+L` locks the selection, and it is the way back out of a locked
// element when nothing is selected.
//
// The reference editor reaches the second one through a command palette rather
// than through a shortcut, because a locked element cannot be selected and so
// the toggle could never unlock anything.
//
// The palette is the third view of this registry, and it asks the same question
// the menu asks — *may this happen right now?* — so it offers exactly the
// verbs the document can honour, and none of the others. The way out of a
// locked element stays one keystroke away anyway: the verb that unlocks is
// offered whenever something is locked, and a locked element can never be
// selected, so there is nothing to select and no verb to unlock.
//
// So the registry holds both, with the *same* key, and the state decides which
// one the press names: `lock` claims the key when something is selected and
// `unlockAll` claims it when nothing is. They never both claim it, which is
// what keeps the "exactly one match" rule above true.
//
// # The menu this registry describes
//
// Two menus: the canvas one, for the document, and the element one, for the
// selection.
//
// The canvas menu is `Paste`, `Select all`, `Unlock all` and the three
// presentation verbs (`Zen mode`, `View mode`, `Stats`) — the verbs that act
// on the document or on the page itself rather than on a selection. The element menu
// is the verbs that act on what is selected: `Cut`, `Copy`, `Duplicate`,
// `Group`, `Ungroup`, the four z-order moves, the two mirrors, `Lock` and
// `Delete`.
//
// # The ids are the kernel's words where the kernel has one
//
// The four z-order verbs are named `front`, `back`, `forward` and `backward`
// because that is the vocabulary the kernel already speaks: `reorderAll` takes
// exactly those four words. Naming the commands `bringToFront` and
// `sendToBack` would have read better at the call site and would have needed a
// table to turn them back into the four words the kernel understands — a
// second list, in a file whose whole purpose is to be the only list.
//
// The labels carry the human phrasing, which is where it belongs: the menu
// says "Bring to front" and the keyboard says `Ctrl+Shift+]`. And the four
// words are not two pairs of near-synonyms but two different questions: `front`
// and `back` are the ends of the stack, `forward` and `backward` are one step.
//
// Two deliberate divergences from the reference editor:
//
// - **`Paste` is only in the canvas menu.** The reference editor offers it in
//   both. The element menu here is the menu of the *selection*, and pasting
//   does not act on the selection — it acts on the clipboard — so offering it
//   twice would offer the same verb in two menus that mean different things.
// - **`Unlock all` shows whenever something is locked.** The reference editor
//   asks for "nothing is selected and something is locked". Here the canvas
//   menu is the only door out of a locked element, because the hit test cannot
//   reach one — a locked element absorbs the click and is therefore never
//   found — so a predicate that also required an empty selection would leave a
//   user with a selection and a locked element with no way to unlock it.

import { isOnControl, matchesKey, queryNamesShortcut, spellKey } from "./keys.mjs";
import { linearPointsEditable } from "./vertex-edit.mjs";
import { viewKeyAction } from "./navigation.mjs";
import { ALIGN_SHORTCUT_KEYS, TOOL_NUMBER_ALIASES, TOOL_SHORTCUT_KEYS, alignOpFor, toolForShortcut } from "./tools.mjs";

/** The user-facing tool labels and gesture guidance attached to tool commands. */
export function buttonText(tool) {
    return tool.charAt(0).toUpperCase() + tool.slice(1);
}

export const TOOL_HOWS = Object.freeze({
    select: "click to select elements, then drag to move them",
    pan: "click to select, then drag on the canvas to move the view",
    place: "click to select, then click the canvas to place a label",
    erase: "click to select, then drag on the canvas to erase",
    point: "click to select, then drag on the canvas to point — the trail fades and nothing is drawn",
    draw: "click to select, then drag on the canvas to draw",
});

export function howOf(tool) {
    return tool === "hand"
        ? "pan"
        : tool === "selection"
            ? "select"
        : tool === "text"
            ? "place"
            : tool === "eraser"
                ? "erase"
                : tool === "laser"
                    ? "point"
                    : "draw";
}

/**
 * The view gestures, each with the key its menu-less verb is written under.
 *
 * `viewKeyAction` is the only reader of the press (the digit comes from `code` first,
 * because what Shift+1 types depends on the layout, and `+` needs Shift on some layouts),
 * so the verbs ask it rather than spell the layout again; the descriptor is the
 * representative spelling, for the hint and for the uniqueness check.
 */
const VIEW_KEYS = Object.freeze([
    ["zoom-in", { key: "+", mod: true }],
    ["zoom-out", { key: "-", mod: true }],
    ["zoom-reset", { key: "0", mod: true }],
    ["fit-content", { key: "!", shift: true }],
    ["fit-selection", { key: "@", shift: true }],
]);

/** The id of the verb that moves the view the way a gesture names. */
const viewVerbId = (action) => `view:${action}`;

/**
 * The view gesture a view verb names (`"zoom-in"`, `"fit-content"`, ...), or `null` for a
 * verb that is not one.
 *
 * @param {string} id The verb's name.
 * @returns {string | null}
 */
export function viewActionOf(id) {
    return VIEW_KEYS.find(([action]) => viewVerbId(action) === id)?.[0] ?? null;
}

/** The id of the verb that arms the tool a letter names; the id carries the letter. */
const toolVerbId = (key) => `tool:${key}`;
/** The id of the verb that aligns the selection the way a key names. */
const alignVerbId = (key) => `align:${key}`;
/** The id of the verb that walks the flowchart the way an arrow names. */
const flowchartVerbId = (direction) => `flowchart:${direction}`;

/** The directions a flowchart walk can take, the words the kernel takes. */
export const FLOWCHART_DIRECTIONS = Object.freeze(["left", "right", "up", "down"]);

/** The arrow key each direction rides on; the same table the nudge verbs read. */
const FLOWCHART_KEYS = Object.freeze({
    left: "ArrowLeft",
    right: "ArrowRight",
    up: "ArrowUp",
    down: "ArrowDown",
});

/**
 * The key a tool verb was made from, or `null` for a verb that is not one.
 *
 * @param {string} id The verb's name.
 * @returns {string | null}
 */
export function toolKeyOf(id) {
    return TOOL_SHORTCUT_KEYS.find((key) => toolVerbId(key) === id) ?? null;
}

/**
 * The alignment an align verb names (`{ axis, mode }`, the words the kernel takes),
 * or `null` for a verb that is not one.
 *
 * @param {string} id The verb's name.
 * @returns {{ axis: string, mode: string } | null}
 */
export function alignOf(id) {
    const key = ALIGN_SHORTCUT_KEYS.find((candidate) => alignVerbId(candidate) === id);
    return key === undefined ? null : alignOpFor(key);
}

/**
 * The direction a flowchart verb names, or `null` for a verb that is not one.
 *
 * @param {string} id The verb's name.
 * @returns {string | null} One of the words of {@link FLOWCHART_DIRECTIONS}.
 */
export function flowchartDirectionOf(id) {
    return FLOWCHART_DIRECTIONS.find((candidate) => flowchartVerbId(candidate) === id) ?? null;
}

/** The three contexts the registry describes. */
export const MENUS = Object.freeze({
    canvas: "canvas",
    element: "element",
    // The menu of more than one selected element. Upstream does not have a
    // fifth list for it: the same element actions are filtered by their
    // predicates, and `group` is the one that appears only here. The context
    // is named so that the menu can be read — and tested — on its own, and
    // `menuSections` derives it from `selectionCount`.
    selection: "selection",
});

/** One run of rows between two separators. */
function menuSection(group, ids) {
    return Object.freeze({ group, commands: Object.freeze(ids) });
}

/**
 * The context menu's rows, per context, in upstream's order.
 *
 * Upstream builds the menu literally, one `CONTEXT_MENU_SEPARATOR` between
 * groups (`App.tsx`, `getContextMenuItems`: the canvas list and the element
 * list), so the separators are part of the layout rather than derived from a
 * group label. This table is that shape: a row names a command of the
 * registry, and `menuSections` keeps the ones whose predicate accepts the
 * document. A row the port has no command for is simply absent — upstream has
 * frame-children, bound-text, element-link-copy and linear-editor actions, and
 * this port has no functions behind them, so no row is invented for them.
 *
 * The order is the reference's:
 *
 * - canvas: Paste · Copy as PNG, Copy as SVG · Select all, Unlock all ·
 *   Grid, Snap, Arrow binding, Midpoint, Zen, View, Stats;
 * - element: Cut, Copy, Paste · Frame · Crop · PNG, SVG · Styles · Group,
 *   Auto-resize, Ungroup · Z-order · Flip · Link · Duplicate, Lock · Delete.
 *
 * `selection` repeats the element list with `group` in its section: upstream
 * offers grouping only when at least two elements are selected, and the
 * predicate cannot know the count without the layout saying which context it
 * is in.
 *
 * The context menu draws no icons because upstream's does not: the rows are
 * a label and a `<kbd>` (`components/ContextMenu.tsx`).
 */
export const CONTEXT_MENUS = Object.freeze({
    canvas: Object.freeze([
        menuSection("clipboard", ["paste"]),
        menuSection("export", ["copyPng", "copySvg"]),
        menuSection("selection", ["selectAll", "unlockAll"]),
        menuSection("view", [
            "toggleGrid",
            "toggleSnap",
            "toggleArrowBinding",
            "toggleMidpoint",
            "zenMode",
            "viewMode",
            "stats",
        ]),
    ]),
    element: Object.freeze([
        menuSection("clipboard", ["cut", "copy", "paste"]),
        menuSection("frame", ["toggleWrap"]),
        menuSection("image", ["cropArm"]),
        menuSection("export", ["copyPng", "copySvg"]),
        menuSection("style", ["copyStyles", "pasteStyles"]),
        menuSection("group", ["enableTextAutoResize", "ungroup"]),
        menuSection("arrange", ["backward", "forward", "back", "front"]),
        menuSection("transform", ["flipHorizontal", "flipVertical"]),
        // The link section carries the three verbs the registry gives the
        // element menu: open and remove answer a link that is there (their
        // predicates ask `hasLink`), and edit is the sheet the keyboard's
        // Ctrl+K reaches too (`actionLink.tsx`). The layout without the two
        // was a trim the registry's own rows contradict: a verb the menu
        // names as its home cannot be missing from it.
        menuSection("link", ["openLink", "editLink", "removeLink"]),
        menuSection("lifecycle", ["duplicate", "lock"]),
        menuSection("delete", ["delete"]),
    ]),
    selection: Object.freeze([
        menuSection("clipboard", ["cut", "copy", "paste"]),
        menuSection("frame", ["toggleWrap"]),
        menuSection("image", ["cropArm"]),
        menuSection("export", ["copyPng", "copySvg"]),
        menuSection("style", ["copyStyles", "pasteStyles"]),
        menuSection("group", ["group", "enableTextAutoResize", "ungroup"]),
        menuSection("arrange", ["backward", "forward", "back", "front"]),
        menuSection("transform", ["flipHorizontal", "flipVertical"]),
        // Upstream's link action needs exactly one selected element
        // (`actionLink.tsx`: `selectedElements.length === 1`), so the
        // multiple-selection list has no Link section at all.
        menuSection("lifecycle", ["duplicate", "lock"]),
        menuSection("delete", ["delete"]),
    ]),
});

/**
 * The verbs that leave the document as it was.
 *
 * It is a list of what is **safe**, not of what is dangerous: a verb added to the
 * registry edits unless it is named here, so forgetting to classify a new verb
 * blocks it in view mode instead of letting it through. View mode is a promise
 * that nothing changes, and a promise is kept by the default, not by remembering.
 */
export const READ_ONLY_COMMANDS = Object.freeze(
    new Set([
        "selectAll",
        "saveLibrary",
        // A copy leaves the drawing as it was: the picture goes to the system's clipboard.
        "copyPng",
        "copySvg",
        "zenMode",
        "viewMode",
        "toggleTheme",
        "toggleGrid",
        "toggleSnap",
        "toggleMidpoint",
        "stats",
        "help",
        // Opening the panel changes nothing; the panel refuses its own insertions in view mode.
        "library",
        "copy",
        "copyStyles",
        "showStrokeColour",
        "showBackgroundColour",
        "showFontFamily",
        "openLink",
        // The flowchart walk moves the selection to the neighbouring node and no
        // element: the selection is the page's, not the drawing's.
        ...FLOWCHART_DIRECTIONS.map(flowchartVerbId),
        // Arming a tool changes what the next press will do and nothing in the drawing.
        ...TOOL_SHORTCUT_KEYS.map(toolVerbId),
        // The lock is the page's like the tool is: it changes what the next
        // creation will do and no element.
        "toggleToolLock",
        // Dropping the selection moves no element, and neither does Escape's walk home
        // to the selection tool: the selection and the tool are the page's, not the drawing's.
        "clearSelection",
        "escape",
        "cropExit",
        "cropArm",
        "statsClose",
        // Zooming and fitting move the view and nothing in the drawing.
        ...VIEW_KEYS.map(([action]) => viewVerbId(action)),
    ]),
);

/**
 * Whether a verb edits the document, by its id.
 *
 * @param {string} id The verb's name.
 * @returns {boolean}
 */
export function commandEdits(id) {
    return !READ_ONLY_COMMANDS.has(id);
}

/**
 * One command.
 *
 * The factory exists so that every command has the same shape and none of
 * them can quietly grow a field of its own: `match` is always the key test
 * plus an optional state condition, and `available` is always the predicate.
 *
 * @param {object} spec
 * @param {string} spec.id The verb's name. The keyboard dispatches on it.
 * @param {string} spec.label What the menu shows.
 * @param {string} spec.group The menu's section this command belongs to.
 * @param {string | string[]} spec.menu Which menu or menus it appears in.
 * @param {object} spec.key The shortcut, as a descriptor; the one the menu writes.
 * @param {object[]} [spec.alsoKeys] Further shortcuts for the same verb, which the keyboard
 *   answers and the menu does not write. Redo has two, as every editor does.
 * @param {(state: object) => boolean} [spec.available] The predicate.
 * @param {(state: object, event: KeyboardEvent) => boolean} [spec.when] The extra condition on
 *   the *key*, asked of the document and of the press itself.
 * @param {(event: KeyboardEvent) => boolean} [spec.matches] A reader of the press that replaces
 *   the descriptor test, for the verb whose key depends on the layout and has one reader
 *   elsewhere (the view gestures). The descriptor is then only the verb's spelling.
 * @param {boolean} [spec.deletes] Whether the verb removes elements.
 * @returns {object} The command.
 */
function command({ id, label, group, menu, key, alsoKeys = [], available, when, matches, deletes, tool, contextHint, contextHintKey }) {
    const edits = commandEdits(id);
    const holds = available ?? (() => true);
    return Object.freeze({
        id,
        label,
        group,
        menu,
        key,
        hint: spellKey(key),
        ...(tool === undefined ? {} : { tool, contextHint, contextHintKey }),
        // A verb that edits is not available while the page is view-only, so the
        // menu and the palette stop offering it without a predicate of their own.
        available: (state) => !(edits && state.viewOnly === true) && holds(state),
        edits,
        alsoKeys: Object.freeze([...alsoKeys]),
        match: (event, state) =>
            (matches ? matches(event) : [key, ...alsoKeys].some((spec) => matchesKey(event, spec)))
            && (when ? when(state, event) : true),
        // Whether this verb removes elements from the scene. It is a fact about
        // the verb, and the fact is load-bearing: a verb that deletes owes the
        // pictures its elements were holding a release, and the guard that
        // checks it reads this flag instead of carrying its own list of which
        // verbs delete.
        deletes: deletes === true,
    });
}

/**
 * The registry.
 *
 * The order is the order the menus read in: the canvas menu first, and inside
 * each menu the order the user expects to meet the verbs in. It is not the
 * order the keyboard sees — the keyboard asks the whole registry and takes the
 * one that matches.
 */
/** The kinds Enter opens a text editor for: the label kinds and the containers. */
const EDITABLE_KINDS = new Set(["text", "rectangle", "diamond", "ellipse", "stickynote"]);

export const COMMANDS = Object.freeze([
    // The canvas menu: the verbs that act on the document rather than on what
    // is selected.
    command({
        id: "undo",
        label: "Undo",
        group: "history",
        menu: MENUS.canvas,
        key: { key: "z", mod: true },
        // The kernel owns the history, so the question crosses as a question: a
        // verb with nothing to take back is not offered, and the keyboard still
        // answers the key, because a press that did nothing is the history's
        // truth and not a missing shortcut.
        available: (state) => state.canUndo,
    }),
    command({
        id: "redo",
        label: "Redo",
        group: "history",
        menu: MENUS.canvas,
        key: { key: "z", mod: true, shift: true },
        alsoKeys: [{ key: "y", mod: true }],
        available: (state) => state.canRedo,
    }),
    command({
        id: "paste",
        label: "Paste",
        group: "clipboard",
        // Upstream puts Paste in both context menus (`App.tsx`,
        // `getContextMenuItems`: the canvas list and the element list), and a
        // paste acts on the clipboard rather than on the selection.
        menu: [MENUS.canvas, MENUS.element],
        key: { key: "v", mod: true },
        // Always available. The clipboard that answers a paste is the system's,
        // and the system can hold something this application never copied — a
        // drawing or a body of text from another application — so the answer
        // cannot be known from here without reading it, and a verb that
        // disappeared when this application's own clipboard was empty would
        // hide the one paste the user came for.
    }),
    command({
        id: "pastePlain",
        label: "Paste as plain text",
        group: "clipboard",
        menu: MENUS.canvas,
        key: { key: "v", mod: true, shift: true },
        // The clipboard's text without the chart offer and without the Mermaid
        // converter: the bytes the person copied, as the text they are.
    }),
    command({
        // What the welcome screen's `Open` row promises and what the reference
        // serves on Ctrl+O (`act/actionExport.tsx:428`): the same open button,
        // reached from the keyboard. It is declared here rather than on that
        // row because this table is the only one of shortcuts — which is what
        // `scripts/check-input-tables.mjs` exists to keep true.
        id: "openDocument",
        label: "Open",
        group: "document",
        menu: MENUS.canvas,
        key: { key: "o", mod: true },
    }),
    command({
        id: "insertImage",
        label: "Insert image",
        group: "document",
        menu: MENUS.canvas,
        // Upstream's help puts the picture on `9`, beside the tools it counts.
        key: { key: "9" },
    }),
    command({
        id: "selectAll",
        label: "Select all",
        group: "document",
        menu: MENUS.canvas,
        key: { key: "a", mod: true },
    }),
    command({
        id: "clearCanvas",
        label: "Clear canvas",
        group: "document",
        menu: MENUS.canvas,
        key: { key: "Delete", mod: true },
        available: (state) => state.hasElements,
        deletes: true,
    }),
    command({
        id: "saveLibrary",
        label: "Save library",
        group: "document",
        menu: MENUS.canvas,
        // The file's door is the browser's download, and a download has no
        // shortcut worth claiming.
        key: { key: "l", mod: true, alt: true },
    }),
    command({
        id: "copyPng",
        label: "Copy as PNG",
        group: "document",
        menu: [MENUS.canvas, MENUS.element],
        // Ctrl+Shift+Alt+C is the picture and Ctrl+C stays the drawing's own
        // copy, which is the pair upstream's help puts on the canvas.
        key: { key: "c", shift: true, alt: true },
        // Upstream's predicate is `elements.length > 0`
        // (`actionClipboard.tsx`, `actionCopyAsPng`): a picture of an empty
        // scene is a picture of nothing, so the row waits for something to
        // copy.
        available: (state) => state.hasElements,
    }),
    command({
        id: "exportText",
        label: "Download text",
        group: "document",
        menu: MENUS.canvas,
        // A download, like the library save: no shortcut to claim.
    }),
    command({
        id: "copySvg",
        label: "Copy as SVG",
        group: "document",
        menu: [MENUS.canvas, MENUS.element],
        // The same predicate as the PNG (`actionClipboard.tsx`,
        // `actionCopyAsSvg`): both ask the scene for something to copy.
        available: (state) => state.hasElements,
    }),
    command({
        id: "unlockAll",
        label: "Unlock all",
        group: "document",
        menu: MENUS.canvas,
        key: { key: "l", mod: true, shift: true },
        available: (state) => state.anyLocked,
        // The key names the *lock* when something is selected and the *unlock*
        // when nothing is. The two claims never overlap, so the registry still
        // has exactly one match for this key.
        when: (state) => !state.hasSelection,
    }),

    // The presentation verbs: they change what the page shows and what the
    // pointer may do, and they change nothing in the document. The keys are
    // upstream's own — `Alt+Z` for zen (`actionToggleZenMode.tsx:34-35`),
    // `Alt+R` for view (`actionToggleViewMode.tsx:34-35`), `Alt+/` for the
    // statistics (`actionToggleStats.tsx:26-27`, named by its physical key
    // there and by its character here, which spell the same stroke) — and
    // each carries no document condition at all: a mode is always available,
    // because looking at a drawing is possible whatever the drawing holds.
    //
    // `Alt+R` and the rotate verbs share a letter with different modifier
    // claims, and the exact-modifier rule is what keeps them apart: the
    // rotation names `Shift`, the mode names `Alt`, and a press that carries
    // one never answers to the other.
    command({
        id: "zenMode",
        label: "Zen mode",
        group: "presentation",
        menu: MENUS.canvas,
        key: { key: "z", alt: true },
    }),
    command({
        id: "viewMode",
        label: "View mode",
        group: "presentation",
        menu: MENUS.canvas,
        key: { key: "r", alt: true },
    }),
    command({
        id: "toggleTheme",
        label: "Toggle theme",
        group: "presentation",
        menu: MENUS.canvas,
        // The reference's help: «Cambiar tema claro/oscuro Alt Shift D».
        key: { key: "d", alt: true, shift: true },
    }),
    command({
        id: "toggleGrid",
        label: "Grid",
        group: "presentation",
        menu: MENUS.canvas,
        // The grid and the snap guides share a letter and split by the
        // exact-modifier rule, the same way the rotation and view verbs
        // above do: one names Shift, the other does not, and a press
        // carrying one never answers to the other. Both carry no document
        // condition — furniture is toggleable whatever the drawing holds.
        key: { key: "'", mod: true },
    }),
    command({
        id: "toggleSnap",
        label: "Snap guides",
        group: "presentation",
        menu: MENUS.canvas,
        key: { key: "s", alt: true },
    }),
    command({
        id: "toggleMidpoint",
        label: "Midpoint snapping",
        group: "presentation",
        menu: MENUS.canvas,
    }),
    command({
        id: "semanticExplorer",
        label: "Accessible explorer",
        group: "presentation",
        menu: MENUS.canvas,
        // No upstream key: the accessible explorer is this port's own door.
        // Alt+E is free in the reference's table and reachable one-handed.
        key: { key: "e", alt: true },
    }),
    command({
        id: "agentTools",
        label: "Agent tools (WebMCP)",
        group: "presentation",
        menu: MENUS.canvas,
        // The page's consent switch for the optional agent adapter. No key:
        // it is a document-level ask, like the rest of this group.
    }),
    command({
        id: "stats",
        label: "Stats",
        group: "presentation",
        menu: MENUS.canvas,
        key: { key: "/", alt: true },
    }),
    command({
        id: "library",
        label: "Library",
        group: "presentation",
        menu: MENUS.canvas,
        key: { key: "0", alt: true },
    }),

    // The element menu: the verbs that act on the selection.
    command({
        id: "cut",
        label: "Cut",
        group: "clipboard",
        menu: MENUS.element,
        key: { key: "x", mod: true },
        available: (state) => state.hasSelection,
        // A cut takes the originals out of the drawing and leaves them in the
        // clipboard, so it is a deletion path: the pictures the originals were
        // holding have to be released with them.
        deletes: true,
    }),
    command({
        id: "copy",
        label: "Copy",
        group: "clipboard",
        menu: MENUS.element,
        key: { key: "c", mod: true },
        available: (state) => state.hasSelection,
    }),
    command({
        id: "copyStyles",
        label: "Copy styles",
        group: "clipboard",
        menu: MENUS.element,
        key: { key: "c", mod: true, alt: true },
        available: (state) => state.hasSelection,
    }),
    command({
        id: "pasteStyles",
        label: "Paste styles",
        group: "clipboard",
        menu: MENUS.element,
        key: { key: "v", mod: true, alt: true },
        available: (state) => state.hasSelection,
    }),
    command({
        id: "showStrokeColour",
        label: "Show stroke colour",
        group: "style",
        menu: MENUS.element,
        key: { key: "s" },
        available: (state) => state.hasSelection,
    }),
    command({
        id: "showBackgroundColour",
        label: "Show background colour",
        group: "style",
        menu: MENUS.element,
        key: { key: "g" },
        available: (state) => state.hasSelection,
    }),
    command({
        id: "showFontFamily",
        label: "Show font family",
        group: "style",
        menu: MENUS.element,
        key: { key: "f", shift: true },
        available: (state) => state.hasSelection,
    }),
    command({
        id: "toggleWrap",
        label: "Wrap or unwrap selection",
        group: "arrange",
        menu: MENUS.element,
        key: { key: "w" },
        available: (state) => state.hasSelection,
    }),
    command({
        id: "duplicate",
        label: "Duplicate",
        group: "arrange",
        menu: MENUS.element,
        key: { key: "d", mod: true },
        available: (state) => state.hasSelection,
    }),
    command({
        id: "group",
        label: "Group",
        group: "arrange",
        menu: MENUS.element,
        key: { key: "g", mod: true },
        available: (state) => state.hasSelection,
    }),
    command({
        id: "ungroup",
        label: "Ungroup",
        group: "arrange",
        menu: MENUS.element,
        key: { key: "g", mod: true, shift: true },
        available: (state) => state.hasGroups,
    }),
    command({
        id: "front",
        label: "Bring to front",
        group: "arrange",
        menu: MENUS.element,
        key: { code: "BracketRight", mod: true, shift: true },
        available: (state) => state.hasSelection,
    }),
    command({
        id: "back",
        label: "Send to back",
        group: "arrange",
        menu: MENUS.element,
        key: { code: "BracketLeft", mod: true, shift: true },
        available: (state) => state.hasSelection,
    }),
    command({
        id: "forward",
        label: "Bring forward",
        group: "arrange",
        menu: MENUS.element,
        key: { code: "BracketRight", mod: true },
        available: (state) => state.hasSelection,
    }),
    command({
        id: "backward",
        label: "Send backward",
        group: "arrange",
        menu: MENUS.element,
        key: { code: "BracketLeft", mod: true },
        available: (state) => state.hasSelection,
    }),
    // The distributions: the free space shared out evenly, upstream's
    // `actionDistribute.tsx`. Three members is the floor the card names
    // (with two there is no gap to share), and the keys are upstream's own
    // — `Alt` and the letter, no `mod` — which the alignments' `Alt+Shift`
    // leaves free.
    command({
        id: "distributeHorizontally",
        label: "Distribute horizontally",
        group: "arrange",
        menu: MENUS.element,
        key: { key: "h", alt: true },
        available: (state) => state.selectionCount > 2,
    }),
    command({
        id: "distributeVertically",
        label: "Distribute vertically",
        group: "arrange",
        menu: MENUS.element,
        key: { key: "v", alt: true },
        available: (state) => state.selectionCount > 2,
    }),
    ...ALIGN_SHORTCUT_KEYS.map((key) =>
        command({
            id: alignVerbId(key),
            label: `Align ${key.replace("arrow", "")}`,
            group: "align",
            menu: MENUS.element,
            // The reference's help binds the four edges to Ctrl+Shift and the
            // two centres to nothing: the centre alignments live in the element
            // menu and the palette, and Ctrl+Shift+V is the plain paste's.
            key: key === "h" || key === "v" ? undefined : { key, shift: true, mod: true },
            available: (state) => state.selectionCount > 1,
        }),
    ),
    // The link verbs: the address is the one field the application leaves the
    // drawing for, so the verbs that answer it are the selection's own — the
    // element menu's, not the canvas's — and the editor is reached the way
    // upstream reaches it (`actionLink.tsx` registers Ctrl+K on the
    // selection). The state they ask for is one more answer of the document,
    // and `hasLink` is what keeps `Open` and `Remove` from offering
    // themselves where there is nothing to open or remove.
    command({
        id: "openLink",
        label: "Open link",
        group: "link",
        menu: MENUS.element,
        available: (state) => state.hasSelection && state.hasLink,
    }),
    command({
        id: "editLink",
        label: "Edit link",
        group: "link",
        menu: MENUS.element,
        key: { key: "k", mod: true },
        available: (state) => state.hasSelection,
    }),
    command({
        id: "removeLink",
        label: "Remove link",
        group: "link",
        menu: MENUS.element,
        available: (state) => state.hasSelection && state.hasLink,
    }),
    command({
        id: "rotate90cw",
        label: "Rotate 90\u00b0 clockwise",
        group: "transform",
        menu: MENUS.element,
        key: { key: "r", shift: true },
        available: (state) => state.hasSelection,
    }),
    command({
        id: "rotate90ccw",
        label: "Rotate 90\u00b0 counter-clockwise",
        group: "transform",
        menu: MENUS.element,
        key: { key: "r", shift: true, mod: true },
        available: (state) => state.hasSelection,
    }),
    command({
        id: "flipHorizontal",
        label: "Flip horizontally",
        group: "transform",
        menu: MENUS.element,
        key: { key: "h", shift: true },
        available: (state) => state.hasSelection,
    }),
    command({
        id: "flipVertical",
        label: "Flip vertically",
        group: "transform",
        menu: MENUS.element,
        key: { key: "v", shift: true },
        available: (state) => state.hasSelection,
    }),
    command({
        id: "toggleArrowBinding",
        label: "Toggle arrow binding",
        group: "binding",
        menu: MENUS.element,
        available: (state) => state.hasSelectedArrow,
    }),
    command({
        id: "lock",
        label: "Lock",
        group: "lock",
        menu: MENUS.element,
        key: { key: "l", mod: true, shift: true },
        available: (state) => state.hasSelection,
        when: (state) => state.hasSelection,
    }),
    command({
        id: "enableTextAutoResize",
        label: "Auto-resize text",
        group: "edit",
        menu: MENUS.element,
        available: (state) => state.fixedText && state.selectionCount === 1,
    }),
    // The panel's line-editor icon, named for what it means. Upstream reaches
    // the vertex mode from a double click over the stroke — a Ctrl/Cmd one for
    // an arrow, a plain one for a line (`App.tsx:6205`); an action says it
    // outright. It is not `editSelected`'s road: that one is Enter, and Enter
    // on a line opens a label or finds nothing at the box's centre. The floor
    // is the double click's own rule read of the selection (`vertex-edit.mjs`
    // `linearPointsEditable`): a lone line or a lone arrow the kernel does not
    // bend, because the elbow keeps its segment handling and not the polyline
    // editor.
    command({
        id: "editLinearPoints",
        label: "Edit the points",
        group: "edit",
        menu: MENUS.element,
        available: (state) => state.linearPoints,
    }),
    command({
        id: "fontSizeIncrease",
        label: "Increase font size",
        group: "edit",
        menu: MENUS.element,
        key: { key: ">", mod: true, shift: true },
        available: (state) => state.hasSelection,
    }),
    command({
        id: "fontSizeDecrease",
        label: "Decrease font size",
        group: "edit",
        menu: MENUS.element,
        key: { key: "<", mod: true, shift: true },
        available: (state) => state.hasSelection,
    }),
    command({
        id: "delete",
        label: "Delete",
        group: "edit",
        menu: MENUS.element,
        key: { key: ["Delete", "Backspace"] },
        available: (state) => state.hasSelection,
        // The plainest deletion path there is.
        deletes: true,
    }),
]);

/** The keys each page mode owns while it is up. */
const MODE_KEYS = Object.freeze({
    crop: Object.freeze(["Escape", "Enter"]),
    stats: Object.freeze(["Escape"]),
    multipoint: Object.freeze(["Escape", "Enter"]),
});

/**
 * The mode that owns `key`, or `null`. `state.modes` is ordered most specific
 * first, and the first mode that listens to the key wins.
 */
function leadingMode(state, key) {
    for (const mode of state.modes ?? []) {
        if (MODE_KEYS[mode]?.includes(key)) {
            return mode;
        }
    }
    return null;
}

const NO_PAGE = Object.freeze({ modes: () => [], selectionTool: () => true });

/**
 * The document's answer to the questions the registry asks.
 *
 * The registry names the verbs and the keys; this answers "may this happen
 * right now?" about the document. Two questions are asked of the kernel — is
 * anything selected, and is anything locked — and one is asked of the scene
 * the client already has to read: whether the selection touches a group.
 *
 * # Why it lives here
 *
 * The predicates above read three names — `hasSelection`, `hasGroups` and
 * `anyLocked` — and the thing that produces them is the other half of the
 * same contract. Split across two files, the two halves could only be checked
 * by a browser: a predicate that asked for a fourth name the producer never
 * made would answer `undefined`, which is falsy, so it would read as "never
 * available" and the verb would silently vanish from the menus. Here, next to
 * the predicates that read it, the contract is one thing.
 *
 * # The groups question
 *
 * It is asked here rather than in the kernel because the answer is about the
 * *selection*, not about the scene: the same scene can hold a group and a
 * selection that does not touch it, and "Ungroup" is about the second. The
 * kernel has `groupIdOf` for the one element, and the client asks it per
 * selected id.
 *
 * # The locked question
 *
 * It crosses as a question. A client that kept its own count of what is
 * locked would be a second truth about the document, and one that goes stale
 * as soon as anything else changes it.
 *
 * # The answers are lazy, and that is the point
 *
 * The keyboard asks this object on every key press and the menu asks it once
 * per right-click, and the answers cost crossings and walks: reading the
 * selection copies its ids, and "is anything locked" walks the scene. So each
 * answer is computed when somebody reads it, and not before.
 *
 * That is what makes the keyboard cheap. A key press that names no command
 * reads nothing at all, and the only answer the keyboard ever needs is
 * `hasSelection` — which the lock/unlock disambiguation asks and the other
 * eighteen verbs never touch. "Is anything locked" is a *menu* predicate, and
 * the menu is opened a handful of times a minute.
 *
 * @param {Session} session
 * @param {() => boolean} [isViewOnly] Whether the page refuses edits right now.
 * @param {{ modes: () => string[], selectionTool: () => boolean }} [page] What only the page
 *   knows: the modes that are up (a crop, a panel, a polyline in flight), most specific first,
 *   and whether the selection tool is the armed one. Asked lazily like the rest, and kept
 *   apart from the document's vocabulary: the menu and the palette pass nothing and see no mode.
 * @returns {{ viewOnly: boolean, canUndo: boolean, canRedo: boolean, hasSelection: boolean, hasGroups: boolean, anyLocked: boolean, fixedText: boolean }}
 */
export function commandState(session, isViewOnly = () => false, page = NO_PAGE) {
    // The selection is read once and remembered: two answers need it, and
    // reading it twice would copy the ids twice.
    let ids = null;
    const selected = () => {
        if (ids === null) {
            ids = session.selectedIds();
        }
        return ids;
    };
    return {
        get viewOnly() {
            return isViewOnly() === true;
        },
        get canUndo() {
            return session.canUndo();
        },
        get canRedo() {
            return session.canRedo();
        },
        get hasElements() {
            return session.len > 0;
        },
        get hasSelection() {
            return selected().length > 0;
        },
        // The count, for the verbs whose floor is more than one: distributing
        // needs three members (with two there is no gap to share), and a
        // predicate that asked hasSelection would offer it to a pair.
        get selectionCount() {
            return selected().length;
        },
        get hasSelectedArrow() {
            return session.hasSelectedArrow();
        },
        // The fixed-text verb acts on one text only. The kernel owns both the
        // element kind and auto-resize flag, so the page asks it instead of
        // reinterpreting document JSON.
        get fixedText() {
            const chosen = selected();
            if (chosen.length !== 1) {
                return false;
            }
            try {
                return session.isTextFixed(chosen[0]) === true;
            } catch {
                return false;
            }
        },
        get hasGroups() {
            for (const id of selected()) {
                const group = session.groupIdOf(id);
                if (group !== undefined && group !== null) {
                    return true;
                }
            }
            return false;
        },
        get anyLocked() {
            return session.anyLocked();
        },
        get modes() {
            return page.modes();
        },
        get selectionTool() {
            return page.selectionTool() === true;
        },
        // The kind of the one selected element, or `null`. The kernel owns the
        // vocabulary (`kindOf`), so a verb that acts on "a text" or "a shape
        // that can hold one" asks instead of reinterpreting the document.
        get selectedKind() {
            const chosen = selected();
            if (chosen.length !== 1) {
                return null;
            }
            try {
                return session.kindOf(chosen[0]);
            } catch {
                return null;
            }
        },
        // Whether the selection is one element the kernel can slice. The kernel
        // answers `null` for every element with no bitmap, so the page does not guess kinds.
        get croppable() {
            const chosen = selected();
            if (chosen.length !== 1) {
                return false;
            }
            try {
                return JSON.parse(session.cropOf(chosen[0])) !== null;
            } catch {
                return false;
            }
        },
        // Whether the selection is one element whose vertices the point-editing
        // verb opens. The rule is the double click's (`vertex-edit.mjs`) without
        // the pointer: a lone line, or a lone arrow the kernel does not bend.
        // A session that cannot answer `kindOf` says no, as it does everywhere
        // the kernel has the word.
        get linearPoints() {
            const chosen = selected();
            if (chosen.length !== 1) {
                return false;
            }
            try {
                return linearPointsEditable(session, chosen[0]);
            } catch {
                return false;
            }
        },
        get hasLink() {
            for (const id of selected()) {
                const link = session.linkOf(id);
                if (link !== undefined && link !== null && link !== "") {
                    return true;
                }
            }
            return false;
        },
    };
}

/**
 * The verbs that live on the keyboard alone.
 *
 * Switching the selected shapes with Tab and nudging them with the arrows are not
 * things a menu or a palette would offer: there is no label worth reading for
 * "move one pixel left", and eight of them would bury the verbs that are worth
 * searching. They are still verbs — one name, one key, one `edits` fact, one body
 * in `runCommand` — so the view-mode gate and the key-collision rule cover them
 * like the rest. They carry no `menu`, and `menuSections` and `searchCommands`
 * read `COMMANDS` only, which is what keeps them off both.
 *
 * Tab has two owners and the focus decides: on the page it is upstream's shape
 * switch, on a control it is the browser's focus movement, so its key test also
 * asks the press where it landed.
 */
export const KEYBOARD_COMMANDS = Object.freeze([
    command({
        id: "shapeSwitchNext",
        label: "Toggle shape type",
        group: "selection",
        key: { key: "Tab" },
        when: (_state, event) => !isOnControl(event.target),
    }),
    command({
        id: "shapeSwitchPrevious",
        label: "Toggle shape type backwards",
        group: "selection",
        key: { key: "Tab", shift: true },
        when: (_state, event) => !isOnControl(event.target),
    }),
    command({
        id: "help",
        label: "Keyboard shortcuts and help",
        group: "help",
        key: { key: "?" },
    }),
    ...[
        ["Left", "ArrowLeft", -1, 0],
        ["Right", "ArrowRight", 1, 0],
        ["Up", "ArrowUp", 0, -1],
        ["Down", "ArrowDown", 0, 1],
    ].flatMap(([name, key]) => [
        command({ id: `nudge${name}`, label: `Nudge ${name.toLowerCase()}`, group: "nudge", key: { key } }),
        command({
            id: `nudge${name}Coarse`,
            label: `Nudge ${name.toLowerCase()} by five`,
            group: "nudge",
            key: { key, shift: true },
        }),
    ]),
    // The tools: one verb per row of the tool table, so the table stays the only list.
    ...TOOL_SHORTCUT_KEYS.map((key) => {
        const tool = toolForShortcut(key);
        const phrase = howOf(tool);
        return command({
            id: toolVerbId(key),
            label: buttonText(tool),
            group: "tool",
            key: { key: TOOL_NUMBER_ALIASES[key] ? [key, TOOL_NUMBER_ALIASES[key]] : key },
            tool,
            contextHint: TOOL_HOWS[phrase],
            contextHintKey: `ui.tool.how.${phrase}`,
        });
    }),
    // The tool lock: Q flips it, the way upstream's keyboard does
    // (`toggleLock("keyboard")`, `App.tsx:5387-5388`), and the next creation
    // keeps the tool in the hand instead of handing the page back to the
    // selection (`App.tsx:10198` gates the hand-back on the lock).
    command({
        id: "toggleToolLock",
        label: "Toggle tool lock",
        group: "tool",
        key: { key: "q" },
    }),
    // Alignment actions live in COMMANDS as menu and palette verbs; the same
    // key descriptors make them available to the keyboard without a duplicate.
    // The flowchart walk: `Alt` and the arrow, without Shift, which the alignments
    // already claim. The key names a diagram gesture, not a pixel one — upstream's
    // flowchart navigation — so the verb's body lives with the other kernel round-trips.
    ...FLOWCHART_DIRECTIONS.map((direction) =>
        command({
            id: flowchartVerbId(direction),
            label: `Walk flowchart ${direction}`,
            group: "selection",
            key: { key: FLOWCHART_KEYS[direction], alt: true },
        }),
    ),
    // Dropping the selection: the page keeps whatever tool is armed.
    command({
        id: "clearSelection",
        label: "Clear selection",
        group: "selection",
        key: { key: "a", mod: true, shift: true },
    }),
    // Escape drops the selection and carries the tool home, as upstream's does. The modes
    // that own the key while they are up (a crop, a panel, a polyline in flight) are the
    // verbs below it, and this one steps aside while any of them is up.
    command({
        id: "escape",
        label: "Escape",
        group: "selection",
        key: { key: "Escape" },
        // A mode that is up owns the key: Escape means "back out of where I am".
        when: (state) => leadingMode(state, "Escape") === null,
    }),
    // The modes. Each owns its keys whatever modifiers ride with them, as the
    // keydown's own tests did, and `leadingMode` picks one owner per key, so
    // two modes up at once never name two verbs.
    command({
        id: "cropConfirm",
        label: "Apply the crop",
        group: "selection",
        matches: (event) => event.key === "Enter" && !event.metaKey && !event.ctrlKey && event.repeat !== true,
        when: (state, event) => leadingMode(state, event.key) === "crop",
    }),
    command({
        id: "cropExit",
        label: "Leave the crop",
        group: "selection",
        matches: (event) => event.key === "Escape",
        when: (state, event) => leadingMode(state, event.key) === "crop",
    }),
    command({
        id: "statsClose",
        label: "Close the statistics",
        group: "selection",
        matches: (event) => MODE_KEYS.stats.includes(event.key),
        when: (state, event) => leadingMode(state, event.key) === "stats",
    }),
    command({
        id: "multipointEnd",
        label: "Finish the drawing",
        group: "selection",
        matches: (event) => MODE_KEYS.multipoint.includes(event.key),
        when: (state, event) => leadingMode(state, event.key) === "multipoint",
    }),
    // Enter on a lone image arms the crop. No mode may own Enter, and a tool
    // other than selection says what the next press is for.
    command({
        id: "cropArm",
        label: "Crop the image",
        group: "selection",
        menu: MENUS.element,
        available: (state) => leadingMode(state, "Enter") === null && state.selectionTool && state.croppable,
        matches: (event) => event.key === "Enter" && !event.metaKey && !event.ctrlKey && event.repeat !== true,
        when: (state, event) =>
            leadingMode(state, event.key) === null && state.selectionTool && state.croppable,
    }),
    // Enter opens the selected text, or gives the selected shape a label — the
    // keyboard's way to the same editor the canvas opens on a double click.
    // Upstream's `hints.text_selected` and `hints.bindTextToElement` name this
    // key, so the hint and the verb are one agreement: a hint that names Enter
    // is a hint the registry answers. The kinds are the kernel's own words
    // (`isTextBindableContainer`, `TEXT_BINDABLE`); an image is not among them,
    // which leaves Enter's crop verb (`cropArm`) as its only owner.
    command({
        id: "editSelected",
        label: "Edit the selected text",
        group: "selection",
        key: { key: "Enter" },
        available: (state) => state.selectionTool && EDITABLE_KINDS.has(state.selectedKind),
        when: (state, event) =>
            leadingMode(state, event.key) === null && state.selectionTool && EDITABLE_KINDS.has(state.selectedKind),
    }),
    // The view: zoom with Ctrl/Meta and +, - and 0; fit with Shift+1 and Shift+2.
    ...VIEW_KEYS.map(([action, key]) =>
        command({
            id: viewVerbId(action),
            label: `View ${action}`,
            group: "view",
            key,
            matches: (event) => viewKeyAction(event) === action,
        }),
    ),
]);

/** Every registered command, including the keyboard-only verbs. */
export const ALL_COMMANDS = Object.freeze([...COMMANDS, ...KEYBOARD_COMMANDS]);
/** Registered commands with an actual key binding, for the shortcut reference. */
export const SHORTCUT_COMMANDS = Object.freeze(ALL_COMMANDS.filter((entry) => entry.key !== undefined));

/** The step of a fine nudge and of a coarse one (`Shift`), in screen pixels.
 *
 * The two steps are the pin's own: the plain arrow walks one screen pixel
 * (`ELEMENT_TRANSLATE_AMOUNT`, `constants.ts:35`) and the Shift arrow walks
 * five (`ELEMENT_SHIFT_TRANSLATE_AMOUNT`, `constants.ts:34`). With the grid
 * on the pin swaps the pair — the plain arrow steps to the grid and Shift
 * walks the fine unit — and this table says nothing about that road yet. */
export const NUDGE_STEPS = Object.freeze({ fine: 1, coarse: 5 });

/**
 * The offset a nudge verb moves the selection by, in screen space (y grows down),
 * or `null` for a verb that is not a nudge.
 *
 * @param {string} id The verb's name.
 * @returns {{ dx: number, dy: number } | null}
 */
export function nudgeOffset(id) {
    const match = /^nudge(Left|Right|Up|Down)(Coarse)?$/.exec(id);
    if (match === null) {
        return null;
    }
    const step = match[2] === undefined ? NUDGE_STEPS.fine : NUDGE_STEPS.coarse;
    const unit = { Left: [-1, 0], Right: [1, 0], Up: [0, -1], Down: [0, 1] }[match[1]];
    return { dx: unit[0] * step, dy: unit[1] * step };
}

/**
 * Every command this key press names.
 *
 * The list, not the winner, because the winner is the list's only interesting
 * property and there is a rule about what that property has to be: the press
 * runs one command, and when two of them claim it the press runs nothing at
 * all. A registry that cannot say "two matched" cannot be checked for that.
 *
 * @param {KeyboardEvent} event The press.
 * @param {object} state The document's answer, for the commands that need one.
 * @returns {string[]} The ids that claim the press.
 */
export function commandsForKey(event, state) {
    return [...COMMANDS, ...KEYBOARD_COMMANDS]
        .filter((entry) => entry.match(event, state))
        .map((entry) => entry.id);
}

/**
 * The command this key press names, or `null`.
 *
 * `null` covers the two cases that are not a command: no command claims the
 * press, or two of them do. The second is a defect in the registry rather than
 * a thing the user did, and the keyboard treats both the same way — it leaves
 * the key to the browser — so that a broken registry is visible as a dead key
 * instead of as a wrong edit.
 *
 * @param {KeyboardEvent} event The press.
 * @param {object} state The document's answer, for the commands that need one.
 * @returns {string | null}
 */
export function commandForKey(event, state) {
    const matches = commandsForKey(event, state);
    return matches.length === 1 ? matches[0] : null;
}

/**
 * The commands a query names, best first.
 *
 * The palette is the third view of this registry, and the only thing it adds
 * over the other two is a way of narrowing the list by typing.
 *
 * # The two things the narrowing does
 *
 * It asks the registry for the verbs the document can honour *right now*, and
 * then it narrows them by text. The first half is the same question the
 * context menu asks, and it gets the same answer: the palette and the menu
 * cannot disagree about what the document can do, because neither of them has
 * an opinion of its own.
 *
 * The second half is about text, and it looks in two places.
 *
 * - The **label**: the query's characters appear in the label in the same
 *   order. That single rule is what lets `dl` find `Duplicate` and `selall`
 *   find `Select all` without a dictionary of abbreviations. The characters
 *   need not be adjacent: a gap in the label is skipped, which is exactly what
 *   lets the space in `Select all` be left out of the query.
 * - The **shortcut**, as it is written beside the verb: `ctrl+shift+]` finds
 *   the verb that moves the selection to the front, and `]` finds it too. A
 *   user who remembers the key and not the name is as lost as one who
 *   remembers the name and not the key, and the palette is where the two
 *   halves of a shortcut meet.
 *
 * # How the matches are ranked
 *
 * A label is matched with the upstream fuzzy subsequence score: consecutive
 * characters receive exponentially increasing weight. Exact labels rank first;
 * ties keep registry order. Shortcut spellings remain searchable as fallback.
 *
 * @param {string} query What the user typed.
 * @param {object} state The document's answer.
 * @returns {object[]} The commands, best first.
 */
export function searchCommands(query, state, labelOf = (entry) => entry.label) {
    const text = normaliseSearchText(query);
    return COMMANDS
        .map((entry, index) => ({
            entry,
            index,
            rank: entry.available(state) ? rankOf(entry, text, labelOf(entry)) : -1,
        }))
        .filter((candidate) => candidate.rank >= 0)
        .sort((a, b) => b.rank - a.rank || a.index - b.index)
        .map((candidate) => candidate.entry);
}

function normaliseSearchText(text) {
    return text
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[<>_| -]/g, "");
}

function rankOf(entry, query, label) {
    if (query === "") {
        return 0;
    }
    const text = normaliseSearchText(label);
    if (text === query) {
        return Number.POSITIVE_INFINITY;
    }
    let queryIndex = 0;
    let runScore = 0;
    let totalScore = 0;
    for (const character of text) {
        if (character === query[queryIndex]) {
            runScore = 1 + runScore * 2;
            totalScore += runScore;
            queryIndex += 1;
            if (queryIndex === query.length) {
                return totalScore;
            }
        } else {
            runScore = 0;
        }
    }
    return queryNamesShortcut(query, entry.key) ? 1 : -1;
}

/**
 * The commands a menu shows, in sections.
 *
 * The rows and the separators are the layout's (`CONTEXT_MENUS`), which is
 * upstream's own shape: a list per context with a separator written between
 * two groups. A row is kept when its command's predicate accepts the
 * document, and a section that loses every row is dropped, so a menu never
 * starts with a separator, never ends with one and never draws two in a row.
 *
 * The multi-selection context is derived here rather than by the caller: the
 * element menu is the element menu, and the document's count says which of
 * the two lists it is.
 *
 * @param {string} where Which context: `canvas`, `element` or `selection`.
 * @param {object} state The document's answer.
 * @returns {{ group: string, commands: object[] }[]} The sections, in order.
 */
export function menuSections(where, state) {
    // The element menu is the menu of a selection: it is opened on an element,
    // and a document with nothing selected has only the canvas menu.
    if (where === MENUS.element && !state.hasSelection) {
        return [];
    }
    const context = where === MENUS.element && (state.selectionCount ?? 0) > 1
        ? MENUS.selection
        : where;
    const layout = CONTEXT_MENUS[context];
    if (layout === undefined) {
        return [];
    }
    const sections = [];
    for (const section of layout) {
        const commands = [];
        for (const id of section.commands) {
            const entry = MENU_COMMANDS.get(id);
            if (entry !== undefined && entry.available(state)) {
                commands.push(entry);
            }
        }
        if (commands.length > 0) {
            sections.push({ group: section.group, commands });
        }
    }
    return sections;
}

/** The registry, by id, as the menu layout names its rows. */
const MENU_COMMANDS = new Map(ALL_COMMANDS.map((entry) => [entry.id, entry]));
