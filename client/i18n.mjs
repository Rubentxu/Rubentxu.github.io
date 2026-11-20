// Locales: which language the interface speaks, and which way it reads.
//
// # What is translated, and what is not
//
// Only the *words a person reads* are translated, and they are looked up by the
// command's id. The id itself, the shortcut (`hint`), the predicates and every
// name that crosses the wasm boundary or the file format stay exactly as the
// registry writes them: a translated `data-command` would be a verb the kernel
// has never heard of.
//
// # Why English is not in a catalog
//
// The registry already carries an English label for every verb. A second copy
// of those words in an `en` catalog would be a place where the label and its
// translation can disagree, so English is the *source*: a locale that does not
// translate a verb, or a locale nobody knows, answers with the registry's own
// label. That is the whole fallback, and it is deterministic because the last
// step cannot fail.
//
// # Resolution
//
// A request is a language tag such as `es-MX` or `ar`. It resolves to the first
// supported locale among: the tag itself, then its language part, then the
// default. Case is ignored and an underscore is read as a hyphen, because tags
// come from URLs and from `navigator.language`, and neither is consistent.

import { TOOL_BUTTONS, shortcutLabelFor } from "./tools.mjs";
import { buttonText, composeTitle } from "./tool-toolbar.mjs";

/** The locale the registry's own labels are written in. */
export const DEFAULT_LOCALE = "en";

/** Scripts read right to left. A language, not a region, decides it. */
const RIGHT_TO_LEFT = Object.freeze(new Set(["ar", "he", "fa", "ur"]));

/**
 * The supported locale a request resolves to.
 *
 * @param {unknown} requested A language tag, or anything else.
 * @param {readonly string[]} supported The locales that have a catalog.
 * @returns {string} A supported locale, or the default.
 */
export function resolveLocale(requested, supported) {
    if (typeof requested !== "string") {
        return DEFAULT_LOCALE;
    }
    const tag = requested.trim().toLowerCase().replace(/_/g, "-");
    if (tag === "") {
        return DEFAULT_LOCALE;
    }
    if (supported.includes(tag)) {
        return tag;
    }
    const language = tag.split("-")[0];
    return supported.includes(language) ? language : DEFAULT_LOCALE;
}

/**
 * Which way a locale reads.
 *
 * @param {string} locale
 * @returns {"ltr" | "rtl"}
 */
export function directionOf(locale) {
    return RIGHT_TO_LEFT.has(String(locale).toLowerCase().split("-")[0]) ? "rtl" : "ltr";
}

/**
 * The function that says what a command is called in a locale.
 *
 * A verb the catalog does not name falls back to the registry's label, never to
 * `undefined` and never to the id: a half-translated menu is still a menu a
 * person can read.
 *
 * @param {Readonly<Record<string, Readonly<Record<string, string>>>>} catalogs
 *     Command id to text, per locale.
 * @param {string} locale A locale, resolved or not.
 * @returns {(command: { id: string, label: string }) => string}
 */
export function labelOf(catalogs, locale) {
    const resolved = resolveLocale(locale, Object.keys(catalogs));
    const catalog = Object.hasOwn(catalogs, resolved) ? catalogs[resolved] : {};
    return (command) =>
        Object.hasOwn(catalog, command.id) && typeof catalog[command.id] === "string"
            ? catalog[command.id]
            : command.label;
}

/**
 * The counted form of a sentence, chosen by the locale's own plural rule.
 *
 * `Intl.PluralRules` is the browser's table of how a language counts — the same
 * authority upstream uses — and the catalogue carries one key per category it
 * selects. A language that has a form the catalogue lacks falls back to its
 * `other` key, and the English `sources` cover the case of a locale with no
 * catalogue at all (the source language), so a page without a translation
 * still counts correctly.
 *
 * @param {Readonly<Record<string, Readonly<Record<string, string>>>>} catalogs
 * @param {string} locale
 * @returns {(key: string, count: number, sources?: Record<string, string>, values?: Record<string, string | number>) => string}
 */
