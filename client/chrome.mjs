// The chrome's primitives: the island, the icon button, the icon cycle, the
// separator — upstream's own building blocks, reusable, and the one place the
// chrome's tokens and its stylesheet get installed.
//
// # What this file is
//
// Two things upstream keeps in `packages/excalidraw/components/`:
// `Island.tsx` (the white rounded container with the island shadow), the
// button family (`IconButton`, `ButtonIconCycle`, `ButtonSeparator`) and the
// theme's custom properties (`.excalidraw`'s `--island-bg-color` and friends,
// `css/theme.scss`) plus the stylesheets that draw the family
// (`Island.scss`, `ToolIcon.scss`, the `outlineButtonStyles` mixin of
// `css/variables.module.scss`, the `.buttonList` rules of `css/styles.scss`).
// Here they are one module: the tokens install as CSS custom properties in
// upstream's own names (light on `:root`, dark under
// `:root[data-theme="dark"]`, the port's own theme switch), the stylesheet
// installs as the rules those names draw, and the primitives build the DOM
// the stylesheet draws. The surfaces (toolbar, panel, zoom, menu — their own
// cards) build their rows out of these, the way upstream's surfaces build
// theirs out of `Island` and the buttons.
//
// # What this file is not
//
// Not a re-skin. No surface changes look because this module exists — a
// surface migrates in its own card, carrying its structural tests with it.
// What holds here is that a primitive built today is drawn with the same
// custom properties upstream's is, so a surface that adopts it adopts the
// look with it.

import { CHROME_TOKENS } from "./chrome-tokens.mjs";

/** The style element the tokens install under, so a second install replaces. */
const TOKENS_STYLE_ID = "chrome-tokens";

/** The style element the primitives' stylesheet installs under. */
const CSS_STYLE_ID = "chrome-css";

/**
 * The tokens, installed once, as custom properties in upstream's names.
 *
 * Both themes are written in one block — the light theme on `:root`, the dark
 * under `:root[data-theme="dark"]` — because the theme is a page attribute
 * the CSS already switches on (`client/theme.mjs`), and an installer that
 * had to re-run on a theme change would be a second thing to remember.
 * Idempotent: a second install replaces the block a first one wrote, so a
 * page that boots twice (a panic rebuild) carries one copy.
 *
 * @param {Document} document the page's own.
 * @returns {Element} the style element the tokens were written into.
 */
export function installChromeTokens(document) {
    const previous = document.documentElement.querySelector(`#${TOKENS_STYLE_ID}`);
    const style = previous ?? document.createElement("style");
    style.id = TOKENS_STYLE_ID;
    const block = (theme, selector) =>
        `${selector} {\n` +
        Object.keys(CHROME_TOKENS[theme])
            .map((name) => `  --${name}: ${CHROME_TOKENS[theme][name]};`)
            .join("\n") +
        `\n}`;
    style.textContent = `${block("light", ":root")}\n${block("dark", ':root[data-theme="dark"]')}`;
    if (previous === null) {
        document.head.appendChild(style);
    }
    return style;
}

/**
 * The primitives' stylesheet, in upstream's own rules.
 *
 * The selectors are upstream's — `.Island`, the `.ToolIcon` family, the
 * `.buttonList` rows the cycles live in — because the primitives build
 * upstream's DOM and the stylesheet that draws it draws it by those names.
 * The values are `var()` reads of the tokens `installChromeTokens` writes,
 * with upstream's own fallbacks kept (`var(--button-hover-bg,
 * var(--island-bg-color))`). Idempotent the same way the tokens are.
 *
 * Sources, cited per rule: `packages/excalidraw/components/Island.scss`,
 * `packages/excalidraw/components/ToolIcon.scss` (with the
 * `toolbarButtonColorStates` mixin of `css/variables.module.scss`), and the
 * `.buttonList` block of `css/styles.scss` with the `outlineButtonStyles`
 * mixin (`css/variables.module.scss:105`).
 *
 * @param {Document} document the page's own.
 * @returns {Element} the style element the rules were written into.
 */
