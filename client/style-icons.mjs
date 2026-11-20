// The style rows' icons: one icon per token, from upstream's own table.
//
// The segmented rows upstream draws are icon buttons (`RadioSelection` with an
// `icon` per option), and the icons are the ones `icons.tsx` exports. The row
// markup keeps the token in its `data-` attribute and the label in its text;
// this module puts the icon in front of the label, so the row reads as the
// reference's segmented options and the button keeps its accessible name.
//
// The table is the only place that says which icon belongs to which token; a
// token the table does not name keeps its text alone, which is the honest
// answer for a row the icons table has not covered yet.

import { CHROME_ICONS } from "./chrome-icons.mjs";

/** The icon upstream draws for each style token, by the row's family. */
export const STYLE_ICONS = Object.freeze({
    "data-fill": Object.freeze({
        hachure: "FillHachureIcon",
        "cross-hatch": "FillCrossHatchIcon",
        solid: "FillSolidIcon",
        zigzag: "FillZigZagIcon",
    }),
    "data-line-width": Object.freeze({
        thin: "StrokeWidthBaseIcon",
        medium: "StrokeWidthBoldIcon",
        bold: "StrokeWidthExtraBoldIcon",
    }),
    "data-stroke": Object.freeze({
        solid: "StrokeStyleSolidIcon",
        dashed: "StrokeStyleDashedIcon",
        dotted: "StrokeStyleDottedIcon",
    }),
    "data-roughness": Object.freeze({
        architect: "SloppinessArchitectIcon",
        artist: "SloppinessArtistIcon",
        cartoonist: "SloppinessCartoonistIcon",
    }),
    "data-edges": Object.freeze({
        sharp: "EdgeSharpIcon",
        round: "EdgeRoundIcon",
    }),
});

/**
 * Put the icon in front of each style button's label, once.
 *
 * The icon wrapper is `aria-hidden`: the button's text is its accessible name,
 * and a second name from the drawing would make the button announce twice.
 *
 * @param {Document} document the page's own.
 * @returns {number} how many buttons were decorated.
 */
export function decorateStyleButtons(document) {
    let decorated = 0;
    for (const [attribute, byToken] of Object.entries(STYLE_ICONS)) {
        for (const button of document.querySelectorAll(`button[${attribute}]`)) {
            const token = button.getAttribute(attribute);
            const icon = byToken[token];
            if (icon === undefined || button.querySelector(".style-icon") !== null) {
                continue;
            }
            const box = document.createElement("span");
            box.classList.add("style-icon");
            box.setAttribute("aria-hidden", "true");
            box.innerHTML = CHROME_ICONS[icon];
            button.insertBefore(box, button.children[0] ?? null);
            decorated += 1;
        }
    }
    return decorated;
}
