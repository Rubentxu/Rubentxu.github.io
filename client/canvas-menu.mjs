// The shell menu: the page's file actions, its command views, its preferences
// and its theme, behind the hamburger in the top-left corner.
//
// # What moved here, and why
//
// The file actions — open, save, export, import — used to be a row of text
// buttons beside the menu, which is not where upstream keeps them: the reference
// draws one hamburger island at the corner and puts those actions inside the
// menu (`main-menu/DefaultItems.tsx`, composed by `excalidraw-app`'s
// `AppMainMenu.tsx`). This module builds that menu as one surface: the same
// row order, the same groups, the same separators and the same icon + shortcut
// shape as upstream, with only the verbs this port actually owns
// (`client/commands.mjs`). Excalidraw+ rows are not invented: a row exists here
// because something on this page can honour it.
//
// # Why the menu is built here and not written in `index.html`
//
// The rows are the registry's rows. A hand-written row would be a second place
// where a command is named, and the second place is the one that drifts. The
// builder is a pure function over a declarative table, so the unit suite can
// read the structure without a browser, and the page calls it before anything
// that queries a row — the theme binder, the document binders and the image
// importer all find their controls in it.
//
// # The rows that are controls, and the rows that delegate
//
// A menu row is a button, and three kinds live here:
//
// - the file rows ARE the controls. The binders that read
//   `[data-open-document]`, `[data-save-document]`, `#export-svg`,
//   `#export-png` and `[data-import]` find them inside the panel, so there is
//   one control per action and no proxy to keep in step;
// - a command row delegates to `runCommand` (`clearCanvas`) or to a surface the
//   page already owns (the palette, the help sheet);
// - the preference rows are the registry's toggles, kept open across a choice
//   because a preferences menu that closed on every toggle would be a menu
//   opened once per preference.
//
// # The theme row is the control
//
// The theme row is the theme switch itself (`data-theme-toggle`), not a
// delegate: `client/theme.mjs` owns its state, and this binder only reads that
// state to say which mode the row leads to and which icon wears. The row stays
// open, as upstream's theme control does.

import { CHROME_ICONS } from "./chrome-icons.mjs";

/** The chevron the Preferences row wears, upstream's `dropdown-menu__submenu-trigger-icon`. */
const SUBMENU_CHEVRON = Object.freeze(
    '<svg aria-hidden="true" focusable="false" role="img" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6l-6 6"></path></svg>',
);

/**
 * The menu's rows, in upstream's order.
 *
 * `kind` says what a row is: `control` is a control the page's own binders
 * hold, `delegate` is a view of a surface the menu opens, `submenu` is a
 * group of preference rows and `theme` is the theme control. `icon` names the
 * iconary's drawing; `label` is the source word and the catalogues translate it
 * through the row's id, the same contract the markup rows had.
 */