export function installChromeCss(document) {
    const previous = document.documentElement.querySelector(`#${CSS_STYLE_ID}`);
    const style = previous ?? document.createElement("style");
    style.id = CSS_STYLE_ID;
    style.textContent = `
/* Upstream computes the arrowheads' handler ink in JS from the theme
   (icons.tsx's handlerColor): white on the light theme, near-black on the
   dark one. A static SVG carries both answers through this custom property,
   which the iconary's generator folds into the strokes. */
:root {
    --icon-handler-color: #fff;
}
:root[data-theme="dark"] {
    --icon-handler-color: #1e1e1e;
}

/* The island — Island.scss: one object, not a row of loose buttons. */
.Island {
    box-sizing: border-box;
    background-color: var(--island-bg-color);
    box-shadow: var(--shadow-island);
    border-radius: var(--border-radius-lg);
    padding: calc(var(--padding, 0) * var(--space-factor));
    position: relative;
}

/* The icon button family — ToolIcon.scss. */
.ToolIcon {
    border-radius: var(--border-radius-lg);
    display: inline-flex;
    align-items: center;
    position: relative;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    user-select: none;
}
.ToolIcon--plain .ToolIcon__icon {
    width: 2rem;
    height: 2rem;
}
.ToolIcon_type_toggle {
    appearance: none;
    margin: 0;
    padding: 0;
    border: none;
    background-color: transparent;
    font: inherit;
    color: inherit;
    text-align: inherit;
}
.ToolIcon_type_toggle:focus-visible {
    box-shadow: 0 0 0 2px var(--focus-highlight-color);
}
.ToolIcon_type_button {
    padding: 0;
    border: none;
    margin: 0;
    font-size: inherit;
    background-color: initial;
}
.ToolIcon_type_button:focus-visible {
    box-shadow: 0 0 0 2px var(--focus-highlight-color);
}
.ToolIcon_type_button:active {
    background-color: var(--button-gray-3);
}
.ToolIcon__icon {
    box-sizing: border-box;
    width: var(--default-button-size);
    height: var(--default-button-size);
    color: var(--icon-fill-color);
    display: flex;
    justify-content: center;
    align-items: center;
    border-radius: var(--border-radius-lg);
}
.ToolIcon__icon:hover {
    background: var(--button-hover-bg);
}
.ToolIcon__icon:active {
    background: var(--button-hover-bg);
    border: 1px solid var(--button-active-border);
}
.ToolIcon__icon[aria-disabled="true"] {
    background: initial;
    border: none;
}
.ToolIcon__icon[aria-disabled="true"] svg {
    color: var(--color-disabled);
}
.ToolIcon__icon svg {
    position: relative;
    width: var(--default-icon-size);
    height: var(--default-icon-size);
    color: var(--icon-fill-color);
}
.ToolIcon__keybinding {
    position: absolute;
    bottom: 2px;
    right: 3px;
    font-size: 0.625rem;
    color: var(--keybinding-color);
    font-family: var(--ui-font);
    user-select: none;
}
/* The checked and disabled answers — toolbarButtonColorStates
   (css/variables.module.scss). */
.ToolIcon_type_toggle.ToolIcon--checked .ToolIcon__icon {
    background: var(--color-surface-primary-container);
}
.ToolIcon_type_toggle.ToolIcon--checked .ToolIcon__icon svg {
    color: var(--color-on-primary-container);
}
.ToolIcon_type_toggle:disabled {
    cursor: default;
}
.ToolIcon_type_toggle:disabled .ToolIcon__icon svg {
    color: var(--color-disabled);
}
.ToolIcon_type_toggle:disabled .ToolIcon__icon:hover,
.ToolIcon_type_toggle:disabled .ToolIcon__icon:active {
    background: initial;
    border: none;
}

/* The toolbar's own container — ToolIcon.scss's .App-toolbar-container: the
   buttons in the toolbar island take the large sizes the row reads at. */
.App-toolbar .ToolIcon__icon {
    width: var(--lg-button-size);
    height: var(--lg-button-size);
}
.App-toolbar .ToolIcon__icon svg {
    width: var(--lg-icon-size);
    height: var(--lg-icon-size);
}

/* The rows the cycles live in — the .buttonList block of styles.scss with
   the outlineButtonStyles mixin. The bare label and button are upstream's
   own DOM; the input the cycle carries stays hidden inside its box. */
.buttonList {
    flex-wrap: wrap;
    display: flex;
    column-gap: 0.5rem;
    row-gap: 0.5rem;
}
.buttonList input[type="radio"],
.buttonList input[type="button"] {
    opacity: 0;
    position: absolute;
    pointer-events: none;
}
.buttonList label,
.buttonList button {
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 0;
    width: var(--default-button-size);
    height: var(--default-button-size);
    box-sizing: border-box;
    border-width: 1px;
    border-style: solid;
    border-color: var(--button-border, var(--default-border-color));
    border-radius: var(--border-radius-lg);
    cursor: pointer;
    background-color: var(--button-bg, var(--island-bg-color));
    color: var(--button-color, var(--color-on-surface));
    font-family: var(--ui-font);
}
.buttonList label svg,
.buttonList button svg {
    width: var(--default-icon-size);
    height: var(--default-icon-size);
}
/* The focus ring the cycles announce themselves with: the input inside the
   label carries the focus, the label draws it (styles.scss's
   .buttonList label:focus-within). */
.buttonList label:focus-within {
    outline: transparent;
    box-shadow: 0 0 0 1px var(--color-brand-hover);
}
.buttonList label:hover,
.buttonList button:hover {
    background-color: var(--button-hover-bg, var(--island-bg-color));
    border-color: var(--button-hover-border, var(--button-border, var(--default-border-color)));
}
.buttonList label:active,
.buttonList button:active {
    background-color: var(--button-active-bg, var(--island-bg-color));
    border-color: var(--button-active-border, var(--color-primary-darkest));
}
.buttonList label.active {
    background-color: var(--button-selected-bg, var(--color-surface-primary-container));
    border-color: var(--button-selected-border, var(--color-surface-primary-container));
}


/* Upstream's screen-size variants (theme.scss): the chrome reads
   --lg-button-size and --default-button-size, and a large screen gets the
   bigger pair; the mobile breakpoint narrows the shell's inset. They live
   with the chrome's stylesheet because they are overrides of the tokens it
   installs, and they follow the same rule: a value upstream declares, not a
   value this file invents. */
@media screen and (min-device-width: 1921px) {
    :root {
        --lg-button-size: 2.375rem;
        --lg-icon-size: 1.25rem;
        --default-button-size: 2.25rem;
        --default-icon-size: 1.25rem;
    }
}
@media (max-width: 640px), (pointer: coarse) {
    :root {
        --editor-container-padding: 0.75rem;
    }
}
`;
    if (previous === null) {
        document.head.appendChild(style);
    }
    return style;
}

