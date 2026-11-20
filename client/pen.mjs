import { HATCH } from "./vocabulary.mjs";

// The pen: every number a drawing is made of.
//
// # Why it is its own file
//
// Two renderers need the same eight values — the canvas and the exported SVG. When the
// canvas held them as module constants and the exporter read its own copy, the second copy
// would be the second truth about one number, and the symptom would be a file that opens
// in Inkscape and looks subtly not like the drawing. Nobody would find that by reading
// either file.
//
// So there is one table, here, and both read it.
//
// # What is not here any more
//
// The **colours** were here until H6.14, and they are not any more. A colour is not a
// property of the drawing but of each element: the model carries it, the op carries it,
// and the canvas and the exporter paint what they are told. A palette here would be a
// second truth about the same colour — the one that was wrong before, when the canvas
// had one black for the whole drawing and the document had a red in it.
//
// What is left here is the fallback: what an op paints like when it arrives without a
// colour, which is what the format gives a new element.
//
// # What is deliberately not here
//
// the hatch rows are not, because the kernel computes them (`crate::hatch`) and the
// the interior of a shape — not what a line looks like. The exported hatch takes the slant
// as a number and builds a repeating tile from it, which is a different construction of the
// same texture. Keeping the geometry in `paint.mjs` keeps the two renderers from sharing
// code they have no reason to share, and keeps one from quietly changing the other's
// output.

/**
 * The colour of outlines, arrowheads and hatch lines, when the op says nothing.
 *
 * The colour the format names for a new element, so that a drawing that says
 * nothing about its colour is drawn in the colour the format would have given
 * it. The two used to disagree: the format said one colour and the canvas
 * painted another, and the drawing was a little off in a way nobody could
 * point at until something was there to measure it against.
 *
 * This is the **fallback** and not the rule: since H6.14 the op carries the
 * element's own colour and this is what an op without one paints like.
 */
export const STROKE = "#1e1e1e";

/**
 * The colour inside a solid-filled shape.
 *
 * Upstream calls this the background colour of the element, and the format gives a new
 * element a transparent one. A solid shape in the reference therefore has nothing painted
 * inside it: what is inside the outline is the page.
 *
 * The pen holds the colours the format names, and this is the other half of the pair whose
 * first half is the ink. Painting a tint of the ink here instead would put a colour on the
 * screen that the file never asked for, and the difference would be invisible to every
 * check that compares documents and visible to anyone who compares pictures.
 *
 * Since H6.14 this is the **fallback** and not the rule: the op carries the element's own
 * background colour, and a shape with a coloured interior is filled with it.
 */
export const FILL = "transparent";

/**
 * The ink of the eraser's trail.
 *
 * Upstream paints the trail with a translucent wash of the theme's own colour — black on the
 * light theme, white on the dark one — so the trail reads as a shadow travelling over the
 * drawing rather than as another stroke of it (`packages/excalidraw/eraser/index.ts`). This
 * client has one theme and it is the light one, so the wash is the light one; a dark theme
 * would change this number and nothing else.
 */
export const ERASER_TRAIL = "rgba(0, 0, 0, 0.2)";

/**
 * How opaque an element the eraser has marked is drawn.
 *
 * Upstream's `ELEMENT_READY_TO_ERASE_OPACITY` is 20 — a percentage, because upstream
 * multiplies it into the element's own opacity (`packages/element/src/renderElement.ts`).
 * This is the same number as the fraction the canvas wants, because the kernel's ops carry
 * no opacity of their own for it to multiply into.
 */
export const ERASE_PENDING_OPACITY = 0.2;

/**
 * Stroke width, in scene units. The export is 1:1 with the scene, so it is the same number.
 *
 * This is the pen's width — the width the exported file's hatch lines are drawn at, and
 * the margin its box leaves around the drawing. The width an *element* is stroked at is
 * the element's own, and it travels with the element (`strokeWidth`).
 *
 * The number is the canonical `medium`: upstream's `STROKE_WIDTH.medium` is 2, and its
 * `DEFAULT_ELEMENT_STROKE_WIDTH_KEY` is `medium`
 * (`packages/common/src/constants.ts`). It used to be 1,5, which was the `thin` of a
 * vocabulary this build no longer has — a number outside the family the model stores,
 * so a document that said nothing and a document that said `medium` would have been
 * drawn at two different widths.
 */
export const LINE_WIDTH = 2;

/** The dash patterns, in units of line width, as the canvas measures them. `[]` is solid. */
export const DASH = {
    solid: [],
    dashed: [8, 6],
    dotted: [1, 5],
};

/**
 * The pen as the JSON the kernel's `exportSvg` takes.
 *
 * A function rather than a constant so that a test can hand a caller a *different* pen
 * without mutating this one — the exported file is the only thing that reads it, and a
 * shared mutable would make the two tests that need different pens into a race.
 */
export function penJson() {
    return JSON.stringify({
        lineWidth: LINE_WIDTH,
        // The hatch's numbers are the kernel's — the same ones the canvas rows are
        // computed from — read out of the published vocabulary. A pen that carried
        // its own copy would let the exported tile and the canvas rows disagree the
        // first time either moved.
        hatchSpacing: HATCH.spacing,
        hatchSlant: HATCH.slant,
        dashSolid: DASH.solid,
        dashDashed: DASH.dashed,
        dashDotted: DASH.dotted,
    });
}