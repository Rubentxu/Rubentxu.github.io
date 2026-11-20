// What the dark theme does to a colour, computed the way upstream computes it.
//
// # Why this is not a CSS filter
//
// The dark theme turns the *drawing* over with `filter: invert(93%)
// hue-rotate(180deg)`, and upstream puts exactly that filter on the context
// while it paints (`packages/common/src/colors.ts:86`,
// `applyDarkModeFilter`). The page's chrome is not painted on that context,
// so a colour the chrome shows — a swatch, the text of the inline editor —
// has to be turned over by the same arithmetic, once, before it is written to
// the element. A CSS filter on the element would turn the element's border,
// its ring and its neighbours over with it; upstream computes a value and
// writes one colour, and that is what this module does.
//
// # Why the arithmetic is copied and not approximated
//
// The comparison against the pin is a comparison of values: the pin's dark
// stroke pick for `#1e1e1e` is `#d3d3d3`, and a formula that "looks close"
// is a different colour in the receipt. The two steps are upstream's own:
// `cssInvert` (a blend between the colour and its opposite at 93%) and
// `cssHueRotate` (the matrix the CSS `hue-rotate` filter uses). The vectors in
// `scripts/fixtures/dark-colour-vectors.json` are generated from upstream's
// source (`scripts/gen-dark-colour-vectors.mjs`), so this file's arithmetic is
// checked against the implementation it copies and not against itself.
//
// # What this module is not
//
// It does not read the theme, and it does not know the page exists. A caller
// says whether the dark theme is on and gets a colour back.

/**
 * The filter the theme declares, in the two numbers the arithmetic needs.
 *
 * They are upstream's constants (`DARK_MODE_FILTER_INVERT_PERCENT` and
 * `DARK_MODE_FILTER_HUE_ROTATE_DEGREES`, `colors.ts:19-20`), and the CSS
 * declaration in `index.html` spells the same two numbers. A test reads one
 * against the other, because a filter that the stylesheet declares and a
 * filter the chrome computes are two truths about the same theme.
 */
export const DARK_MODE_FILTER = Object.freeze({ invertPercent: 93, hueRotateDegrees: 180 });

/** The threshold upstream uses to decide whether a swatch needs an outline. */
export const OUTLINE_CONTRAST_THRESHOLD = 240;

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/;
const TRANSPARENT = "transparent";

/**
 * The colour a CSS colour string names, as channels plus alpha.
 *
 * The document's inks are hex or the word `transparent` (the hex entry
 * normalises everything to those, `normaliseColour`), so the reader accepts
 * those and nothing else. A string it does not know is not a colour it guesses
 * at: the caller gets `null` and keeps what it had.
 *
 * @param {string} colour the colour, as the document stores it.
 * @returns {{r: number, g: number, b: number, a: number} | null}
 */
export function readColour(colour) {
    const value = String(colour ?? "").trim().toLowerCase();
    if (value === TRANSPARENT) {
        return { r: 0, g: 0, b: 0, a: 0 };
    }
    if (!HEX.test(value)) {
        return null;
    }
    const digits = value.slice(1);
    const expand = (short) => short.split("").map((digit) => digit + digit).join("");
    const full = digits.length <= 4 ? expand(digits) : digits;
    const channel = (offset) => Number.parseInt(full.slice(offset, offset + 2), 16);
    return {
        r: channel(0),
        g: channel(2),
        b: channel(4),
        a: full.length === 8 ? channel(6) / 255 : 1,
    };
}

/**
 * The hexadecimal spelling of a colour, with its alpha when it has one.
 *
 * It is upstream's `rgbToHex` (`colors.ts:345`): six digits, and two more only
 * when the colour is not opaque. Three-digit input comes back in six, because
 * the value written to the page is the value the arithmetic worked on.
 *
 * @param {{r: number, g: number, b: number, a?: number}} colour
 * @returns {string}
 */