/**
 * An island: the container the chrome's clusters live in.
 *
 * Upstream's `Island` is a div with a padding variable, the island background,
 * the island shadow and the large radius — the geometry a cluster reads as
 * "one object" rather than as a row of loose buttons.
 *
 * @param {Document} document the page's own.
 * @param {{ padding?: number, className?: string, name?: string }} [options]
 *   `padding` is upstream's `--padding` (in space factors); `name` names the
 *   surface for `getViewportOffsets`-style questions (upstream's
 *   `data-viewport-ui-name`).
 * @returns {Element}
 */
export function islandBox(document, options = {}) {
    const island = document.createElement("div");
    island.classList.add("Island");
    if (options.padding !== undefined) {
        island.style.setProperty("--padding", String(options.padding));
    }
    if (options.className !== undefined) {
        island.classList.add(options.className);
    }
    if (options.name !== undefined) {
        island.setAttribute("data-viewport-ui-name", options.name);
    }
    return island;
}

/**
 * An icon button: one icon, one name, upstream's `IconButton` shape.
 *
 * The two shapes upstream's `IconButton` renders, both carried here:
 * `type: "icon"` is the plain one (`ToolIcon ToolIcon_type_button
 * ToolIcon--plain`, what the menu and the corners build) and `type: "toggle"`
 * is the stateful one (`ToolIcon_type_toggle`, `ToolIcon--checked` and
 * `aria-pressed` when `checked`, what the tools build). The icon lives in the
 * inner `div.ToolIcon__icon` either way — the box the stylesheet's hover,
 * active and checked states draw. The accessible name is the label (an icon
 * button is anonymous without it — the a11y sweep's rule). Extra attributes
 * (`data-command`, `data-tool`, `title`) ride the `attributes` map, because
 * the primitives serve every surface and each surface carries its own wiring
 * attributes.
 *
 * @param {Document} document the page's own.
 * @param {{ icon: string, label: string, type: "icon"|"toggle", checked?: boolean,
 *           keyBinding?: string, attributes?: Record<string, string> }} options
 * @returns {Element}
 */
