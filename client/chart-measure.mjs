// The chart's ruler: the canvas's text metrics, in the shape the layout asks.
//
// The layout is pure arithmetic on top of one measurement — how wide a piece of
// text is when the browser draws it in a named family at a named size, and how
// tall a line of it stands. The reference asks a `RenderEnvironment` for the
// same answers; this client has the canvas the drawing is painted on, and the
// paste path already hands it over. The module is the seam between the two: it
// reads the families the document names, measures on the given context, and
// restores the context's font so a measurement never leaks into the paint.

import { FONT_FAMILIES } from "./vocabulary.mjs";

/** The family a name falls back to when the document names none. */
const FALLBACK_FAMILY = "Excalifont";

/** The name of every family the document may name, by its number. */
const FAMILY_NAMES = new Map(FONT_FAMILIES.map(({ id, name }) => [id, name]));

/**
 * The unitless line height of every family, from the reference's font table.
 *
 * Excalifont, Nunito, Comic Shanns, Virgil and Assistant stand at 1.25;
 * Lilita One, Helvetica and Liberation Sans at 1.15; Cascadia at 1.2. The
 * heights are the reference's, because a chart label's box is half of what the
 * layout decides about it.
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
 * @param {CanvasRenderingContext2D} ctx the context the chart will be drawn on.
 * @returns {{fontString: Function, measure: Function, minLineWidth: Function, wrap: Function}}
 *   the four answers the layout needs.
 */
export function createChartMeasure(ctx) {
    const fontString = ({ fontFamily, fontSize }) =>
        `${fontSize}px ${FAMILY_NAMES.get(fontFamily) ?? FALLBACK_FAMILY}`;

    const measure = (text, font) => {
        const lines = text.split("\n");
        ctx.save();
        ctx.font = font;
        let width = 0;
        for (const line of lines) {
            width = Math.max(width, ctx.measureText(line === "" ? " " : line).width);
        }
        ctx.restore();
        const fontSize = Number.parseFloat(font);
        return {
            width,
            height: fontSize * lineHeightOf(font) * lines.length,
        };
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