export function rgbToHex({ r, g, b, a = 1 }) {
    const hex6 = `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
    if (a < 1) {
        return `${hex6}${Math.round(a * 255).toString(16).padStart(2, "0")}`;
    }
    return hex6;
}

/**
 * The blend between a channel and its opposite, at `percent`.
 *
 * @param {number} value the channel, 0..255.
 * @param {number} percent how much of the opposite to take, 0..100.
 * @returns {number}
 */
function invertChannel(value, percent) {
    const amount = Math.max(0, Math.min(100, percent)) / 100;
    return Math.round(Math.max(0, Math.min(255, value * (1 - amount) + (255 - value) * amount)));
}

/**
 * The rotation the CSS `hue-rotate` filter applies, as a matrix.
 *
 * @param {number} r the red channel, 0..255.
 * @param {number} g the green channel, 0..255.
 * @param {number} b the blue channel, 0..255.
 * @param {number} degrees the rotation.
 * @returns {{r: number, g: number, b: number}}
 */
function hueRotate(r, g, b, degrees) {
    const red = r / 255;
    const green = g / 255;
    const blue = b / 255;
    const radians = (degrees * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const matrix = [
        0.213 + cos * 0.787 - sin * 0.213,
        0.715 - cos * 0.715 - sin * 0.715,
        0.072 - cos * 0.072 + sin * 0.928,
        0.213 - cos * 0.213 + sin * 0.143,
        0.715 + cos * 0.285 + sin * 0.14,
        0.072 - cos * 0.072 - sin * 0.283,
        0.213 - cos * 0.213 - sin * 0.787,
        0.715 - cos * 0.715 + sin * 0.715,
        0.072 + cos * 0.928 + sin * 0.072,
    ];
    const clamp = (value) => Math.round(Math.max(0, Math.min(1, value)) * 255);
    return {
        r: clamp(red * matrix[0] + green * matrix[1] + blue * matrix[2]),
        g: clamp(red * matrix[3] + green * matrix[4] + blue * matrix[5]),
        b: clamp(red * matrix[6] + green * matrix[7] + blue * matrix[8]),
    };
}

/**
 * The colour the dark theme shows for `colour`.
 *
 * `enabled` is the theme, not a flag the caller invents: in the light theme
 * upstream returns the colour unchanged (`applyDarkModeFilter(color, false)`)
 * and so does this function, which is what makes "the light theme changes
 * nothing" a property of the code and not of every call site remembering to
 * skip it.
 *
 * A string that names no colour comes back as it went in. That is the honest
 * answer for a document that carries a colour this module cannot read: showing
 * nothing would hide the ink, and inventing a colour would draw one nobody
 * chose.
 *
 * @param {string} colour the colour in the document.
 * @param {boolean} [enabled] whether the dark theme is on.
 * @returns {string}
 */
export function applyDarkModeFilter(colour, enabled = true) {
    if (!enabled) {
        return colour;
    }
    const parsed = readColour(colour);
    if (parsed === null) {
        return colour;
    }
    const inverted = {
        r: invertChannel(parsed.r, DARK_MODE_FILTER.invertPercent),
        g: invertChannel(parsed.g, DARK_MODE_FILTER.invertPercent),
        b: invertChannel(parsed.b, DARK_MODE_FILTER.invertPercent),
    };
    const rotated = hueRotate(inverted.r, inverted.g, inverted.b, DARK_MODE_FILTER.hueRotateDegrees);
    return rgbToHex({ ...rotated, a: parsed.a });
}

/**
 * Whether a colour is dark, by upstream's YIQ rule.
 *
 * Upstream asks this of the swatch's **document** colour, not of what the dark
 * theme shows for it (`TopPicks.tsx`), and the answer decides whether the
 * swatch needs a one-pixel outline to be visible: a near-white swatch on a
 * near-white panel is a swatch nobody sees. The threshold is the caller's, and
 * the picker uses `OUTLINE_CONTRAST_THRESHOLD` for it, as upstream's top picks
 * do.
 *
 * @param {string} colour the colour in the document.
 * @param {number} [threshold] the YIQ below which the colour counts as dark.
 * @returns {boolean}
 */
export function isColourDark(colour, threshold = 160) {
    if (!colour) {
        return true;
    }
    const parsed = readColour(colour);
    if (parsed === null) {
        return true;
    }
    if (parsed.a === 0) {
        return false;
    }
    const yiq = (parsed.r * 299 + parsed.g * 587 + parsed.b * 114) / 1000;
    return yiq < threshold;
}

/**
 * Whether a swatch of `colour` needs the outline that makes a light colour
 * visible on a light panel.
 *
 * It is upstream's `has-outline` class, computed from the document colour for
 * the same reason `isColourDark` is: the dark theme turns a light swatch dark
 * and a dark one light, and the outline follows the colour the user chose, not
 * the one the theme paints.
 *
 * @param {string} colour the colour in the document.
 * @returns {boolean}
 */
export function swatchNeedsOutline(colour) {
    return !isColourDark(colour, OUTLINE_CONTRAST_THRESHOLD);
}
