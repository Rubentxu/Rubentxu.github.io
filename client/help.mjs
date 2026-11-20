import { TOOLS, letterKeyFor, numericKeyFor } from "./tools.mjs";
import { formatText } from "./i18n.mjs";
import { spellKey } from "./keys.mjs";
import { CHROME_ICONS } from "./chrome-icons.mjs";


/** A page-session preference for the contextual hint viewer. */
export function createHintPreference(storage = null) {
    let enabled = true;
    try {
        enabled = storage?.getItem("nextdraw.showHints") !== "false";
    } catch {
        // A restricted browser storage surface leaves the preference in memory.
    }
    return {
        isEnabled: () => enabled,
        setEnabled(value) {
            enabled = value === true;
            try {
                storage?.setItem("nextdraw.showHints", String(enabled));
            } catch {
                // The visible preference still changes for this mount.
            }
            return enabled;
        },
    };
}

/**
 * The hint upstream shows for each state, in the reference's own order and
 * with the reference's own words (`HintViewer.tsx:getHints`).
 *
 * The sources are English because that is this client's source language; the
 * catalogs translate `ui.hint.*` and a locale that lacks one falls back to
 * these. The conditions, not the sentences, are what makes the hint true: a
 * tool with no row here shows nothing, exactly as upstream's `getHints`
 * answers `null` for the hand, the shapes, the frame and the laser.
 */
const HINTS = Object.freeze({
    eraserRevert: Object.freeze({
        key: "ui.hint.eraserRevert",
        source: "Hold {shortcut} to revert the elements marked for deletion",
        keys: { shortcut: "Alt" },
    }),
    arrowTool: Object.freeze({
        key: "ui.hint.arrowTool",
        source: "Click to start multiple points, drag for single line. Press {shortcut} again to change arrow type.",
        keys: { shortcut: "A" },
    }),
    linearElement: Object.freeze({
        key: "ui.hint.linearElement",
        source: "Click to start multiple points, drag for single line",
        keys: {},
    }),
    freeDraw: Object.freeze({
        key: "ui.hint.freeDraw",
        source: "Click and drag, release when you're finished",
        keys: {},
    }),
    text: Object.freeze({
        key: "ui.hint.text",
        source: "Tip: you can also add text by double-clicking anywhere with the selection tool",
        keys: {},
    }),
    embeddable: Object.freeze({
        key: "ui.hint.embeddable",
        source: "Click-drag to create a website embed",
        keys: {},
    }),
    stickynote: Object.freeze({
        key: "ui.hint.stickynote",
        source: "Click to place a note, or drag to size it",
        keys: {},
    }),
    canvasPanning: Object.freeze({
        key: "ui.hint.canvasPanning",
        source: "To move canvas, hold {shortcut_1} or {shortcut_2} while dragging, or use the hand tool",
        keys: { shortcut_1: "@mmb", shortcut_2: "Space" },
    }),
    bindTextToElement: Object.freeze({
        key: "ui.hint.bindTextToElement",
        source: "{shortcut} to add text",
        keys: { shortcut: "Enter" },
    }),
    textSelected: Object.freeze({
        key: "ui.hint.text_selected",
        source: "Double-click or press {shortcut} to edit text",
        keys: { shortcut: "Enter" },
    }),
    resize: Object.freeze({
        key: "ui.hint.resize",
        source: "You can constrain proportions by holding {shortcut_1} while resizing,\nhold {shortcut_2} to resize from the center",
        keys: { shortcut_1: "Shift", shortcut_2: "Alt" },
    }),
    resizeImage: Object.freeze({
        key: "ui.hint.resizeImage",
        source: "You can resize freely by holding {shortcut_1},\nhold {shortcut_2} to resize from the center",
        keys: { shortcut_1: "Shift", shortcut_2: "Alt" },
    }),
    rotate: Object.freeze({
        key: "ui.hint.rotate",
        source: "You can constrain angles by holding {shortcut} while rotating",
        keys: { shortcut: "Shift" },
    }),
});

