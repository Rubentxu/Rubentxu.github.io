// The welcome screen: upstream's `WelcomeScreen` over an empty canvas.
//
// # What this is
//
// Upstream draws a welcome screen while the canvas is empty and the selection
// tool is armed: a mark and a heading in the middle, a menu of things to do,
// and three hand-drawn hints that point at the menu, the tool island and the
// help corner (`packages/excalidraw/components/welcome-screen/`). The screen
// is gone the moment the document holds an element — or the moment a drawing
// tool is armed, which is upstream's condition too
// (`App.tsx`: `renderWelcomeScreen = … activeTool.type === preferredSelectionTool.type
// && !scene.getElementsIncludingDeleted().length`). It comes back when the
// last element is removed, because upstream sets `showWelcomeScreen` back on an
// empty scene (`components/App.tsx`'s `componentDidUpdate`).
//
// # What it is not
//
// Not a modal and not a layer that owns the canvas. The centre is
// `pointer-events: none`, so a press anywhere but a menu row is a press on the
// drawing; only the two rows opt back into the pointer, which is what
// `--ui-pointerEvents` does upstream. The hints are decoration and never take
// the pointer either.
//
// # What is not ported
//
// Upstream's reference application adds two rows this port has no product for:
// `Live collaboration` (a room dialog) and `Sign up` (Excalidraw+). The port
// has neither a room dialog nor a paid plan, so the menu carries the two rows
// the open-source screen carries — Open and Help — and the heading is the
// reference's own browser-storage notice, which is true of this page too
// (`client/persist-wiring.mjs`). The capture (`scripts/welcome-capture.mjs`)
// names the missing rows as out of scope instead of pretending they match.
//
// # Why the drawings are generated
//
// The three hint arrows and the menu rows' icons are the iconary's
// (`client/chrome-icons.mjs`, generated from the tarball). The logo is the one
// pair the iconary does not hold — `ExcalidrawLogo.tsx` draws it outside
// `icons.tsx` — so the generator now writes `WELCOME_LOGO` from the same
// tarball. Nothing here is a hand-copied SVG.

import { CHROME_ICONS, WELCOME_LOGO } from "./chrome-icons.mjs";
import { spellKey } from "./keys.mjs";
import { TOOLS } from "./tools.mjs";

/** The class the centre wears, upstream's own name. */
const CENTER_CLASS = "welcome-screen-center";

/** The drawing that says "look here", by the hint that points with it. */
export const WELCOME_HINT_ICONS = Object.freeze({
    menu: "WelcomeScreenMenuArrow",
    toolbar: "WelcomeScreenTopToolbarArrow",
    help: "WelcomeScreenHelpArrow",
});

/** The identifier each part installs under, so a second mount replaces instead of stacking. */
export const WELCOME_IDS = Object.freeze({
    center: "welcome-screen",
    menuHint: "welcome-screen-menu-hint",
    toolbarHint: "welcome-screen-toolbar-hint",
    helpHint: "welcome-screen-help-hint",
});

/**
 * Whether the welcome screen belongs on the canvas.
 *
 * The one rule, in a function, because the paint and the tests both ask it:
 * upstream's condition with the two facts this page has — an empty document
 * and the selection tool. A drawing tool is a person about to draw, not a
 * person to welcome; an element is a drawing already made.
 *
 * @param {{empty: boolean, tool: string, zen?: boolean}} state the document, the
 *   armed tool and whether zen mode has taken the chrome away.
 * @returns {boolean} whether upstream would draw the welcome screen.
 */
export function welcomeIsVisible({ empty, tool, zen }) {
    return empty === true && tool === TOOLS.selection && zen !== true;
}

/**
 * The words, as `[key, source]`, so a locale can translate them and the page
 * still has a sentence when it cannot.
 *
 * The Spanish and Arabic catalogues carry upstream's own translations
 * (`packages/excalidraw/locales/es-ES.json`, `ar-SA.json`), read here under
 * this page's string keys; the source is upstream's English.
 */
const WORDS = Object.freeze({
    heading1: ["welcomeScreen.center_heading", "Your drawings are saved in your browser's storage."],
    heading2: ["welcomeScreen.center_heading_line2", "Browser storage can be cleared unexpectedly."],
    heading3: ["welcomeScreen.center_heading_line3", "Save your work to a file regularly to avoid losing it."],
    open: ["buttons.load", "Open"],
    help: ["helpDialog.title", "Help"],
    menuHint: ["welcomeScreen.menuHint", "Export, preferences, languages, ..."],
    toolbarHint: ["welcomeScreen.toolbarHint", "Pick a tool & Start drawing!"],
    helpHint: ["welcomeScreen.helpHint", "Shortcuts & help"],
});