export function createPlural(catalogs, locale) {
    const rules = new Intl.PluralRules(locale);
    return (key, count, sources = {}, values = {}) => {
        const category = rules.select(count);
        const source = sources[category] ?? sources.other ?? "{count}";
        const template = textOf(catalogs, locale, `${key}.${category}`, textOf(catalogs, locale, `${key}.other`, source));
        return formatText(template, { count, ...values });
    };
}

/**
 * Fill a template's `{name}` holes with the values it names.
 *
 * A hole with no value stays as written: a sentence that silently loses a word
 * is worse than a sentence that shows the hole.
 *
 * @param {string} template the sentence.
 * @param {Record<string, string | number>} [values] what the holes name.
 * @returns {string}
 */
export function formatText(template, values = {}) {
    return String(template).replace(/\{(\w+)\}/g, (whole, name) =>
        Object.hasOwn(values, name) ? String(values[name]) : whole,
    );
}

/**
 * The text of one interface string, with the same fallback.
 *
 * @param {Readonly<Record<string, Readonly<Record<string, string>>>>} catalogs
 * @param {string} locale
 * @param {string} key
 * @param {string} source The default-locale text, which is also the fallback.
 * @returns {string}
 */
export function textOf(catalogs, locale, key, source) {
    const resolved = resolveLocale(locale, Object.keys(catalogs));
    const catalog = Object.hasOwn(catalogs, resolved) ? catalogs[resolved] : {};
    return Object.hasOwn(catalog, key) && typeof catalog[key] === "string" ? catalog[key] : source;
}

/**
 * Translate the accessible name of every landmark the page declares.
 *
 * A landmark is an element that has both an `id` and an `aria-label`; the id is
 * the key (`aria.<id>`) and the label written in the page is the English source
 * and the fallback. A screen reader announces that label, so a page whose
 * `lang` says Arabic and whose groups are still announced in English is only
 * half localized. Nothing but the attribute is touched: ids, roles and
 * `data-*` names are the contract the rest of the client reads.
 *
 * @param {{ querySelectorAll: (selector: string) => Iterable<Element> }} root
 * @param {Readonly<Record<string, Readonly<Record<string, string>>>>} catalogs
 * @param {string} locale
 * @returns {number} How many labels now differ from their source.
 */
export function localizeLandmarks(root, catalogs, locale) {
    let changed = 0;
    for (const element of root.querySelectorAll("[id][aria-label]")) {
        const source = element.getAttribute("aria-label");
        const text = textOf(catalogs, locale, `aria.${element.getAttribute("id")}`, source);
        if (text !== source) {
            element.setAttribute("aria-label", text);
            changed += 1;
        }
    }
    return changed;
}

/**
 * Translate the three things a button says: its `aria-label`, its `title` and
 * its visible words, under `<prefix>.label|title|text`. A part the button does
 * not have is not invented, and a part the catalog does not have stays as the
 * page wrote it.
 *
 * @param {Element} button
 * @param {Readonly<Record<string, Readonly<Record<string, string>>>>} catalogs
 * @param {string} locale
 * @param {string} prefix
 * @returns {number} How many parts now differ from their source.
 */
function localizeParts(button, catalogs, locale, prefix) {
    let changed = 0;
    for (const [part, name] of [["label", "aria-label"], ["title", "title"]]) {
        const source = button.getAttribute(name);
        if (source === null || source === undefined) {
            continue;
        }
        const text = textOf(catalogs, locale, `${prefix}.${part}`, source);
        if (text !== source) {
            button.setAttribute(name, text);
            changed += 1;
        }
    }
    // The shell menu's rows are built by `client/canvas-menu.mjs`: their words
    // live in a box in front of the icon and the shortcut. Replacing the
    // button's whole `textContent` would take the drawing and the key with it,
    // so the box is the part a translation writes.
    const menuLabel = button.querySelector?.(".dropdown-menu-item__text") ?? null;
    const current = menuLabel === null ? button.textContent : menuLabel.textContent;
    const words = textOf(catalogs, locale, `${prefix}.text`, current);
    if (words !== current) {
        if (menuLabel !== null) {
            menuLabel.textContent = words;
        } else {
            // The style rows' buttons carry their drawing in front of the label
            // (`client/style-icons.mjs`); replacing `textContent` would take the
            // drawing with it. The decorations are put back where they were, so a
            // translated label and its icon are both on the button.
            const drawings = Array.from(button.children ?? []).filter(
                (child) => typeof child.classList?.contains === "function" && child.classList.contains("style-icon"),
            );
            button.textContent = words;
            for (const drawing of drawings) {
                button.insertBefore(drawing, button.firstChild ?? null);
            }
        }
        changed += 1;
    }
    return changed;
}