/** The kinds a double click turns into a label, upstream's `isTextBindableContainer`. */
const TEXT_BINDABLE = Object.freeze(new Set(["rectangle", "diamond", "ellipse", "stickynote"]));

/**
 * Which hint the reference would show for this state, or `null` for none.
 *
 * The order is `HintViewer.tsx:getHints`'s own, because the order is the
 * condition: the eraser answers before the tool, the tool before the
 * selection, and the selection's own branches before the no-selection one. A
 * hint this build cannot honour is not shown — the frame, the rectangle and
 * the hand have no row upstream either, and the embed's "click-drag" is the
 * gesture this build performs.
 *
 * @param {{ tool: string, selection?: {count: number, kind: string|null}, gesture?: {kind?: string}|null, isMobile?: boolean, mmb?: string }} state
 * @returns {{ key: string, source: string, values: Record<string, string> }|null}
 */
export function hintFor({ tool, selection = null, gesture = null, isMobile = false, mmb = "Scroll wheel" }) {
    const count = selection?.count ?? 0;
    const kind = selection?.kind ?? null;
    const gestureKind = gesture?.kind ?? null;
    const hint = (row, values = {}) => ({
        key: row.key,
        source: row.source,
        values: Object.fromEntries(Object.entries(row.keys).map(([name, label]) => [name, label === "@mmb" ? mmb : label])),
    });
    if (tool === TOOLS.eraser) return hint(HINTS.eraserRevert);
    if (tool === TOOLS.arrow) return hint(HINTS.arrowTool);
    if (tool === TOOLS.line) return hint(HINTS.linearElement);
    if (tool === TOOLS.freedraw) return hint(HINTS.freeDraw);
    if (tool === TOOLS.text) return hint(HINTS.text);
    if (tool === TOOLS.embeddable) return hint(HINTS.embeddable);
    if (tool === TOOLS.stickynote) return hint(HINTS.stickynote);
    if (gestureKind === "resize" && count === 1) {
        return kind === "image" ? hint(HINTS.resizeImage) : hint(HINTS.resize);
    }
    if (gestureKind === "rotate" && count === 1) {
        return hint(HINTS.rotate);
    }
    if (tool !== TOOLS.selection) {
        return null;
    }
    if (count === 1) {
        if (kind === "text") {
            return hint(HINTS.textSelected);
        }
        if (TEXT_BINDABLE.has(kind) && gestureKind !== "translate") {
            return hint(HINTS.bindTextToElement);
        }
        return null;
    }
    if (count === 0 && !isMobile) {
        return hint(HINTS.canvasPanning);
    }
    return null;
}

/**
 * Render the hint the reference shows for the current tool and selection.
 *
 * A paint calls this on every frame, so it computes a signature first and
 * leaves the DOM alone when nothing it names has changed. The selection is
 * read only when the answer can depend on it — a draw tool's hint does not —
 * so a stroke does not pay a selection crossing per frame.
 *
 * The shortcut is a `<kbd>`, as in upstream's `HintViewer`; the hint is one
 * sentence built from the catalog's template and the key it names. The panel
 * is a reference, not a control: no pointer events, and `hidden` when the
 * reference would answer `null`.
 *
 * @param {object} options
 * @param {Element} options.root the `#tool-hint` element.
 * @param {{ currentTool: string }} options.toolState
 * @param {() => ({kind?: string}|null)} [options.pendingGesture]
 * @param {(key: string, source?: string) => string} [options.say]
 * @param {() => boolean} [options.isEnabled]
 * @param {() => ({count: number, kind: string|null})} [options.readSelection]
 * @param {() => boolean} [options.isMobile]
 * @returns {{ refresh: () => void }}
 */