export const CANVAS_MENU = Object.freeze([
    {
        name: "actions",
        rows: Object.freeze([
            {
                kind: "control",
                id: "canvas-menu-open",
                icon: "LoadIcon",
                label: "Open",
                title: "Open a drawing or PNG with an embedded scene",
                attributes: Object.freeze({ "data-open-document": "" }),
            },
            {
                kind: "control",
                id: "canvas-menu-save",
                icon: "save",
                label: "Save",
                title: "Download this drawing as an .excalidraw file",
                attributes: Object.freeze({ "data-save-document": "" }),
            },
            {
                kind: "control",
                id: "export-svg",
                icon: "ExportImageIcon",
                label: "Export SVG",
                title: "Download the drawing as an SVG — the selection alone when something is chosen; hold Shift for the canvas background",
            },
            {
                kind: "control",
                id: "export-png",
                icon: "ExportImageIcon",
                label: "Export PNG",
                title: "Download the drawing as a PNG — the selection alone when something is chosen; hold Shift for the canvas background",
            },
            {
                kind: "control",
                id: "canvas-menu-import-image",
                icon: "ImageIcon",
                label: "Import image",
                title: "Import an image",
                attributes: Object.freeze({ "data-import": "" }),
            },
            {
                kind: "control",
                id: "canvas-menu-recover",
                icon: "ExportIcon",
                label: "Recover",
                title: "Download a drawing that could not be opened",
                attributes: Object.freeze({ "data-recover-document": "", hidden: "" }),
            },
            {
                kind: "control",
                id: "canvas-menu-reload",
                icon: "LoadIcon",
                label: "Reload",
                title: "Reload the page into the new version",
                attributes: Object.freeze({ "data-reload-page": "", hidden: "" }),
            },
            {
                kind: "delegate",
                id: "canvas-menu-search",
                icon: "boltIcon",
                label: "Command palette",
                action: "search",
                shortcut: "Ctrl+Shift+P",
            },
            {
                kind: "delegate",
                id: "canvas-menu-help",
                icon: "HelpIcon",
                label: "Help",
                action: "help",
                shortcut: "?",
            },
            {
                kind: "delegate",
                id: "canvas-menu-clear-canvas",
                icon: "TrashIcon",
                label: "Clear canvas",
                action: "clearCanvas",
            },
        ]),
    },
    {
        name: "preferences",
        rows: Object.freeze([
            {
                kind: "submenu",
                id: "canvas-menu-preferences",
                icon: "settingsIcon",
                label: "Preferences",
                items: Object.freeze([
                    Object.freeze({ id: "toggleSnap", command: "toggleSnap" }),
                    Object.freeze({ id: "toggleGrid", command: "toggleGrid" }),
                    Object.freeze({ id: "zenMode", command: "zenMode" }),
                    Object.freeze({ id: "viewMode", command: "viewMode" }),
                    Object.freeze({ id: "stats", command: "stats" }),
                    Object.freeze({ id: "toggleMidpoint", command: "toggleMidpoint" }),
                    Object.freeze({ id: "canvas-menu-hints", label: "Show hints", toggleHints: true }),
                ]),
            },
            {
                kind: "theme",
                id: "theme-toggle",
                icon: "MoonIcon",
                label: "Dark mode",
                command: "toggleTheme",
                attributes: Object.freeze({ "data-theme-toggle": "" }),
            },
        ]),
    },
]);

/** The words the menu says itself; the registry supplies the rest. */
export function canvasMenuLabels({ text = (_key, source) => source, labelOf = (entry) => entry.label } = {}) {
    return {
        menu: text("ui.canvas-menu.label", "Canvas menu"),
        search: text("ui.canvas-menu-search.text", "Command palette"),
        preferences: text("ui.canvas-menu-preferences.text", "Preferences"),
        hints: text("ui.canvas-menu-hints.text", "Show hints"),
        themeLight: text("ui.canvas-menu-theme.lightMode", "Light mode"),
        themeDark: text("ui.canvas-menu-theme.darkMode", "Dark mode"),
        themeTitle: text("ui.canvas-menu-theme.title", "Turn the page dark or light"),
        help: text("ui.canvas-menu-help.text", "Help"),
        clearCanvas: labelOf({ id: "clearCanvas", label: "Clear canvas" }),
    };
}

/** One element with the classes upstream's menu uses. */
function make(createElement, tag, ...classes) {
    const element = createElement(tag);
    element.classList.add(...classes);
    return element;
}

/** The icon box upstream's `MenuItemContent` puts before the words. */
function iconBox(createElement, icon) {
    const box = make(createElement, "div", "dropdown-menu-item__icon");
    box.setAttribute("aria-hidden", "true");
    box.innerHTML = CHROME_ICONS[icon] ?? "";
    return box;
}

/** A row's visible words, in the box upstream ellipsises. */
function labelBox(createElement, label) {
    const text = make(createElement, "div", "dropdown-menu-item__text");
    text.textContent = label;
    return text;
}

/** A row's shortcut, at the far end of the row. */
function shortcutBox(createElement, shortcut) {
    const hint = make(createElement, "div", "dropdown-menu-item__shortcut");
    hint.textContent = shortcut;
    return hint;
}