/**
 * The attributes that name a button whose value is its stable identity. The
 * page's own scripts find these buttons by `data-<attribute>`, so the pair is
 * the key and the words are free to change.
 */
export const CONTROL_ATTRIBUTES = Object.freeze([
    "history",
    "zoom",
    "fill",
    "stroke",
    "line-width",
    "roughness",
    "edges",
]);

/**
 * Translate the words of the buttons the page identifies by `data-<attribute>`.
 *
 * The key is `ui.<attribute>.<value>.<part>`, where the part is `label` (the
 * `aria-label`), `title` or `text` (the visible words). Each part falls back to
 * what the page already says, and a part the button does not have is not
 * invented: a button with no `aria-label` is not given one. The text of a
 * button is only replaced when the catalog has an entry for it, so a glyph such
 * as `+` or `100%` stays what the page wrote.
 *
 * @param {{ querySelectorAll: (selector: string) => Iterable<Element> }} root
 * @param {Readonly<Record<string, Readonly<Record<string, string>>>>} catalogs
 * @param {string} locale
 * @returns {number} How many parts now differ from their source.
 */
export function localizeControls(root, catalogs, locale) {
    let changed = 0;
    for (const attribute of CONTROL_ATTRIBUTES) {
        for (const button of root.querySelectorAll(`button[data-${attribute}]`)) {
            const value = button.getAttribute(`data-${attribute}`);
            changed += localizeParts(button, catalogs, locale, `ui.${attribute}.${value}`);
        }
    }
    return changed;
}

/**
 * The elements that have no value to key them by: a flag attribute the page's
 * scripts look them up by, an id, or the `for` of a label. The key names the
 * element, so `ui.<key>.label|title|text`; a part the element lacks is skipped.
 */
export const ACTIONS = Object.freeze([
    { key: "open-document", selector: "button[data-open-document]" },
    { key: "save-document", selector: "button[data-save-document]" },
    { key: "recover-document", selector: "button[data-recover-document]" },
    { key: "reload-page", selector: "button[data-reload-page]" },
    // The install offer is a control of its own and not a row of the canvas
    // menu: that menu is the reference's list, row for row, and the pinned
    // comparison asserts its rows exactly. The offer lives in a band of its
    // own, so it names its own label, title and words.
    { key: "install-app", selector: "button[data-install-app]" },
    { key: "import", selector: "button[data-import]" },
    { key: "export-svg", selector: "button[id='export-svg']" },
    { key: "export-png", selector: "button[id='export-png']" },
    { key: "canvas-menu", selector: "button[id='canvas-menu-trigger']" },
    { key: "share", selector: "button[data-share]" },
    { key: "library-trigger", selector: "button[data-library-trigger]" },
    { key: "canvas-menu-search", selector: "button[id='canvas-menu-search']" },
    { key: "canvas-menu-help", selector: "button[id='canvas-menu-help']" },
    // The footer's "?" is a second door to the same sheet (TASK-215); it is
    // a button of its own, so it names its own label and title.
    { key: "footer-help", selector: "button[data-help]" },
    // The style panel's legends: each row of upstream's selected-shape actions
    // is a fieldset whose legend names it, and a legend is text, not a label.
    { key: "style-stroke", selector: "legend[id='style-stroke-legend']" },
    { key: "style-background", selector: "legend[id='style-background-legend']" },
    { key: "style-fill", selector: "legend[id='style-fill-legend']" },
    { key: "style-width", selector: "legend[id='style-width-legend']" },
    { key: "style-stroke-style", selector: "legend[id='style-stroke-style-legend']" },
    { key: "style-sloppiness", selector: "legend[id='style-sloppiness-legend']" },
    { key: "style-edges", selector: "legend[id='style-edges-legend']" },
    { key: "style-arrow-type", selector: "legend[id='style-arrow-type-legend']" },
    { key: "style-font-family", selector: "legend[id='style-font-family-legend']" },
    { key: "style-font-size", selector: "legend[id='style-font-size-legend']" },
    { key: "style-text-align", selector: "legend[id='style-text-align-legend']" },
    { key: "style-vertical-align", selector: "legend[id='style-vertical-align-legend']" },
    { key: "style-arrowheads", selector: "legend[id='style-arrowheads-legend']" },
    { key: "style-opacity", selector: "legend[id='style-opacity-legend']" },
    { key: "style-layers", selector: "legend[id='style-layers-legend']" },
    { key: "style-align", selector: "legend[id='style-align-legend']" },
    { key: "style-actions", selector: "legend[id='style-actions-legend']" },
    { key: "opacity", selector: "label[for='opacity']" },
    { key: "stroke-colour", selector: "label[for='stroke-colour']" },
    { key: "background-colour", selector: "label[for='background-colour']" },
    { key: "text-size", selector: "label[for='text-size']" },
    // The word the width row says when the selected widths disagree.
    { key: "style-mixed", selector: "span[data-style-mixed]" },
]);