export function bindHintViewer({
    root,
    toolState,
    pendingGesture = () => null,
    say = (_key, source) => source,
    isEnabled = () => true,
    readSelection = () => ({ count: 0, kind: null }),
    isMobile = () => false,
}) {
    let signature = null;
    function refresh() {
        const tool = toolState.currentTool;
        const gesture = pendingGesture();
        const enabled = isEnabled();
        const gestureKind = gesture?.kind ?? null;
        // Only a selection tool or a transform can want the selection: every
        // other hint is the tool's own.
        const wantsSelection = tool === TOOLS.selection || gestureKind === "resize" || gestureKind === "rotate";
        const selection = wantsSelection ? readSelection() : { count: 0, kind: null };
        const mobile = isMobile();
        const next = hintFor({
            tool,
            selection,
            gesture,
            isMobile: mobile,
            mmb: say("ui.keys.mmb", "Scroll wheel"),
        });
        const answer = !enabled ? null : next;
        const key = answer === null
            ? "none"
            : `${answer.key}|${answer.values.shortcut ?? ""}|${answer.values.shortcut_1 ?? ""}|${answer.values.shortcut_2 ?? ""}|${say(answer.key, answer.source)}|${gestureKind ?? ""}`;
        if (key === signature) {
            return;
        }
        signature = key;
        root.hidden = answer === null;
        if (answer === null) {
            root.textContent = "";
            root.removeAttribute("data-hint");
            root.removeAttribute("data-gesture");
            return;
        }
        // The key names are the locale's too: upstream's Spanish says
        // "Espacio" where the source says "Space" (`keys.spacebar`).
        const tagged = Object.fromEntries(
            Object.entries(answer.values).map(([name, label]) => [
                name,
                `<kbd>${say(`ui.key.${label.toLowerCase()}`, label)}</kbd>`,
            ]),
        );
        const rendered = formatText(say(answer.key, answer.source), tagged);
        const document_ = root.ownerDocument;
        if (document_ !== undefined && typeof document_.createTextNode === "function") {
            const line = document_.createElement("span");
            for (const part of rendered.split(/(<kbd>[^<]*<\/kbd>)/g)) {
                if (part === "") continue;
                const shortcut = part.match(/^<kbd>([^<]*)<\/kbd>$/);
                if (shortcut !== null) {
                    const kbd = document_.createElement("kbd");
                    kbd.textContent = shortcut[1];
                    line.appendChild(kbd);
                } else {
                    line.appendChild(document_.createTextNode(part));
                }
            }
            root.replaceChildren(line);
        } else {
            root.textContent = rendered.replace(/<kbd>([^<]*)<\/kbd>/g, "$1");
        }
        root.setAttribute("data-hint", answer.key);
        if (gestureKind === null) {
            root.removeAttribute("data-gesture");
        } else {
            root.setAttribute("data-gesture", gestureKind);
        }
    }

    refresh();
    return { refresh };
}

/** The keyboard's own reference, in upstream's shape (`HelpDialog.tsx`).
 *
 * Three islands — tools, view, editor — whose every row is a real verb of this
 * port. The rows are derived from the registry and the tool table, not written
 * as a second list of shortcuts: a row that named a key the keyboard refuses
 * would be an invented shortcut, and the reference's job is to be true about
 * what this build does.
 */
export const HELP_SECTIONS = Object.freeze([
    Object.freeze({ key: "tools", titleKey: "helpDialog.tools", title: "Tools", className: "HelpDialog__island--tools" }),
    Object.freeze({ key: "view", titleKey: "helpDialog.view", title: "View", className: "HelpDialog__island--view" }),
    Object.freeze({ key: "editor", titleKey: "helpDialog.editor", title: "Editor", className: "HelpDialog__island--editor" }),
]);

/** The tools' rows, in upstream's order (`HelpDialog.tsx`: hand, selection, …). */
const TOOL_HELP_ORDER = Object.freeze([
    TOOLS.hand, TOOLS.selection, TOOLS.rectangle, TOOLS.diamond, TOOLS.ellipse,
    TOOLS.arrow, TOOLS.line, TOOLS.freedraw, TOOLS.text, TOOLS.stickynote,
    "image", TOOLS.eraser, TOOLS.frame, TOOLS.laser,
]);

/** The view rows, in upstream's order, by the registry's id. */
const VIEW_HELP_IDS = Object.freeze([
    "view:zoom-in", "view:zoom-out", "view:zoom-reset", "view:fit-content", "view:fit-selection",
    "zenMode", "toggleSnap", "toggleGrid", "viewMode", "toggleTheme", "stats",
    "semanticExplorer", "library", "help",
]);