/** One ordinary row: icon, words, and the shortcut when the verb owns one. */
function menuRow(createElement, spec) {
    const row = createElement("button");
    row.type = "button";
    row.id = spec.id;
    row.setAttribute("role", spec.toggleHints ? "menuitemcheckbox" : "menuitem");
    row.classList.add("dropdown-menu-item", "dropdown-menu-item-base");
    row.appendChild(iconBox(createElement, spec.icon));
    row.appendChild(labelBox(createElement, spec.label));
    if (spec.shortcut !== undefined) {
        row.appendChild(shortcutBox(createElement, spec.shortcut));
    }
    if (spec.title !== undefined) {
        row.setAttribute("title", spec.title);
    }
    if (spec.toggleHints === true) {
        row.setAttribute("data-action", "toggle-hints");
    }
    if (spec.command !== undefined) {
        row.setAttribute("data-menu-command", spec.command);
    }
    if (spec.action !== undefined) {
        row.setAttribute("data-menu-action", spec.action);
    }
    for (const [name, value] of Object.entries(spec.attributes ?? {})) {
        row.setAttribute(name, value);
        if (name === "hidden") {
            row.hidden = true;
        }
    }
    return row;
}

/** The divider upstream draws between two groups: one pixel, six above and below. */
function menuSeparator(createElement, id) {
    const rule = make(createElement, "div", "dropdown-menu-separator");
    rule.setAttribute("role", "separator");
    if (id !== undefined) {
        rule.id = id;
    }
    rule.style.height = "1px";
    rule.style.backgroundColor = "var(--default-border-color)";
    rule.style.margin = "6px 0";
    rule.style.flex = "0 0 auto";
    return rule;
}

/** The Preferences row and the submenu it opens. */
function submenuRow(createElement, spec) {
    const trigger = menuRow(createElement, { ...spec, kind: "submenu" });
    trigger.setAttribute("aria-haspopup", "menu");
    trigger.setAttribute("aria-expanded", "false");
    trigger.setAttribute("data-menu-submenu", spec.id);
    const chevron = make(createElement, "div", "dropdown-menu__submenu-trigger-icon");
    chevron.setAttribute("aria-hidden", "true");
    chevron.innerHTML = SUBMENU_CHEVRON;
    trigger.appendChild(chevron);

    const submenu = make(createElement, "div", "dropdown-menu-sub");
    submenu.setAttribute("role", "menu");
    submenu.setAttribute("aria-labelledby", spec.id);
    submenu.hidden = true;
    for (const item of spec.items) {
        submenu.appendChild(menuRow(createElement, { ...item, icon: "checkIcon" }));
    }
    return [trigger, submenu];
}

/**
 * Build the menu's DOM into the panel.
 *
 * Idempotent: a page that boots twice keeps the rows it built the first time.
 * The builder is deliberately independent of the page's words — `bindCanvasMenu`
 * localizes the labels — because it runs before the theme binder, the document
 * binders and the image importer, which all look their controls up by the ids
 * this function writes.
 *
 * @param {{ createElement: (tag: string) => Element, panel: Element }} options
 * @returns {Element | null} The panel, or `null` when there is nothing to build.
 */
export function buildCanvasMenu({ createElement, panel }) {
    if (panel === null || panel === undefined) {
        return null;
    }
    if (panel.dataset.menuBuilt === "true") {
        return panel;
    }
    const container = make(createElement, "div", "dropdown-menu-container");
    CANVAS_MENU.forEach((group, at) => {
        if (at > 0) {
            container.appendChild(menuSeparator(createElement, at === 1 ? "canvas-menu-separator" : undefined));
        }
        for (const spec of group.rows) {
            if (spec.kind === "submenu") {
                for (const node of submenuRow(createElement, spec)) {
                    container.appendChild(node);
                }
            } else {
                container.appendChild(menuRow(createElement, spec));
            }
        }
    });
    // The two file pickers the menu's own controls open. Hidden, and inside the
    // panel because the image importer looks its input up in this root.
    const openInput = createElement("input");
    openInput.setAttribute("type", "file");
    openInput.accept = ".excalidraw,application/vnd.excalidraw+json,.png,image/png";
    openInput.setAttribute("data-open-file", "");
    openInput.hidden = true;
    const importInput = createElement("input");
    importInput.setAttribute("type", "file");
    importInput.accept = "image/*";
    importInput.setAttribute("data-import-file", "");
    importInput.hidden = true;
    container.appendChild(openInput);
    container.appendChild(importInput);

    panel.replaceChildren(container);
    panel.dataset.menuBuilt = "true";
    return panel;
}