/**
 * Translate the words of the elements in `ACTIONS`, with the same rules as
 * `localizeControls`.
 *
 * @param {{ querySelectorAll: (selector: string) => Iterable<Element> }} root
 * @param {Readonly<Record<string, Readonly<Record<string, string>>>>} catalogs
 * @param {string} locale
 * @returns {number} How many parts now differ from their source.
 */
export function localizeActions(root, catalogs, locale) {
    let changed = 0;
    for (const { key, selector } of ACTIONS) {
        for (const button of root.querySelectorAll(selector)) {
            changed += localizeParts(button, catalogs, locale, `ui.${key}`);
        }
    }
    return changed;
}

/**
 * Translate the tool buttons, which the page builds from `TOOL_BUTTONS` rather
 * than writing in the markup. A button says a name and a `title`; the title is
 * the name and the shortcut (`Tools.tsx:290`: `${label} — ${shortcut}`), so the
 * catalog holds the name (`ui.tool.<tool>.text`) and the locale's "or"
 * (`ui.tool.or`), while the keys stay derived from the table that answers the
 * keyboard. A piece the catalog lacks stays as the page wrote it.
 *
 * @param {{ querySelectorAll: (selector: string) => Iterable<Element> }} root
 * @param {Readonly<Record<string, Readonly<Record<string, string>>>>} catalogs
 * @param {string} locale
 * @returns {number} How many parts now differ from their source.
 */
export function localizeTools(root, catalogs, locale) {
    let changed = 0;
    const or = textOf(catalogs, locale, "ui.tool.or", "or");
    for (const { tool } of TOOL_BUTTONS) {
        const name = textOf(catalogs, locale, `ui.tool.${tool}.text`, buttonText(tool));
        const shortcut = shortcutLabelFor(tool, or);
        for (const button of root.querySelectorAll(`button[data-tool='${tool}']`)) {
            // The icon button's name is its aria-label; the drawing is the
            // visible content and no locale rewrites it. Writing
            // `textContent` — what this loop did when the buttons were
            // words — would replace the iconary's SVG with the word, and a
            // toolbar of words is the toolbar this card came to retire.
            if (button.getAttribute("aria-label") !== name) {
                button.setAttribute("aria-label", name);
                changed += 1;
            }
            const title = composeTitle(name, shortcut);
            if (button.getAttribute("title") !== title) {
                button.setAttribute("title", title);
                changed += 1;
            }
        }
    }
    return changed;
}

/**
 * Localize the page's landmarks, controls, actions and tools in one pass.
 *
 * The four tables share the catalogue and the locale, and a page that ran
 * three of them would be a page half in one language; the boot asks once.
 *
 * @param {Document} root The page.
 * @param {Record<string, object>} catalogs The catalogues by locale.
 * @param {string} locale The locale in use.
 * @returns {void}
 */
export function localizePage(root, catalogs, locale) {
    localizeLandmarks(root, catalogs, locale);
    localizeControls(root, catalogs, locale);
    localizeActions(root, catalogs, locale);
    localizeTools(root, catalogs, locale);
}
