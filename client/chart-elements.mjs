// The chart's transformation: the reader's data becomes elements.
//
// The layout is the pinned reference's, ported in `chart-layout.mjs`: the same
// slot widths, the same measured and rotated category labels, the same
// vertical references and the same legend, so a chart pasted here is the chart
// the reference would draw from the same numbers. This module is the boundary:
// it mints the identity the document format wants on every literal, and it
// puts a linear element's first point at its own origin, which is how the
// reference stores a pasted line.
//
// Everything stays an ordinary element — bars are rectangles, series are
// polylines, labels are texts — so the user can pick any of them up and edit
// it the moment the chart lands.

import { freshSeed } from "./tools.mjs";
import { renderBarChart, renderLineChart } from "./chart-layout.mjs";

/**
 * One literal, stamped the way the paste door's reader expects: the kind at
 * the top level, the geometry beside it, and no identity of its own — the
 * paste machinery mints ids and derives seeds, so a chart's bars and labels
 * arrive as fresh elements even when the same data is pasted twice.
 *
 * @param {object} element the element's own fields, `type` included.
 * @returns {object} the literal.
 */
function stamped(element) {
    return { id: "chart", version: 1, seed: freshSeed(), ...element };
}

/**
 * Put a linear element's first point at its own origin.
 *
 * The document format stores a line's points relative to its first point —
 * the reference does the same when it inserts a pasted chart — so a series
 * whose first value is not zero arrives with its origin at that value and the
 * rest of the route measured from it. A line that already starts at the
 * origin is left untouched.
 *
 * @param {object} element a literal of type "line".
 * @returns {object} the literal, rebased when it needed it.
 */
function rebased(element) {
    if (element.type !== "line" || !Array.isArray(element.points) || element.points.length === 0) {
        return element;
    }
    const [originX, originY] = element.points[0];
    if (originX === 0 && originY === 0) {
        return element;
    }
    const points = element.points.map(([x, y]) => [x - originX, y - originY]);
    const xs = points.map(([x]) => x);
    const ys = points.map(([, y]) => y);
    return {
        ...element,
        x: element.x + originX,
        y: element.y + originY,
        width: Math.max(...xs) - Math.min(...xs),
        height: Math.max(...ys) - Math.min(...ys),
        points,
    };
}

/**
 * A bar chart: the reference's layout, stamped for this document.
 *
 * @param {{title: string|null, labels: string[]|null,
 *   series: {title: string, values: number[]}[]}} spreadsheet the reader's
 *   data.
 * @param {{x: number, y: number, colorSeed?: number}} at the place the paste
 *   decided, and the colour seed the offer drew.
 * @param {object} measure the measurer from `chart-measure.mjs`.
 * @returns {object[]} the literals, in the order they draw.
 */
export function barChartElements(spreadsheet, at, measure) {
    return renderBarChart(spreadsheet, at, measure).map((element) => stamped(rebased(element)));
}

/**
 * A line chart: the reference's layout, stamped for this document.
 *
 * @param {{title: string|null, labels: string[]|null,
 *   series: {title: string, values: number[]}[]}} spreadsheet the reader's
 *   data.
 * @param {{x: number, y: number, colorSeed?: number}} at the place the paste
 *   decided, and the colour seed the offer drew.
 * @param {object} measure the measurer from `chart-measure.mjs`.
 * @returns {object[]} the literals, in the order they draw.
 */
export function lineChartElements(spreadsheet, at, measure) {
    return renderLineChart(spreadsheet, at, measure).map((element) => stamped(rebased(element)));
}