/** The editor rows, in the order the finger looks for them. */
const EDITOR_HELP_IDS = Object.freeze([
    "clearCanvas", "delete", "cut", "copy", "paste", "pastePlain", "selectAll",
    "copyPng", "copyStyles", "pasteStyles", "undo", "redo", "duplicate", "group", "ungroup",
    "toggleWrap", "front", "back", "forward", "backward",
    "align:arrowup", "align:arrowdown", "align:arrowleft", "align:arrowright", "align:h", "align:v",
    "distributeHorizontally", "distributeVertically", "lock", "flipHorizontal", "flipVertical",
    "rotate90cw", "rotate90ccw", "showStrokeColour", "showBackgroundColour", "showFontFamily",
    "fontSizeIncrease", "fontSizeDecrease", "editLink", "clearSelection",
    "flowchart:left", "flowchart:right", "flowchart:up", "flowchart:down",
]);

/** The words upstream's reference uses where the registry's label is a verb's id. */
const HELP_LABELS = Object.freeze({
    "view:zoom-in": "Zoom in",
    "view:zoom-out": "Zoom out",
    "view:zoom-reset": "Reset zoom",
    "view:fit-content": "Zoom to fit",
    "view:fit-selection": "Zoom to selection",
    "zenMode": "Zen mode",
    "toggleSnap": "Snap guides",
    "toggleGrid": "Grid",
    "viewMode": "View mode",
    "toggleTheme": "Toggle theme",
    "stats": "Stats",
    "semanticExplorer": "Accessible explorer",
    "library": "Library",
    "help": "Help",
    "align:arrowup": "Align top",
    "align:arrowdown": "Align bottom",
    "align:arrowleft": "Align left",
    "align:arrowright": "Align right",
    "align:h": "Align horizontal centers",
    "align:v": "Align vertical centers",
    "flowchart:left": "Walk flowchart",
    "flowchart:right": "Walk flowchart",
    "flowchart:up": "Walk flowchart",
    "flowchart:down": "Walk flowchart",
    "clearSelection": "Clear selection",
    "lock": "Lock or unlock",
    "editSelected": "Edit the selected text",
});

/** The display spelling of a registered shortcut, split into its key chips.
 *
 * The view's fit keys are written the way the keyboard writes them: the
 * registry spells the character `Shift+!` because that is what the press
 * types, and a person reads `Shift+1` because that is the key they hold.
 */
function chipsOf(shortcut) {
    if (typeof shortcut !== "string" || shortcut === "") {
        return [];
    }
    const spelled = shortcut === "Shift+!" ? "Shift+1" : shortcut === "Shift+@" ? "Shift+2" : shortcut;
    return spelled.split("+");
}

/** A row of the reference: one label and one or more alternative keyings. */
function helpRow(id, label, shortcuts) {
    return Object.freeze({ id, label, shortcuts: Object.freeze(shortcuts) });
}