/**
 * Find the panel and build the menu into it, once.
 *
 * Called before anything that queries a row: the theme binder, the document
 * binders and the image importer.
 *
 * @param {Document} document the page's own.
 * @returns {Element | null}
 */
export function prepareCanvasMenu(document) {
    const panel = document.getElementById("canvas-menu-panel");
    if (panel === null) {
        return null;
    }
    return buildCanvasMenu({
        createElement: (tag) => document.createElement(tag),
        panel,
    });
}

/** Every visible top-level row of a container, in the order the keyboard walks it. */
function walkable(container) {
    if (container === null || container === undefined) {
        return [];
    }
    return Array.from(container.children).filter(
        (row) => row.tagName === "BUTTON" && row.hidden !== true && row.disabled !== true,
    );
}

/**
 * Bind the shell menu to the controls it holds.
 *
 * @param {object} options
 * @param {Element} options.trigger the hamburger.
 * @param {Element} options.panel the panel `prepareCanvasMenu` filled.
 * @param {() => void} [options.searchAction] opens the command palette.
 * @param {() => void} [options.helpAction] opens the help sheet.
 * @param {(id: string) => void} [options.run] runs a command by id.
 * @param {(id: string) => object | undefined} [options.commandOf] the command behind an id, for its label and shortcut.
 * @param {(entry: object) => string} [options.labelOf] the localized label of a command.
 * @param {(key: string, source: string) => string} [options.text] localized words.
 * @param {object} [options.labels] the words this binder owns.
 * @param {boolean} [options.hintsEnabled] whether the contextual hints are on.
 * @param {(enabled: boolean) => void} [options.onToggleHints] hears the hints toggle.
 * @param {Document} [options.doc] the document the outside press is heard on.
 * @param {AbortSignal} [options.signal] its abort takes every listener off.
 * @returns {{ close: () => void, isOpen: () => boolean }}
 */
