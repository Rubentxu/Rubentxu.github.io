// The theme: how the page looks, and never what the drawing contains.
//
// # What the theme is
//
// Two themes, light and dark. The choice is the user's, it is remembered
// between visits, and it changes how the page looks — nothing else.
//
// # Why the theme is not part of the drawing
//
// Upstream keeps the theme out of the document too: `APP_STATE_STORAGE_CONF`
// in `packages/excalidraw/appState.ts` declares
// `theme: { browser: true, export: false, server: false }` — the browser
// remembers it, the file does not carry it, the server never sees it. So the
// theme lives in the browser's storage under its own key,
// `nextdraw.theme.v1`, beside the document's `nextdraw.document.v1` and not
// inside it. A drawing that travels to another machine arrives with the
// colours it was drawn with, and the reader's own theme applies to it.
//
// # Why the dark theme turns the paper over
//
// The kernel has one ink — `client/pen.mjs`'s `STROKE` — and the document has
// no colour of its own yet (`client/paint.mjs` says so and means it). So the
// dark theme cannot ask for a lighter ink: there is no lighter ink to ask for,
// and inventing one would be the client deciding what the drawing looks like.
//
// Upstream solves it the other way round. Its dark theme puts every colour it
// paints through `applyDarkModeFilter` (`packages/common/src/colors.ts:86`),
// which is the CSS `filter: invert(93%) hue-rotate(180deg)` — the very filter
// it declares as `--theme-filter` in
// `packages/excalidraw/css/theme.scss:185`. The drawing is not repainted; the
// picture is turned over.
//
// NextDraw turns the drawing over with one declaration too, and the ink stays
// the ink it was — but the declaration belongs to the **canvas** and not to the
// page. The page's filter reached everything the page shows, and one of the
// things it showed was an imported image: upstream filters every colour it
// *paints* and a raster is not a colour it paints, so the image was being
// turned over with the drawing. The filter moved to the context while it
// paints (`client/paint.mjs`) and the image steps out of it.
//
// The paper is therefore upstream's own dark canvas colour, `--default-bg-color`
// (`theme.scss:198`), which is `#121212`, and it is that colour rather than a
// white paper turned over: same colour, one less step to reach it.
//
// # What this module is not
//
// It does not paint, and it does not know the kernel exists. It reads the
// user's choice, puts it on the page, and remembers it.

import { readStored, writeStored } from "./storage.mjs";

/** The two themes the page knows. */
export const THEMES = Object.freeze(["light", "dark"]);

/**
 * The theme a browser that was never asked starts in.
 *
 * Light, because that is how the page has always looked: a dark theme that
 * appeared without being asked for would change the drawing's background under
 * a user who never chose it.
 */
export const DEFAULT_THEME = "light";

/**
 * Where the user's choice is remembered.
 *
 * Its own key, next to the document's and not inside it: the theme is the
 * reader's, the document is the drawing's, and a file that carries the reader's
 * reading of it would be a file that says something about the person who made
 * it.
 */
export const THEME_STORAGE_KEY = "nextdraw.theme.v1";

/**
 * Whether `value` names one of the themes.
 *
 * A stored value that names nothing is not a theme to guess at: the store can
 * hold a word from a future version, or a value a user edited by hand, and
 * neither is a reason to paint the page in a colour nobody chose.
 *
 * @param {unknown} value The value to judge.
 * @returns {boolean}
 */
export function isTheme(value) {
    return THEMES.includes(value);
}

/**
 * The theme the user chose, or the default.
 *
 * @param {unknown} [storage] A storage to use instead of the browser's.
 * @returns {string}
 */
export function readTheme(storage) {
    const stored = readStored(THEME_STORAGE_KEY, storage);
    return isTheme(stored) ? stored : DEFAULT_THEME;
}

/**
 * Remember `theme`, reporting whether it stuck.
 *
 * @param {string} theme The theme to remember.
 * @param {unknown} [storage] A storage to use instead of the browser's.
 * @returns {boolean} Whether the store now holds the choice.
 */
export function writeTheme(theme, storage) {
    return writeStored(THEME_STORAGE_KEY, theme, storage);
}

/**
 * The other theme.
 *
 * @param {string} theme The theme to leave.
 * @returns {string}
 */
export function toggleTheme(theme) {
    return theme === "dark" ? "light" : "dark";
}

