// The chart's ruler: the kernel's text table, in the shape the layout asks.
//
// The layout is pure arithmetic on top of one measurement — how wide a piece of
// text is and how tall a line of it stands. That answer belongs to the kernel:
// the box is a modelled field of the document, and a second owner for it is how
// they drift. It used to be `ctx.measureText` here, and the day the family's
// shipped face changed, the chart's stored widths moved with the font instead
// of with the table the receipts are calibrated on (PARITY-057). The measurer is
// now the kernel's `measureText`, and the factory asks for no canvas at all: an
// argument it does not read has no business being taken. The painted face
// (Kalam) and the measured box (the table's face) knowingly differ; one owner
// for the box across the product is the decision that bought that.

import { FONT_FAMILIES } from "./vocabulary.mjs";
import { measureText as kernelMeasureText } from "../pkg/nextdraw_wasm.js";

/**
 * The family a name falls back to when the document names none.
 *
 * It is the name the user sees for the format's default family — the same word the
 * vocabulary publishes and the stylesheet declares — because a fallback that names a
 * face this build does not ship would be measured in whatever the system offers.
 */
const FALLBACK_FAMILY = "NextDraw Script";

/** The name of every family the document may name, by its number. */
const FAMILY_NAMES = new Map(FONT_FAMILIES.map(({ id, name }) => [id, name]));

/**
 * The unitless line height of every family, from the reference's font table.
 *
 * The hand-drawn family (the format's `Excalifont`, which this build shows as
 * `NextDraw Script`), Nunito, Comic Shanns, the classic hand (the format's
 * `Virgil`) and Assistant stand at 1.25; Lilita One, Helvetica and Liberation Sans
 * at 1.15; Cascadia at 1.2. The heights are the reference's, because a chart
 * label's box is half of what the layout decides about it.
 */
const LINE_HEIGHTS = new Map([
    [1, 1.25],
    [2, 1.15],
    [3, 1.2],
    [5, 1.25],
    [6, 1.25],
    [7, 1.15],
    [8, 1.25],
    [9, 1.15],
    [10, 1.25],
]);

/** The padding the reference adds on each side of a measured line. */
const BOUND_TEXT_PADDING = 5;

/** The alphabet whose widest character bounds the narrowest allowed line. */
const WIDEST_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

/** The family name a font string names, and its line height. */
function familyOf(fontString) {
    const name = fontString.slice(fontString.indexOf("px ") + 3);
    return name;
}

/** The unitless line height the font string's family stands at. */
function lineHeightOf(fontString) {
    const name = familyOf(fontString);
    for (const { id, name: candidate } of FONT_FAMILIES) {
        if (candidate === name) {
            return LINE_HEIGHTS.get(id) ?? 1.25;
        }
    }
    return 1.25;
}

/**
 * The measurer the chart layout asks: a font string from a family and a size,
 * the width and height of a text, the narrowest allowed line, and a wrap.
 *
 * The width and the height come from the kernel's table, not from the canvas:
 * `measureText(body, fontSize, lineHeight)` returns the box as a JSON pair, and
 * the line height is resolved here (from the family's own table) because the
 * kernel is told the height, not asked to guess it from a face.
 *
 * @param {{measureText?: Function}} [options] the oracle, injectable so a unit
 *   test can hand the layout deterministic metrics without a built artifact.
 * @returns {{fontString: Function, measure: Function, minLineWidth: Function, wrap: Function}}
 *   the four answers the layout needs.
 */
export function createChartMeasure({ measureText = kernelMeasureText } = {}) {
    const fontString = ({ fontFamily, fontSize }) =>
        `${fontSize}px ${FAMILY_NAMES.get(fontFamily) ?? FALLBACK_FAMILY}`;

    /** The kernel's box for a body at the font string's size and the family's height. */
    const measure = (text, font) => {
        const { width, height } = JSON.parse(
            measureText(text, Number.parseFloat(font), lineHeightOf(font)),
        );
        return { width, height };
    };

    const minLineWidth = (font) => {
        let widest = 0;
        for (const character of WIDEST_ALPHABET) {
            widest = Math.max(widest, measure(character, font).width);
        }
        return widest + BOUND_TEXT_PADDING * 2;
    };

    /** Break one line at its spaces, then break a word that does not fit. */
    const wrapLine = (line, width, font) => {
        const words = line.split(/\s+/).filter(Boolean);
        if (words.length === 0) return [line];
        const wrapped = [];
        let current = "";
        for (const word of words) {
            const candidate = current === "" ? word : `${current} ${word}`;
            if (measure(candidate, font).width <= width) {
                current = candidate;
                continue;
            }
            if (current !== "") wrapped.push(current);
            if (measure(word, font).width <= width) {
                current = word;
                continue;
            }
            // A word wider than the line is broken where the width ends.
            let piece = "";
            for (const character of word) {
                if (measure(piece + character, font).width > width && piece !== "") {
                    wrapped.push(piece);
                    piece = character;
                } else {
                    piece += character;
                }
            }
            current = piece;
        }
        if (current !== "") wrapped.push(current);
        return wrapped;
    };

    const wrap = (text, width, font) =>
        text
            .split("\n")
            .flatMap((line) => (measure(line, font).width <= width ? [line] : wrapLine(line, width, font)))
            .join("\n");

    return { fontString, measure, minLineWidth, wrap };
}