/** The rows of the three islands, derived from the registry. */
function helpRows(commands, labelOf, say) {
    const byId = new Map(commands.map((entry) => [entry.id, entry]));
    const labelFor = (id) => {
        const entry = byId.get(id);
        if (entry === undefined) return undefined;
        // The row asks the same door the menu and the palette ask — the
        // catalogue's word for the verb — so one verb says one thing in every
        // view of it. `HELP_LABELS` answers only where the catalogue misses:
        // its spellings are upstream's words for ids whose registry label is
        // the verb's id, and a second owner of a translated row would let the
        // two views drift — the leak the interface sweep names.
        const local = labelOf(entry);
        if (local !== entry.label) {
            return local;
        }
        return HELP_LABELS[id] ?? local;
    };
    const rowsFrom = (ids) => {
        const rows = [];
        for (const id of ids) {
            const entry = byId.get(id);
            if (entry === undefined) continue;
            const shortcuts = [entry.hint, ...entry.alsoKeys.map((spec) => spellKey(spec))].filter((shortcut) => shortcut !== "");
            if (shortcuts.length === 0) continue;
            rows.push(helpRow(id, labelFor(id) ?? labelOf(entry), shortcuts));
        }
        return rows;
    };

    const toolRows = [];
    for (const tool of TOOL_HELP_ORDER) {
        if (tool === "image") {
            const entry = byId.get("insertImage");
            if (entry !== undefined) {
                toolRows.push(helpRow("insertImage", labelOf(entry), [entry.hint]));
            }
            continue;
        }
        const letter = letterKeyFor(tool);
        const key = letter === null ? null : letter.toLowerCase();
        const entry = byId.get(`tool:${key}`);
        if (entry === undefined) continue;
        const shortcuts = [letterKeyFor(tool), numericKeyFor(tool)]
            .filter((key) => key !== null && key !== undefined);
        // The selection's second letter is real (the tool table's M), and the
        // reference names the keys the keyboard answers, not a subset of them.
        if (tool === TOOLS.selection) {
            shortcuts.splice(1, 0, "M");
        }
        toolRows.push(helpRow(entry.id, labelOf(entry), shortcuts));
    }
    for (const id of ["editSelected", "cropArm"]) {
        const entry = byId.get(id);
        if (entry === undefined) continue;
        toolRows.push(helpRow(id, labelFor(id) ?? labelOf(entry), [entry.hint]));
    }
    const shapeNext = byId.get("shapeSwitchNext");
    const shapePrevious = byId.get("shapeSwitchPrevious");
    if (shapeNext !== undefined && shapePrevious !== undefined) {
        toolRows.push(helpRow("shapeSwitchNext", say("helpDialog.convertElementType", "Toggle shape type"), [shapeNext.hint, shapePrevious.hint]));
    }

    const viewRows = rowsFrom(VIEW_HELP_IDS);
    // The command palette is the page's gesture, not a registry row with a
    // `key` field; its shortcut is the one `canvas-input-wiring.mjs` answers.
    viewRows.splice(VIEW_HELP_IDS.indexOf("library"), 0, helpRow(
        "commandPalette",
        say("helpDialog.commandPalette", "Command palette"),
        ["Ctrl+Shift+P"],
    ));

    const editorRows = rowsFrom(EDITOR_HELP_IDS);

    return new Map([
        ["tools", toolRows],
        ["view", viewRows],
        ["editor", editorRows],
    ]);
}

/** One row of an island: the label on the left, the keys on the right. */
function buildRow(createElement, row) {
    const line = createElement("div");
    line.classList.add("HelpDialog__shortcut");
    line.setAttribute("data-command", row.id);
    const label = createElement("div");
    label.textContent = row.label;
    const keys = createElement("div");
    keys.classList.add("HelpDialog__key-container");
    row.shortcuts.forEach((shortcut, at) => {
        if (at > 0) {
            const or = createElement("span");
            or.classList.add("HelpDialog__or");
            or.textContent = " / ";
            keys.appendChild(or);
        }
        for (const chip of chipsOf(shortcut)) {
            const key = createElement("kbd");
            key.classList.add("HelpDialog__key");
            key.textContent = chip;
            keys.appendChild(key);
        }
    });
    line.appendChild(label);
    line.appendChild(keys);
    return line;
}

/**
 * Build the help dialog from the complete command registry.
 *
 * The shape is upstream's `HelpDialog.tsx`: a modal with a backdrop, a title,
 * one "Keyboard shortcuts" section and three islands of shortcut rows. The
 * content is this port's: every row comes from `commands` (or the tool table),
 * so the sheet cannot advertise a key the keyboard does not answer. The old
 * hints toggle moved to the menu's Preferences, where upstream keeps it.
 *
 * @param {object} options
 * @param {Element} options.root the sheet's host (`#help-dialog`).
 * @param {(tag: string) => Element} options.createElement the page's builder.
 * @param {object[]} options.commands the registered commands with a key.
 * @param {(entry: object) => string} options.labelOf the localized label of a command.
 * @param {(key: string, source: string) => string} [options.say] localized words.
 * @param {AbortSignal} [options.signal] its abort takes the sheet's listeners off.
 * @returns {{ open: () => void, close: () => void, isOpen: () => boolean }}
 */