/**
 * Put `theme` on the page.
 *
 * The stylesheet reads it from the root element's `data-theme` attribute, so
 * this is the whole of the "how does the page know" question: one attribute,
 * and the stylesheet decides what it means.
 *
 * @param {string} theme The theme to put on the page.
 * @param {{ dataset: Record<string, string> }} root The page's root element.
 * @returns {string} The theme that was put on the page.
 */
export function applyTheme(theme, root) {
    root.dataset.theme = theme;
    return theme;
}

/**
 * The filter the page declares for the theme it is in.
 *
 * The page declares it — upstream declares the same filter in its own stylesheet
 * (`--theme-filter`, `packages/excalidraw/css/theme.scss:185`) — and the canvas reads
 * it and puts it on the context while it paints. So the filter is written down once:
 * a copy here would be a second truth about the same filter, and the two would be
 * free to disagree about what the dark theme looks like.
 *
 * `none` in the light theme, so the light theme changes nothing at all.
 *
 * A page with no computed style to read is a page with no filter, and "no filter" is
 * the light theme's answer: this function is asked what the theme does, and a page
 * that cannot say is treated as one that does nothing.
 *
 * @param {Element} root The page's root element.
 * @returns {string} The CSS filter, or `none`.
 */
/**
 * The colour the canvas's paper is painted with, in the theme that is on.
 *
 * The page declares it as `--paper`, the same colour the canvas is painted
 * with in both themes, and the export reads it for the one place a file needs
 * to carry the background the user sees: an export asked to come with the
 * background. The declaration stays written down once;
 * a colour copied here would be a second truth about the same paper.
 *
 * A page with no computed style to read is a page that cannot say, and the
 * honest answer to an export that asked is "no colour" — the paper stays off.
 *
 * @param {Element} root The page's root element.
 * @returns {string | null} The paper colour, or `null` when the page says none.
 */
export function canvasBackground(root) {
    const computed = root.ownerDocument.defaultView?.getComputedStyle(root);
    const value = computed?.getPropertyValue("--paper")?.trim();
    return value ? value : null;
}

export function themeFilter(root) {
    const computed = globalThis.getComputedStyle?.(root);
    const value = computed?.getPropertyValue("--theme-filter")?.trim();
    return value || "none";
}

/**
 * Bind the theme button and put the stored theme on the page.
 *
 * `root` is the page's root element, because the theme is a property of the
 * page: the attribute goes on the root, and the button is found from there —
 * one root, one lookup, no second query for the same thing.
 *
 * A page with no theme button throws. A button nobody can press is a promise
 * the markup stopped keeping, and it is the same silent failure the other
 * binders refuse to have.
 *
 * The button's own state is this module's business and nobody else's: the
 * pressed state is written here and nowhere else, the same rule the tool
 * toolbar follows.
 *
 * @param {{ root: { dataset: Record<string, string>, querySelector: (s: string) => unknown }, storage?: unknown, onError?: (error: unknown) => void, signal?: AbortSignal }} options `signal` removes the listener when it aborts.
 * @returns {{ theme: () => string, sync: () => void }}
 */
export function bindThemeToggle({
    root,
    storage,
    onChange = () => {},
    onError = (error) => { throw error; },
    signal,
}) {
    const button = root.querySelector("button[data-theme-toggle]");
    if (button === null || button === undefined) {
        throw new Error("the page has no button[data-theme-toggle]");
    }
    let theme = readTheme(storage);

    /**
     * Put the theme on the page and on the button.
     *
     * The button's pressed state says which theme is on, so the user can read
     * it without looking at the whole page. The class is the same one the
     * style groups use for "this is the one in use".
     */
    const paint = () => {
        applyTheme(theme, root);
        button.classList.toggle("is-active", theme === "dark");
        button.setAttribute("aria-pressed", theme === "dark" ? "true" : "false");
    };

    button.addEventListener("click", () => {
        try {
            theme = toggleTheme(theme);
            paint();
            // The canvas is not turned over by the stylesheet any more — the
            // filter is on the context while it paints — so the pixels on the
            // canvas are the ones that have to change, and the caller has to
            // ask for the repaint.
            onChange(theme);
            if (!writeTheme(theme, storage)) {
                // The theme is on the screen either way; what failed is the
                // remembering of it. The user has to know that this choice will
                // not survive a reload, and saying so once is enough.
                onError(new Error("the theme could not be stored"));
            }
        } catch (error) {
            onError(error);
        }
    }, { signal });

    paint();

    return {
        /** The theme on the page right now. */
        theme: () => theme,
        /** Put the theme on the page again, after something else moved it. */
        sync: paint,
    };
}