export function iconButton(document, { icon, label, type, checked, disabled = false, keyBinding, attributes = {} }) {
    if (type !== "icon" && type !== "toggle") {
        throw new Error(`iconButton needs the type upstream's IconButton renders: "icon" or "toggle"`);
    }
    const button = document.createElement("button");
    button.setAttribute("type", "button");
    button.setAttribute("aria-label", label);
    // Upstream disables the control itself and says so on the inner box: the
    // stylesheet draws the disabled ink from the attribute, and the browser
    // refuses the click from the property.
    if (disabled) {
        button.disabled = true;
    }
    button.classList.add("ToolIcon", "ToolIcon_size_medium", type === "icon" ? "ToolIcon_type_button" : "ToolIcon_type_toggle");
    if (type === "icon") {
        button.classList.add("ToolIcon--plain", "ToolIcon_type_button--show");
    } else {
        button.classList.toggle("ToolIcon--checked", checked === true);
        button.setAttribute("aria-pressed", checked === true ? "true" : "false");
        if (disabled) {
            button.setAttribute("aria-disabled", "true");
        }
    }
    const box = document.createElement("div");
    box.classList.add("ToolIcon__icon");
    if (type === "icon") {
        box.setAttribute("aria-hidden", "true");
        box.setAttribute("aria-disabled", disabled ? "true" : "false");
    }
    box.innerHTML = icon;
    if (keyBinding !== undefined) {
        const key = document.createElement("span");
        key.classList.add("ToolIcon__keybinding");
        key.textContent = keyBinding;
        box.appendChild(key);
    }
    button.appendChild(box);
    for (const [name, value] of Object.entries(attributes)) {
        button.setAttribute(name, value);
    }
    return button;
}

/**
 * An icon cycle: one control that walks its options on click.
 *
 * Upstream's `ButtonIconCycle` is a `label.active` carrying an
 * `input[type=button]` named by the group and the current option's icon —
 * the `active` class is what says "this cycle holds a value", which is why
 * `value: null` builds a label without it. The label carries no other class:
 * the stylesheet draws it through the `.buttonList` rows it lives in.
 *
 * @param {Document} document the page's own.
 * @param {{ group: string, options: { value: string|null, icon: string }[], value: string|null }} options
 * @returns {Element}
 */
export function iconCycle(document, { group, options, value, onCycle }) {
    const current = options.find((option) => option.value === value) ?? options[0];
    const label = document.createElement("label");
    if (current.value !== null) {
        label.classList.add("active");
    }
    const input = document.createElement("input");
    input.type = "button";
    input.name = group;
    // Upstream's cycle walks the options on every click and hands the next
    // value to its owner; the primitive draws the control and the callback is
    // how the caller hears the walk.
    if (onCycle !== undefined) {
        input.addEventListener("click", () => {
            const index = options.indexOf(current);
            const next = options[(index + 1) % options.length];
            if (next !== undefined) {
                onCycle(next.value);
            }
        });
    }
    label.appendChild(input);
    label.innerHTML += current.icon;
    return label;
}

/**
 * A separator: the one-pixel rule between a toolbar's clusters.
 *
 * Upstream's `ButtonSeparator` carries its geometry inline — a style the
 * component owns rather than a class a stylesheet owns — and so does this.
 *
 * @param {Document} document the page's own.
 * @returns {Element}
 */
export function separator(document) {
    const rule = document.createElement("div");
    // Upstream's `ButtonSeparator` renders a bare `div`: the geometry is the
    // component's and it carries no class for a stylesheet to own.
    rule.style.width = "1px";
    rule.style.height = "1rem";
    rule.style.backgroundColor = "var(--default-border-color)";
    rule.style.margin = "0 auto";
    return rule;
}