export function bindHelpDialog({ root, createElement, commands, labelOf, say = (_key, source) => source, signal }) {
    root.classList.add("Modal", "Dialog", "HelpDialog");
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");

    const backdrop = createElement("div");
    backdrop.classList.add("Modal__background");
    backdrop.setAttribute("aria-hidden", "true");

    const content = createElement("div");
    content.classList.add("Modal__content");
    content.setAttribute("tabindex", "0");
    const island = createElement("div");
    island.classList.add("Island");

    const heading = createElement("h2");
    heading.classList.add("Dialog__title");
    heading.id = "help-dialog-title";
    root.setAttribute("aria-labelledby", "help-dialog-title");
    const headingText = createElement("span");
    headingText.classList.add("Dialog__titleContent");
    headingText.textContent = say("help.title", "Keyboard shortcuts");
    heading.appendChild(headingText);

    const closeButton = createElement("button");
    closeButton.type = "button";
    closeButton.classList.add("Dialog__close");
    closeButton.setAttribute("data-action", "close-help");
    closeButton.setAttribute("aria-label", say("help.close", "Close"));
    closeButton.innerHTML = CHROME_ICONS.CloseIcon;

    const body = createElement("div");
    body.classList.add("Dialog__content");
    const section = createElement("h3");
    section.textContent = say("helpDialog.shortcuts", "Keyboard shortcuts");
    body.appendChild(section);
    const islands = createElement("div");
    islands.classList.add("HelpDialog__islands-container");
    const rowsBySection = helpRows(commands, labelOf, say);
    for (const spec of HELP_SECTIONS) {
        const islandBox = createElement("div");
        islandBox.classList.add("HelpDialog__island", spec.className);
        const title = createElement("h4");
        title.classList.add("HelpDialog__island-title");
        title.textContent = say(spec.titleKey, spec.title);
        const list = createElement("div");
        list.classList.add("HelpDialog__island-content");
        for (const row of rowsBySection.get(spec.key) ?? []) {
            list.appendChild(buildRow(createElement, row));
        }
        islandBox.appendChild(title);
        islandBox.appendChild(list);
        islands.appendChild(islandBox);
    }
    body.appendChild(islands);
    island.appendChild(heading);
    island.appendChild(closeButton);
    island.appendChild(body);
    content.appendChild(island);
    root.replaceChildren(backdrop, content);
    root.hidden = true;

    let previousFocus = null;

    /** Every control the dialog traps the focus in, in document order. */
    function focusables() {
        return [
            ...island.querySelectorAll("button"),
            ...island.querySelectorAll("a[href]"),
            ...island.querySelectorAll("input"),
        ].filter((element) => element.hidden !== true && element.disabled !== true);
    }

    function closeDialog() {
        if (root.hidden) {
            return;
        }
        root.hidden = true;
        const previous = previousFocus;
        previousFocus = null;
        previous?.focus?.();
    }

    function open() {
        if (!root.hidden) {
            return;
        }
        previousFocus = root.ownerDocument?.activeElement ?? null;
        root.hidden = false;
        focusables()[0]?.focus();
    }

    closeButton.addEventListener("click", () => closeDialog(), signal ? { signal } : undefined);
    backdrop.addEventListener("click", () => closeDialog(), signal ? { signal } : undefined);
    root.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            event.preventDefault?.();
            event.stopPropagation?.();
            closeDialog();
            return;
        }
        if (event.key !== "Tab") {
            return;
        }
        const focusable = focusables();
        if (focusable.length === 0) {
            return;
        }
        const at = focusable.indexOf(root.ownerDocument?.activeElement);
        if (event.shiftKey && (at === 0 || at === -1)) {
            event.preventDefault?.();
            focusable[focusable.length - 1].focus();
        } else if (!event.shiftKey && at === focusable.length - 1) {
            event.preventDefault?.();
            focusable[0].focus();
        }
    }, signal ? { signal } : undefined);

    return {
        open,
        close: closeDialog,
        isOpen: () => root.hidden === false,
    };
}