export function bindCanvasMenu({
    trigger,
    panel,
    searchAction = () => {},
    helpAction = () => {},
    run = () => {},
    commandOf = () => undefined,
    labelOf = (entry) => entry.label,
    text = (_key, source) => source,
    labels,
    hintsEnabled = true,
    onToggleHints = () => {},
    doc = trigger?.ownerDocument,
    signal,
}) {
    if (trigger === null || trigger === undefined || panel === null || panel === undefined) {
        throw new Error("the canvas menu needs its trigger and its panel");
    }
    const words = labels ?? canvasMenuLabels({ text, labelOf });
    if (words.menu) {
        trigger.setAttribute("aria-label", words.menu);
    }
    if (typeof trigger.innerHTML === "string" && trigger.innerHTML === "" && trigger.children?.length === 0) {
        trigger.innerHTML = CHROME_ICONS.HamburgerMenuIcon;
    }

    const searchItem = panel.querySelector("#canvas-menu-search");
    const helpItem = panel.querySelector("#canvas-menu-help");
    const clearCanvasItem = panel.querySelector("#canvas-menu-clear-canvas");
    const themeItem = panel.querySelector("button[data-theme-toggle]");
    const preferencesTrigger = panel.querySelector("[data-menu-submenu]");
    const preferencesPanel = panel.querySelector(".dropdown-menu-sub");
    const hintsItem = preferencesPanel?.querySelector("[data-action='toggle-hints']") ?? null;

    // The words the registry owns. The file rows are the page's own controls
    // and `localizePage` words them; these rows have no action entry.
    if (searchItem !== null) searchItem.querySelector(".dropdown-menu-item__text").textContent = words.search;
    if (helpItem !== null) helpItem.querySelector(".dropdown-menu-item__text").textContent = words.help;
    if (clearCanvasItem !== null) {
        clearCanvasItem.querySelector(".dropdown-menu-item__text").textContent = words.clearCanvas;
        const command = commandOf("clearCanvas");
        if (command?.hint) {
            const box = clearCanvasItem.querySelector(".dropdown-menu-item__shortcut")
                ?? shortcutBox((tag) => trigger.ownerDocument.createElement(tag), command.hint);
            box.textContent = command.hint;
            if (box.parent === null || box.parent === undefined) clearCanvasItem.appendChild(box);
        }
    }
    if (preferencesTrigger !== null) {
        preferencesTrigger.querySelector(".dropdown-menu-item__text").textContent = words.preferences;
    }

    // A preference row is a view of the registry's verb: its label and its
    // shortcut come from the same entry the palette and the keyboard read.
    for (const item of preferencesPanel?.querySelectorAll("[data-menu-command]") ?? []) {
        const id = item.getAttribute("data-menu-command");
        const command = commandOf(id);
        if (command === undefined || command === null) continue;
        item.querySelector(".dropdown-menu-item__text").textContent = labelOf(command);
        if (command.hint) {
            const box = item.querySelector(".dropdown-menu-item__shortcut")
                ?? shortcutBox((tag) => trigger.ownerDocument.createElement(tag), command.hint);
            box.textContent = command.hint;
            if (box.parent === null || box.parent === undefined) item.appendChild(box);
        }
    }
    if (hintsItem !== null) {
        hintsItem.querySelector(".dropdown-menu-item__text").textContent = words.hints;
        hintsItem.setAttribute("aria-checked", hintsEnabled ? "true" : "false");
    }

    let outsideListening = false;
    const onOutsidePointerDown = (event) => {
        if (panel.contains(event.target) || trigger.contains(event.target)) {
            return;
        }
        close();
    };
    const setOpen = (open) => {
        const wasOpen = panel.hidden === false;
        panel.hidden = !open;
        trigger.setAttribute("aria-expanded", String(open));
        if (!open) {
            setSubmenu(false);
        }
        if (doc === null || doc === undefined) {
            return;
        }
        if (open && !wasOpen && !outsideListening) {
            doc.addEventListener("pointerdown", onOutsidePointerDown, { capture: true, signal });
            outsideListening = true;
        } else if (!open && wasOpen && outsideListening) {
            doc.removeEventListener("pointerdown", onOutsidePointerDown, true);
            outsideListening = false;
        }
    };
    const isOpen = () => panel.hidden === false;

    let submenuOpen = false;
    function setSubmenu(open) {
        if (preferencesTrigger === null || preferencesPanel === null) {
            submenuOpen = false;
            return;
        }
        submenuOpen = open;
        preferencesTrigger.setAttribute("aria-expanded", String(open));
        preferencesTrigger.classList.toggle("is-open", open);
        preferencesPanel.hidden = !open;
    }

    function close({ restoreFocus = false } = {}) {
        if (!isOpen()) {
            return;
        }
        setOpen(false);
        if (restoreFocus) {
            trigger.focus();
        }
    }

    /**
     * Move the focus within the visible rows of `container` by `step`, wrapping.
     * An arrow key is the menu's own grammar: upstream walks its rows with them.
     */
    function move(container, step) {
        if (container === null) return;
        const rows = walkable(container);
        if (rows.length === 0) return;
        const at = rows.indexOf(trigger.ownerDocument.activeElement);
        const from = at === -1 ? 0 : at;
        rows[(from + step + rows.length) % rows.length].focus();
    }

    /** The theme row's words and drawing are read from the theme's own state. */
    function syncTheme() {
        if (themeItem === null) return;
        const dark = themeItem.getAttribute("aria-pressed") === "true"
            || trigger.ownerDocument?.documentElement?.dataset?.theme === "dark";
        const label = themeItem.querySelector(".dropdown-menu-item__text");
        if (label !== null) label.textContent = dark ? words.themeLight : words.themeDark;
        themeItem.setAttribute("title", words.themeTitle);
        themeItem.setAttribute("aria-label", dark ? words.themeLight : words.themeDark);
        themeItem.classList.toggle("is-active", dark);
        const icon = themeItem.querySelector(".dropdown-menu-item__icon");
        if (icon !== null) icon.innerHTML = dark ? CHROME_ICONS.SunIcon : CHROME_ICONS.MoonIcon;
        const command = commandOf("toggleTheme");
        if (command?.hint) {
            const shortcut = themeItem.querySelector(".dropdown-menu-item__shortcut")
                ?? shortcutBox((tag) => trigger.ownerDocument.createElement(tag), command.hint);
            shortcut.textContent = command.hint;
            if (shortcut.parent === null || shortcut.parent === undefined) themeItem.appendChild(shortcut);
        }
    }

    // The trigger.
    trigger.addEventListener("click", () => {
        if (isOpen()) {
            close();
        } else {
            setOpen(true);
        }
    }, { signal });

    // The delegates: the palette, the help sheet and the confirmed clear.
    const delegates = new Map([
        ["search", searchAction],
        ["help", helpAction],
        ["clearCanvas", () => run("clearCanvas")],
    ]);
    for (const item of panel.querySelectorAll("[data-menu-action]")) {
        item.addEventListener("click", () => {
            const action = item.getAttribute("data-menu-action");
            close();
            delegates.get(action)?.();
        }, { signal });
    }

    // Every file row closes the menu; its own binder owns what it does.
    for (const selector of ["[data-open-document]", "[data-save-document]", "[data-import]", "[data-recover-document]", "[data-reload-page]", "#export-svg", "#export-png"]) {
        for (const item of panel.querySelectorAll(selector)) {
            item.addEventListener("click", () => close(), { signal });
        }
    }

    // The theme row is the control itself; `client/theme.mjs` toggles it first,
    // and this listener only re-words the row after the state moved.
    themeItem?.addEventListener("click", syncTheme, { signal });

    // Preferences: a row that opens a group of toggles and keeps the menu open,
    // because a person changing a preference usually changes another one.
    preferencesTrigger?.addEventListener("click", () => {
        setSubmenu(!submenuOpen);
        if (submenuOpen) {
            walkable(preferencesPanel)[0]?.focus();
        }
    }, { signal });

    for (const item of panel.querySelectorAll("[data-menu-command]")) {
        // The theme row is the control itself: `client/theme.mjs` owns its
        // click and toggles it, and running the verb here as well would
        // toggle the page twice per press.
        if (item === themeItem) continue;
        item.addEventListener("click", () => {
            run(item.getAttribute("data-menu-command"));
        }, { signal });
    }

    if (hintsItem !== null) {
        let enabled = hintsEnabled;
        const syncHints = () => {
            hintsItem.setAttribute("aria-checked", enabled ? "true" : "false");
            hintsItem.classList.toggle("is-checked", enabled);
        };
        syncHints();
        hintsItem.addEventListener("click", () => {
            enabled = !enabled;
            syncHints();
            onToggleHints(enabled);
        }, { signal });
    }

    // The keyboard: arrows walk the rows, Home and End jump, Escape leaves the
    // submenu first and the menu second, and Tab is the browser's.
    panel.addEventListener("keydown", (event) => {
        const inSubmenu = preferencesPanel !== null && preferencesPanel.contains(event.target);
        if (event.key === "Escape") {
            event.preventDefault?.();
            event.stopPropagation?.();
            if (submenuOpen) {
                setSubmenu(false);
                preferencesTrigger.focus();
            } else {
                close({ restoreFocus: true });
            }
            return;
        }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault?.();
            event.stopPropagation?.();
            move(inSubmenu ? preferencesPanel : panel.querySelector(".dropdown-menu-container"), event.key === "ArrowDown" ? 1 : -1);
            return;
        }
        if (event.key === "Home" || event.key === "End") {
            event.preventDefault?.();
            event.stopPropagation?.();
            const container = inSubmenu ? preferencesPanel : panel.querySelector(".dropdown-menu-container");
            const rows = walkable(container);
            if (rows.length > 0) rows[event.key === "Home" ? 0 : rows.length - 1].focus();
            return;
        }
        const onPreferences = event.target === preferencesTrigger || preferencesTrigger?.contains(event.target) === true;
        if (onPreferences && event.key === "ArrowRight") {
            event.preventDefault?.();
            setSubmenu(true);
            walkable(preferencesPanel)[0]?.focus();
        }
    }, { signal });

    // The press outside closes the menu, and only while it is open: the
    // listener is added by the open, not by the bind.
    syncTheme();
    setOpen(false);

    return { close: () => close(), isOpen };
}