/** The shortcut the Open row spells, from the same table the tooltips read. */
const OPEN_SHORTCUT = spellKey({ key: "o", mod: true });

/**
 * Run a class string through `classList`.
 *
 * The classes are the stylesheet's selectors and the world's names for the
 * parts; a string is how the markup writes them, and `classList` is how a
 * page writes them without making `className` a second source of truth.
 *
 * @param {Element} node
 * @param {string} names
 * @returns {void}
 */
function addClasses(node, names) {
    node.classList.add(...names.split(/\s+/).filter((name) => name !== ""));
}

/**
 * Create one element with its classes.
 *
 * @param {Document} document
 * @param {string} tag
 * @param {string} classes
 * @returns {Element}
 */
function make(document, tag, classes) {
    const node = document.createElement(tag);
    if (classes !== "") {
        addClasses(node, classes);
    }
    return node;
}

/**
 * Find a node by id inside the mount, or nowhere.
 *
 * @param {Element} root
 * @param {string} id
 * @returns {Element | null}
 */
function byId(root, id) {
    return root.querySelector(`#${id}`);
}

/**
 * Put a node under a parent, once.
 *
 * A browser's `appendChild` moves a node that already has a parent, but the
 * page's fake DOM keeps it where it was and appends a second reference — and a
 * second mount is a thing that happens (a panic rebuild). The question is the
 * same in both: is this node already here?
 *
 * @param {Element} parent
 * @param {Element} child
 * @returns {void}
 */
function attach(parent, child) {
    const holder = child.parentNode ?? child.parent ?? null;
    if (holder !== parent) {
        parent.appendChild(child);
    }
}

/**
 * One menu row, in upstream's three-column grid: drawing, words, shortcut.
 *
 * @param {object} options
 * @param {Document} options.document
 * @param {string} options.action what the row does, for the `data-` token.
 * @param {string} options.icon the iconary's drawing.
 * @param {string} options.label the row's words.
 * @param {string} [options.shortcut] the key, when upstream prints one.
 * @param {(event: Event) => void} options.onSelect
 * @param {AbortSignal} [options.signal]
 * @returns {Element} the button.
 */
function menuRow({ document, action, icon, label, shortcut, onSelect, signal }) {
    const button = make(document, "button", "welcome-screen-menu-item");
    button.setAttribute("type", "button");
    button.setAttribute("data-welcome-action", action);

    const drawing = make(document, "div", "welcome-screen-menu-item__icon");
    drawing.setAttribute("aria-hidden", "true");
    drawing.innerHTML = CHROME_ICONS[icon];

    const words = make(document, "div", "welcome-screen-menu-item__text");
    words.textContent = label;

    button.appendChild(drawing);
    button.appendChild(words);
    if (typeof shortcut === "string" && shortcut !== "") {
        const key = make(document, "div", "welcome-screen-menu-item__shortcut");
        key.textContent = shortcut;
        button.appendChild(key);
    }
    button.addEventListener("click", onSelect, { signal });
    // A native button activates on Enter and Space; this page's keyboard
    // claims both for the canvas (Enter opens the editor the hint names,
    // Space pans), so the row answers the two keys itself and keeps them
    // from reaching the canvas while it has the focus.
    button.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        onSelect(event);
    }, { signal });
    return button;
}

/**
 * Fill one hint box: the reference's arrow and a hand-written sentence.
 *
 * The box is the stable part — a second mount finds it by id and fills it
 * again rather than stacking a second hint — so this function takes the box
 * and replaces what is inside it.
 *
 * @param {object} options
 * @param {Document} options.document
 * @param {Element} options.box the hint's box, already placed or not.
 * @param {"menu" | "toolbar" | "help"} options.where which hint this is.
 * @param {string} options.label the sentence.
 * @returns {void}
 */
function fillHint({ document, box, where, label }) {
    box.replaceChildren();

    const words = make(document, "div", where === "help" ? "" : "welcome-screen-decor-hint__label");
    words.textContent = label;

    // The arrow points at the surface: before the words for the menu (the
    // menu is above-left), after them for the toolbar and help (the arrow
    // comes up from below-right). That is upstream's order in each hint.
    const arrow = make(document, "span", "welcome-screen-decor-hint__arrow");
    arrow.setAttribute("aria-hidden", "true");
    arrow.innerHTML = CHROME_ICONS[WELCOME_HINT_ICONS[where]];
    if (where === "menu") {
        box.appendChild(arrow);
        box.appendChild(words);
    } else {
        box.appendChild(words);
        box.appendChild(arrow);
    }
    // A hint is decoration: it points and never enters the reading order or
    // takes the pointer. The sentence is repeated by the surface it points at.
    box.setAttribute("aria-hidden", "true");
}

/**
 * Build the welcome screen into a mount, once, and answer its handle.
 *
 * Every part is optional: a mount that lacks `#paper`, `#canvas-menu`,
 * `#toolbar` or `#footer-right` gets the parts it can hold, because an
 * embedder's markup is its own and a welcome screen that refused the whole
 * mount over a hint would be a bigger failure than the one it reports.
 *
 * @param {object} options
 * @param {Document} options.document the page's own.
 * @param {Element} options.root the mount's root.
 * @param {(key: string, source: string) => string} options.text the locale's words.
 * @param {() => void} options.onOpen the Open row's door.
 * @param {() => void} options.onHelp the Help row's door.
 * @param {AbortSignal} [options.signal] when it aborts, the rows stop listening.
 * @returns {{sync: (state: {empty: boolean, tool: string}) => boolean, center: Element | null, hints: object, rows: Element[]}} the handle.
 */
export function createWelcomeScreen({ document, root, text, onOpen, onHelp, signal }) {
    const say = (key) => text(WORDS[key][0], WORDS[key][1]);

    const center = byId(root, WELCOME_IDS.center) ?? make(document, "div", CENTER_CLASS);
    center.classList.add(CENTER_CLASS);
    center.id = WELCOME_IDS.center;
    center.replaceChildren();
    center.setAttribute("data-visible", "false");

    const logo = make(document, "div", "welcome-screen-center__logo excalifont welcome-screen-decor");
    logo.setAttribute("aria-hidden", "true");
    logo.innerHTML = `<div class="ExcalidrawLogo is-small">${WELCOME_LOGO.icon}${WELCOME_LOGO.text}</div>`;

    const heading = make(document, "div", "welcome-screen-center__heading welcome-screen-decor excalifont");
    for (const line of ["heading1", "heading2", "heading3"]) {
        const row = make(document, "span", "welcome-screen-center__heading-line");
        row.textContent = say(line);
        heading.appendChild(row);
    }

    const menu = make(document, "div", "welcome-screen-menu");
    const rows = [
        menuRow({
            document, action: "open", icon: "LoadIcon", label: say("open"),
            shortcut: OPEN_SHORTCUT, onSelect: () => onOpen(), signal,
        }),
        menuRow({
            document, action: "help", icon: "HelpIcon", label: say("help"),
            shortcut: "?", onSelect: () => onHelp(), signal,
        }),
    ];
    menu.append(...rows);

    center.appendChild(logo);
    center.appendChild(heading);
    center.appendChild(menu);

    const paper = byId(root, "paper") ?? root;
    attach(paper, center);

    const hints = {};
    const anchors = {
        menu: byId(root, "canvas-menu"),
        toolbar: byId(root, "tool-toolbar"),
        help: byId(root, "footer-right"),
    };
    for (const [where, parent] of Object.entries(anchors)) {
        if (parent === null) {
            continue;
        }
        let box = byId(root, WELCOME_IDS[`${where}Hint`]);
        if (box === null) {
            box = make(document, "div", "");
            box.id = WELCOME_IDS[`${where}Hint`];
        }
        addClasses(box, `excalifont welcome-screen-decor welcome-screen-decor-hint welcome-screen-decor-hint--${where}`);
        fillHint({ document, box, where, label: say(`${where}Hint`) });
        box.setAttribute("data-visible", "false");
        attach(parent, box);
        hints[where] = box;
    }

    return {
        center,
        hints,
        rows,
        /**
         * Put the screen where the state says it belongs.
         *
         * @param {{empty: boolean, tool: string, zen?: boolean}} state
         * @returns {boolean} whether it is visible.
         */
        sync(state) {
            const visible = welcomeIsVisible(state);
            const value = String(visible);
            if (center.getAttribute("data-visible") !== value) {
                center.setAttribute("data-visible", value);
                for (const hint of Object.values(hints)) {
                    hint.setAttribute("data-visible", value);
                }
            }
            return visible;
        },
    };
}
