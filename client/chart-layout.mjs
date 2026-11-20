// The cartesian chart layout, ported from the pinned reference.
//
// Source: `packages/excalidraw/charts/charts.constants.ts`, `charts.helpers.ts`
// (the bar/line half), `charts.bar.ts` and `charts.line.ts` at
// d3a9c2a195182bf65b526ccb7a19de96f4bdfdb3. The reference asks a
// `RenderEnvironment` for the Canvas text measurements that drive its label
// fitting; here that dependency is the injected `measure` seam, so this module
// never touches a canvas or the DOM and stays testable with deterministic
// metrics. Element ids, seeds and versions are the caller's business: every
// return value is a plain literal without them.

/** The base slot of a bar chart. */
export const CARTESIAN_BASE_SLOT_WIDTH = 44;
/** How much a bar slot grows for every series beyond the first. */
export const CARTESIAN_BAR_SLOT_EXTRA_PER_SERIES = 22;
/** The ceiling of the bar slot's series-aware growth. */
export const CARTESIAN_BAR_SLOT_EXTRA_MAX = 66;
/** The base slot of a line chart. */
export const CARTESIAN_LINE_SLOT_WIDTH = 48;
/** The air between cartesian slots, and around the plot. */
export const CARTESIAN_GAP = 14;
/** The plot height of a bar chart, labels excluded. */
export const CARTESIAN_BAR_HEIGHT = 304;
/** The plot height of a line chart, labels excluded. */
export const CARTESIAN_LINE_HEIGHT = 320;
/** The rotation of every category label, as the reference's radians value. */
export const CARTESIAN_LABEL_ROTATION = 5.87;
/** The narrowest a fitted category label may become. */
export const CARTESIAN_LABEL_MIN_WIDTH = 28;
/** Padding between a category slot and the width available to its label. */
export const CARTESIAN_LABEL_SLOT_PADDING = 4;
/** Air between the baseline and the category labels. */
export const CARTESIAN_LABEL_AXIS_CLEARANCE = 2;
/** Extra width allowed when picking a label's candidate width. */
export const CARTESIAN_LABEL_MAX_WIDTH_BUFFER = 10;
/** Extra width allowed for the label's rotated bounding box. */
export const CARTESIAN_LABEL_ROTATED_WIDTH_BUFFER = 10;
/** How far a non-ellipsified label may overflow before the ellipsis wins. */
export const CARTESIAN_LABEL_OVERFLOW_PREFERENCE_BUFFER = 8;

/** The air between a bar and the next one in the same category. */
export const BAR_GAP = 12;
/** The height the radar legend maths is anchored to (also the legend text cap). */
export const BAR_HEIGHT = 256;
/** The opacity of the reference's dashed grid lines. */
export const GRID_OPACITY = 10;

// The legend shares the reference's radar-named layout constants; the radar
// chart itself is deliberately not ported.
const LEGEND_SWATCH_SIZE = 20;
const LEGEND_ITEM_GAP = BAR_GAP * 2;
const LEGEND_TEXT_GAP = BAR_GAP;
const LEGEND_LABEL_OFFSET = BAR_GAP * 2;

/** The reference's font sizes. */
export const FONT_SIZES = Object.freeze({
    sm: 16,
    md: 20,
    lg: 28,
    xl: 36,
});

/** The reference's font family ids. */
export const FONT_FAMILY = Object.freeze({
    Virgil: 1,
    Helvetica: 2,
    Cascadia: 3,
    Excalifont: 5,
    Nunito: 6,
    "Lilita One": 7,
    "Comic Shanns": 8,
    "Liberation Sans": 9,
    Assistant: 10,
});

/** The default chart text family. */
export const DEFAULT_FONT_FAMILY = FONT_FAMILY.Excalifont;
/** The default chart text size. */
export const DEFAULT_FONT_SIZE = 20;

/** The two palette slots the charts themselves use. */
export const COLOR_PALETTE = Object.freeze({
    transparent: "transparent",
    black: "#1e1e1e",
});

/** The roughness values the reference names. */
export const ROUGHNESS = Object.freeze({
    architect: 0,
    artist: 1,
    cartoonist: 2,
});

/** The roundness algorithm ids the reference names. */
export const ROUNDNESS = Object.freeze({
    LEGACY: 1,
    PROPORTIONAL_RADIUS: 2,
    ADAPTIVE_RADIUS: 3,
});

/** The vertical alignment values the reference names. */
export const VERTICAL_ALIGN = Object.freeze({
    TOP: "top",
    MIDDLE: "middle",
    BOTTOM: "bottom",
});

/**
 * `getAllColorsSpecificShade(DEFAULT_CHART_COLOR_INDEX)` with
 * `DEFAULT_CHART_COLOR_INDEX = 4`: the ten row-4 tones, in palette order.
 */
export const bgColors = Object.freeze([
    "#0c8599", // cyan
    "#1971c2", // blue
    "#6741d9", // violet
    "#9c36b5", // grape
    "#c2255c", // pink
    "#2f9e44", // green
    "#099268", // teal
    "#f08c00", // yellow
    "#e8590c", // orange
    "#e03131", // red
]);

/**
 * The properties every chart element shares, so the properties dialog shows
 * stable values when a chart group is selected.
 */
export const commonProps = Object.freeze({
    fillStyle: "hachure",
    fontFamily: DEFAULT_FONT_FAMILY,
    fontSize: DEFAULT_FONT_SIZE,
    opacity: 100,
    roughness: 1,
    strokeColor: COLOR_PALETTE.black,
    roundness: null,
    strokeStyle: "solid",
    strokeWidth: 1,
    verticalAlign: VERTICAL_ALIGN.MIDDLE,
    locked: false,
});

/**
 * @typedef {Object} TextMetrics
 * @property {number} width
 * @property {number} height
 */

/**
 * @typedef {Object} TextMeasurer
 * @property {(text: string, fontString: string) => TextMetrics} measure
 * @property {(fontString: string) => number} minLineWidth
 * @property {(text: string, maxWidth: number, fontString: string) => string} wrap
 * @property {(font: {fontFamily: number, fontSize: number}) => string} fontString
 */

/**
 * @typedef {Object} SpreadsheetSeries
 * @property {string|null} title
 * @property {number[]} values
 */

/**
 * @typedef {Object} Spreadsheet
 * @property {string|null} title
 * @property {string[]|null} labels
 * @property {SpreadsheetSeries[]} series
 */

/**
 * The place a chart is anchored. `colorSeed` (or the caller's `seed`) pins the
 * reference's palette offset; without it the reference picks it at random.
 *
 * @typedef {Object} ChartAt
 * @property {number} x
 * @property {number} y
 * @property {number} [colorSeed]
 * @property {number} [seed]
 * @property {boolean} [debug]
 */

/**
 * @typedef {Object} CartesianChartLayout
 * @property {number} slotWidth
 * @property {number} gap
 * @property {number} chartHeight
 * @property {number} xLabelMaxWidth
 */

/**
 * @typedef {Object} CartesianAxisLabelSpec
 * @property {string} originalText
 * @property {string} text
 * @property {boolean} wrapped
 * @property {TextMetrics} metrics
 * @property {number} rotatedWidth
 * @property {number} rotatedHeight
 */

/**
 * The unitless line height the reference uses for a family.
 *
 * @param {number} fontFamily the family id.
 * @returns {number} the line height multiplier.
 */
export function getLineHeight(fontFamily) {
    if (fontFamily === FONT_FAMILY["Lilita One"]) {
        return 1.15;
    }
    return 1.25;
}

/**
 * Normalizes line endings and tabs, as the reference's text constructor does.
 *
 * @param {string} text the raw text.
 * @returns {string} the normalized text.
 */
function normalizeText(text) {
    return text.replace(/\r?\n|\r/g, "\n").replace(/\t/g, "        ");
}

/**
 * The reference's `newTextElement`: measures the text, resolves the style and
 * shifts x/y by the anchor implied by the alignment. The caller supplies the
 * anchor, which is why a centered label's x ends up `x - width / 2`.
 *
 * @param {TextMeasurer} measure the injected text measurer.
 * @param {Object} opts the text options.
 * @param {string} opts.text the text.
 * @param {number} opts.x the anchor x.
 * @param {number} opts.y the anchor y.
 * @param {string} [opts.originalText] the unedited text.
 * @param {number} [opts.fontSize] the font size.
 * @param {number} [opts.fontFamily] the font family.
 * @param {number} [opts.lineHeight] the unitless line height.
 * @param {string} [opts.textAlign] the horizontal alignment.
 * @param {string} [opts.verticalAlign] the vertical alignment.
 * @param {boolean} [opts.autoResize] whether the text grows with its content.
 * @param {number} [opts.angle] the rotation.
 * @param {string} [opts.backgroundColor] the background.
 * @returns {object} the text literal.
 */
function textElement(measure, opts) {
    const fontFamily = opts.fontFamily || DEFAULT_FONT_FAMILY;
    const fontSize = opts.fontSize || DEFAULT_FONT_SIZE;
    const lineHeight = opts.lineHeight || getLineHeight(fontFamily);
    const text = normalizeText(opts.text);
    const fontString = measure.fontString({ fontFamily, fontSize });
    const metrics = measure.measure(text, fontString);
    const textAlign = opts.textAlign || "left";
    // Every chart text spreads `commonProps`, so its vertical default is the
    // middle, not the standalone constructor's top.
    const verticalAlign = opts.verticalAlign || commonProps.verticalAlign;
    const anchorX =
        textAlign === "center" ? metrics.width / 2 : textAlign === "right" ? metrics.width : 0;
    const anchorY =
        verticalAlign === VERTICAL_ALIGN.MIDDLE
            ? metrics.height / 2
            : verticalAlign === VERTICAL_ALIGN.BOTTOM
            ? metrics.height
            : 0;

    return {
        type: "text",
        x: opts.x - anchorX,
        y: opts.y - anchorY,
        width: metrics.width,
        height: metrics.height,
        angle: opts.angle || 0,
        fontSize,
        fontFamily,
        lineHeight,
        text,
        originalText: opts.originalText ?? text,
        autoResize: opts.autoResize ?? true,
        textAlign,
        verticalAlign,
        backgroundColor: opts.backgroundColor ?? COLOR_PALETTE.transparent,
        strokeColor: opts.strokeColor ?? commonProps.strokeColor,
        fillStyle: opts.fillStyle ?? commonProps.fillStyle,
        strokeWidth: opts.strokeWidth ?? commonProps.strokeWidth,
        strokeStyle: opts.strokeStyle ?? commonProps.strokeStyle,
        roughness: opts.roughness ?? commonProps.roughness,
        roundness: opts.roundness === undefined ? commonProps.roundness : opts.roundness,
        opacity: opts.opacity ?? commonProps.opacity,
        locked: opts.locked ?? commonProps.locked,
    };
}

/**
 * The reference's `newElement`/`newLinearElement`: resolves the common style
 * and adds `points` only to the linear elements.
 *
 * @param {Object} opts the element options.
 * @param {string} opts.type the element type.
 * @param {number} opts.x the left edge.
 * @param {number} opts.y the top edge.
 * @param {number} [opts.width] the width.
 * @param {number} [opts.height] the height.
 * @param {number} [opts.angle] the rotation.
 * @param {number[][]} [opts.points] the local points of a line.
 * @param {string} [opts.backgroundColor] the background.
 * @param {string} [opts.strokeColor] the stroke.
 * @param {string} [opts.fillStyle] the fill style.
 * @param {number} [opts.strokeWidth] the stroke width.
 * @param {string} [opts.strokeStyle] the stroke style.
 * @param {number} [opts.roughness] the roughness.
 * @param {object|null} [opts.roundness] the roundness.
 * @param {number} [opts.opacity] the opacity.
 * @returns {object} the shape literal.
 */
function shapeElement(opts) {
    const element = {
        type: opts.type,
        x: opts.x,
        y: opts.y,
        width: opts.width ?? 0,
        height: opts.height ?? 0,
        angle: opts.angle || 0,
        backgroundColor: opts.backgroundColor ?? COLOR_PALETTE.transparent,
        strokeColor: opts.strokeColor ?? commonProps.strokeColor,
        fillStyle: opts.fillStyle ?? commonProps.fillStyle,
        strokeWidth: opts.strokeWidth ?? commonProps.strokeWidth,
        strokeStyle: opts.strokeStyle ?? commonProps.strokeStyle,
        roughness: opts.roughness ?? commonProps.roughness,
        roundness: opts.roundness === undefined ? commonProps.roundness : opts.roundness,
        opacity: opts.opacity ?? commonProps.opacity,
        locked: opts.locked ?? commonProps.locked,
    };

    if (opts.points !== undefined) {
        element.points = opts.points;
    }

    return element;
}

/**
 * One value per category, with the slot growing to keep series readable.
 *
 * @param {number} baseSlotWidth the chart type's base slot.
 * @param {number} seriesCount the number of series.
 * @returns {number} the series-aware slot width.
 */
export function getSeriesAwareSlotWidth(baseSlotWidth, seriesCount) {
    const extraSlotWidth =
        seriesCount <= 1
            ? 0
            : Math.min(
                  CARTESIAN_BAR_SLOT_EXTRA_MAX,
                  (seriesCount - 1) * CARTESIAN_BAR_SLOT_EXTRA_PER_SERIES,
              );
    return baseSlotWidth + extraSlotWidth;
}

/**
 * The cartesian layout of a bar or line chart.
 *
 * @param {"bar"|"line"} chartType the chart type.
 * @param {number} seriesCount the number of series.
 * @returns {CartesianChartLayout} the layout.
 */
export function getCartesianChartLayout(chartType, seriesCount) {
    if (chartType === "line") {
        const slotWidth = getSeriesAwareSlotWidth(CARTESIAN_LINE_SLOT_WIDTH, seriesCount);
        return {
            slotWidth,
            gap: CARTESIAN_GAP,
            chartHeight: CARTESIAN_LINE_HEIGHT,
            xLabelMaxWidth:
                slotWidth + CARTESIAN_GAP * 3 + CARTESIAN_LABEL_MAX_WIDTH_BUFFER,
        };
    }

    const slotWidth = getSeriesAwareSlotWidth(CARTESIAN_BASE_SLOT_WIDTH, seriesCount);
    return {
        slotWidth,
        gap: CARTESIAN_GAP,
        chartHeight: CARTESIAN_BAR_HEIGHT,
        xLabelMaxWidth: slotWidth + CARTESIAN_GAP * 3 + CARTESIAN_LABEL_MAX_WIDTH_BUFFER,
    };
}

/**
 * The plot's width and height, gaps included.
 *
 * @param {Spreadsheet} spreadsheet the chart data.
 * @param {CartesianChartLayout} layout the chart layout.
 * @returns {{chartWidth: number, chartHeight: number}} the dimensions.
 */
export function getChartDimensions(spreadsheet, layout) {
    const chartWidth =
        (layout.slotWidth + layout.gap) * spreadsheet.series[0].values.length + layout.gap;
    const chartHeight = layout.chartHeight + layout.gap * 2;
    return { chartWidth, chartHeight };
}

/**
 * The circular distance between two palette indices.
 *
 * @param {number} firstIndex the first index.
 * @param {number} secondIndex the second index.
 * @param {number} paletteSize the palette length.
 * @returns {number} the shortest distance.
 */
function getCircularDistance(firstIndex, secondIndex, paletteSize) {
    const absoluteDistance = Math.abs(firstIndex - secondIndex);
    return Math.min(absoluteDistance, paletteSize - absoluteDistance);
}

/**
 * The series colors, spreading them as far apart as the palette allows.
 *
 * @param {number} seriesCount the number of series.
 * @param {number} colorOffset the starting palette index.
 * @returns {string[]} the colors, one per series.
 */
export function getSeriesColors(seriesCount, colorOffset) {
    if (seriesCount <= 0 || bgColors.length === 0) {
        return [];
    }

    const paletteSize = bgColors.length;
    const startIndex = ((colorOffset % paletteSize) + paletteSize) % paletteSize;
    const selectedIndices = [startIndex];
    const maxUniqueColors = Math.min(seriesCount, paletteSize);
    const availableIndices = new Set(
        Array.from({ length: paletteSize }, (_, index) => index).filter(
            (index) => index !== startIndex,
        ),
    );

    while (selectedIndices.length < maxUniqueColors) {
        let bestIndex = -1;
        let bestMinDistance = -1;
        let bestAverageDistance = -1;

        for (const candidateIndex of availableIndices) {
            const distances = selectedIndices.map((selectedIndex) =>
                getCircularDistance(candidateIndex, selectedIndex, paletteSize),
            );
            const minDistance = Math.min(...distances);
            const averageDistance =
                distances.reduce((total, distance) => total + distance, 0) / distances.length;

            if (
                minDistance > bestMinDistance ||
                (minDistance === bestMinDistance && averageDistance > bestAverageDistance)
            ) {
                bestIndex = candidateIndex;
                bestMinDistance = minDistance;
                bestAverageDistance = averageDistance;
            }
        }

        selectedIndices.push(bestIndex);
        availableIndices.delete(bestIndex);
    }

    return Array.from(
        { length: seriesCount },
        (_, index) => bgColors[selectedIndices[index % selectedIndices.length]],
    );
}

/**
 * The palette offset for a color seed, with the reference's string hash.
 *
 * @param {number} [colorSeed] the caller's seed.
 * @returns {number} a palette index.
 */
export function getColorOffset(colorSeed) {
    if (bgColors.length === 0) {
        return 0;
    }

    if (typeof colorSeed !== "number" || !Number.isFinite(colorSeed)) {
        return Math.floor(Math.random() * bgColors.length);
    }

    const seedText = colorSeed.toString();
    let hash = 0;
    for (let index = 0; index < seedText.length; index++) {
        hash = (hash * 31 + seedText.charCodeAt(index)) | 0;
    }
    return Math.abs(hash) % bgColors.length;
}

/**
 * The chart's background color for a palette offset.
 *
 * @param {number} colorOffset the palette index.
 * @returns {string} the color.
 */
export function getBackgroundColor(colorOffset) {
    return bgColors[colorOffset];
}

/**
 * The rotated bounding box of a `width × height` rectangle.
 *
 * @param {number} width the unrotated width.
 * @param {number} height the unrotated height.
 * @param {number} angle the rotation in radians.
 * @returns {{width: number, height: number}} the rotated box.
 */
function getRotatedBoundingBox(width, height, angle) {
    const cos = Math.abs(Math.cos(angle));
    const sin = Math.abs(Math.sin(angle));
    return {
        width: width * cos + height * sin,
        height: width * sin + height * cos,
    };
}

/**
 * The bottom of an element after its rotation, which is what the legend clears.
 *
 * @param {object} element the element literal.
 * @returns {number} the bottom y.
 */
export function getRotatedTextElementBottom(element) {
    if (element.type !== "text") {
        return element.y + element.height;
    }
    const rotated = getRotatedBoundingBox(element.width, element.height, element.angle);
    return element.y + element.height / 2 + rotated.height / 2;
}

/**
 * Whether the label already carries an ellipsis.
 *
 * @param {string} text the label.
 * @returns {boolean} true when it ends in the inserted marker.
 */
function isEllipsifiedLabel(text) {
    return text.includes("...");
}

/**
 * Truncates to `maxWidth` with a trailing ellipsis, measuring every candidate.
 *
 * @param {string} text the label.
 * @param {number} maxWidth the width budget.
 * @param {string} fontString the font.
 * @param {TextMeasurer} measure the measurer.
 * @returns {string} the shortened label.
 */
function ellipsifyTextToWidth(text, maxWidth, fontString, measure) {
    if (measure.measure(text, fontString).width <= maxWidth) {
        return text;
    }

    let end = text.length;
    while (end > 1) {
        const candidate = `${text.slice(0, end)}...`;
        if (measure.measure(candidate, fontString).width <= maxWidth) {
            return candidate;
        }
        end--;
    }

    return text[0] ? `${text[0]}...` : text;
}

/**
 * Wraps when the words fit the budget, otherwise ellipsifies.
 *
 * @param {string} text the label.
 * @param {number} maxWidth the width budget.
 * @param {string} fontString the font.
 * @param {TextMeasurer} measure the measurer.
 * @returns {{wrapped: boolean, text: string}} the chosen transformation.
 */
function wrapOrEllipsifyTextToWidth(text, maxWidth, fontString, measure) {
    if (measure.measure(text, fontString).width <= maxWidth) {
        return { wrapped: false, text };
    }

    const words = text.trim().split(/\s+/).filter(Boolean);
    if (words.length > 1) {
        const hasLongWord = words.some(
            (word) => measure.measure(word, fontString).width > maxWidth,
        );
        if (!hasLongWord && maxWidth >= measure.minLineWidth(fontString)) {
            return {
                wrapped: true,
                text: measure.wrap(text, maxWidth, fontString),
            };
        }
    }

    return {
        wrapped: false,
        text: ellipsifyTextToWidth(text, maxWidth, fontString, measure),
    };
}

/**
 * The reference's label-fit search: walk candidate widths down from the maximum
 * in steps of four, rank the outcomes (no ellipsis, more visible characters,
 * fewer lines, smaller rotated height) and prefer a fitting box, tolerating a
 * small overflow for a non-ellipsified label.
 *
 * @param {string} label the category label.
 * @param {number} maxLabelWidth the widest candidate.
 * @param {number} maxRotatedWidth the rotated width budget.
 * @param {string} fontString the font.
 * @param {TextMeasurer} measure the measurer.
 * @returns {CartesianAxisLabelSpec} the chosen label.
 */
export function getCartesianAxisLabelSpec(
    label,
    maxLabelWidth,
    maxRotatedWidth,
    fontString,
    measure,
) {
    const minWidth = Math.max(
        CARTESIAN_LABEL_MIN_WIDTH,
        Math.ceil(measure.minLineWidth(fontString)),
    );
    const maxWidth = Math.max(minWidth, Math.floor(maxLabelWidth));
    const candidateWidths = [];
    for (let width = maxWidth; width >= minWidth; width -= 4) {
        candidateWidths.push(width);
    }
    if (candidateWidths[candidateWidths.length - 1] !== minWidth) {
        candidateWidths.push(minWidth);
    }

    const getRank = (spec) => {
        const ellipsified = isEllipsifiedLabel(spec.text);
        const visibleChars = spec.text.replace(/\.\.\./g, "").replace(/\n/g, "").length;
        const lineCount = spec.text.split("\n").length;
        return { ellipsified, visibleChars, lineCount };
    };

    const shouldPrefer = (candidate, current) => {
        const candidateRank = getRank(candidate);
        const currentRank = getRank(current);
        if (candidateRank.ellipsified !== currentRank.ellipsified) {
            return !candidateRank.ellipsified;
        }
        if (candidateRank.visibleChars !== currentRank.visibleChars) {
            return candidateRank.visibleChars > currentRank.visibleChars;
        }
        if (candidateRank.lineCount !== currentRank.lineCount) {
            return candidateRank.lineCount < currentRank.lineCount;
        }
        return candidate.rotatedHeight < current.rotatedHeight;
    };

    let bestFit = null;
    let bestOverflowAny = null;
    let bestOverflowNonEllipsified = null;

    for (const width of candidateWidths) {
        const { wrapped, text } = wrapOrEllipsifyTextToWidth(label, width, fontString, measure);
        const metrics = measure.measure(text, fontString);
        const rotated = getRotatedBoundingBox(
            metrics.width,
            metrics.height,
            CARTESIAN_LABEL_ROTATION,
        );
        const spec = {
            originalText: label,
            text,
            metrics,
            rotatedWidth: rotated.width,
            rotatedHeight: rotated.height,
            wrapped,
        };
        const overflow = rotated.width - maxRotatedWidth;
        if (overflow <= 0) {
            if (!bestFit || shouldPrefer(spec, bestFit)) {
                bestFit = spec;
            }
            continue;
        }
        if (
            !bestOverflowAny ||
            overflow < bestOverflowAny.overflow ||
            (overflow === bestOverflowAny.overflow && shouldPrefer(spec, bestOverflowAny.spec))
        ) {
            bestOverflowAny = { overflow, spec };
        }
        if (
            !isEllipsifiedLabel(spec.text) &&
            (!bestOverflowNonEllipsified ||
                overflow < bestOverflowNonEllipsified.overflow ||
                (overflow === bestOverflowNonEllipsified.overflow &&
                    shouldPrefer(spec, bestOverflowNonEllipsified.spec)))
        ) {
            bestOverflowNonEllipsified = { overflow, spec };
        }
    }

    if (bestFit) {
        return bestFit;
    }

    if (
        bestOverflowNonEllipsified &&
        bestOverflowAny &&
        bestOverflowNonEllipsified.overflow <=
            bestOverflowAny.overflow + CARTESIAN_LABEL_OVERFLOW_PREFERENCE_BUFFER
    ) {
        return bestOverflowNonEllipsified.spec;
    }

    // The candidate list is never empty, so one of the two overflow pools
    // always holds the winner when no candidate fits.
    return bestOverflowAny.spec;
}

/**
 * The rotated category labels under the plot.
 *
 * @param {Spreadsheet} spreadsheet the chart data.
 * @param {number} x the chart's left.
 * @param {number} y the chart's baseline.
 * @param {string} backgroundColor the chart background.
 * @param {CartesianChartLayout} layout the chart layout.
 * @param {TextMeasurer} measure the measurer.
 * @returns {object[]} the label literals.
 */
export function chartXLabels(spreadsheet, x, y, backgroundColor, layout, measure) {
    const fontFamily = commonProps.fontFamily;
    const fontSize = FONT_SIZES.sm;
    const lineHeight = getLineHeight(fontFamily);
    const fontString = measure.fontString({ fontFamily, fontSize });
    const maxRotatedWidth = Math.max(
        1,
        layout.slotWidth +
            layout.gap -
            CARTESIAN_LABEL_SLOT_PADDING * 2 +
            CARTESIAN_LABEL_ROTATED_WIDTH_BUFFER,
    );
    const axisY = y;

    return (spreadsheet.labels || []).map((label, index) => {
        const labelSpec = getCartesianAxisLabelSpec(
            label,
            layout.xLabelMaxWidth,
            maxRotatedWidth,
            fontString,
            measure,
        );
        const centerX =
            x +
            index * (layout.slotWidth + layout.gap) +
            layout.gap +
            layout.slotWidth / 2;
        const labelY =
            axisY +
            CARTESIAN_LABEL_AXIS_CLEARANCE +
            (labelSpec.rotatedHeight - labelSpec.metrics.height) / 2;

        return textElement(measure, {
            backgroundColor,
            text: labelSpec.text,
            originalText: labelSpec.wrapped ? label : labelSpec.text,
            autoResize: !labelSpec.wrapped,
            x: centerX,
            y: labelY,
            angle: CARTESIAN_LABEL_ROTATION,
            fontSize,
            lineHeight,
            textAlign: "center",
            verticalAlign: "top",
        });
    });
}

/**
 * The two horizontal value references, `0` and the maximum.
 *
 * @param {Spreadsheet} spreadsheet the chart data.
 * @param {number} x the chart's left.
 * @param {number} y the chart's baseline.
 * @param {string} backgroundColor the chart background.
 * @param {CartesianChartLayout} layout the chart layout.
 * @param {number} [maxValue] the value at the top of the plot.
 * @param {TextMeasurer} measure the measurer.
 * @returns {object[]} the two label literals, low then high.
 */
export function chartYLabels(spreadsheet, x, y, backgroundColor, layout, maxValue, measure) {
    const value = maxValue === undefined ? Math.max(...spreadsheet.series[0].values) : maxValue;

    const minYLabel = textElement(measure, {
        backgroundColor,
        x: x - layout.gap,
        y: y - layout.gap,
        text: "0",
        textAlign: "right",
    });

    const maxYLabel = textElement(measure, {
        backgroundColor,
        x: x - layout.gap,
        y: y - layout.chartHeight - minYLabel.height / 2,
        text: value.toLocaleString(),
        textAlign: "right",
    });

    return [minYLabel, maxYLabel];
}

/**
 * The axes and the dotted maximum guide.
 *
 * @param {Spreadsheet} spreadsheet the chart data.
 * @param {number} x the chart's left.
 * @param {number} y the chart's baseline.
 * @param {string} backgroundColor the chart background.
 * @param {CartesianChartLayout} layout the chart layout.
 * @returns {object[]} the three line literals.
 */
export function chartLines(spreadsheet, x, y, backgroundColor, layout) {
    const { chartWidth, chartHeight } = getChartDimensions(spreadsheet, layout);
    const xLine = shapeElement({
        backgroundColor,
        type: "line",
        x,
        y,
        width: chartWidth,
        points: [
            [0, 0],
            [chartWidth, 0],
        ],
    });

    const yLine = shapeElement({
        backgroundColor,
        type: "line",
        x,
        y,
        height: chartHeight,
        points: [
            [0, 0],
            [0, -chartHeight],
        ],
    });

    const maxLine = shapeElement({
        backgroundColor,
        type: "line",
        x,
        y: y - layout.chartHeight - layout.gap,
        strokeStyle: "dotted",
        width: chartWidth,
        opacity: GRID_OPACITY,
        points: [
            [0, 0],
            [chartWidth, 0],
        ],
    });

    return [xLine, yLine, maxLine];
}

/**
 * The shared prologue every cartesian chart draws: title, category labels,
 * value references and grid lines. The debug rectangle only exists when the
 * caller asks for it; the reference's dev-environment auto-debug is gone.
 *
 * @param {Spreadsheet} spreadsheet the chart data.
 * @param {number} x the chart's left.
 * @param {number} y the chart's baseline.
 * @param {string} backgroundColor the chart background.
 * @param {CartesianChartLayout} layout the chart layout.
 * @param {number} [maxValue] the value at the top of the plot.
 * @param {boolean} [debug] whether to draw the debug rectangle.
 * @param {TextMeasurer} measure the measurer.
 * @returns {object[]} the base literals, in draw order.
 */
export function chartBaseElements(
    spreadsheet,
    x,
    y,
    backgroundColor,
    layout,
    maxValue,
    debug,
    measure,
) {
    const { chartWidth, chartHeight } = getChartDimensions(spreadsheet, layout);

    const title = spreadsheet.title
        ? textElement(measure, {
              backgroundColor,
              text: spreadsheet.title,
              x: x + chartWidth / 2,
              y: y - layout.chartHeight - layout.gap * 2 - DEFAULT_FONT_SIZE,
              roundness: null,
              textAlign: "center",
              fontSize: FONT_SIZES.xl,
              fontFamily: FONT_FAMILY["Lilita One"],
          })
        : null;

    const debugRect = debug
        ? shapeElement({
              backgroundColor,
              type: "rectangle",
              x,
              y: y - chartHeight,
              width: chartWidth,
              height: chartHeight,
              strokeColor: COLOR_PALETTE.black,
              fillStyle: "solid",
              opacity: 6,
          })
        : null;

    return [
        ...(debugRect ? [debugRect] : []),
        ...(title ? [title] : []),
        ...chartXLabels(spreadsheet, x, y, backgroundColor, layout, measure),
        ...chartYLabels(spreadsheet, x, y, backgroundColor, layout, maxValue, measure),
        ...chartLines(spreadsheet, x, y, backgroundColor, layout),
    ];
}

/**
 * The legend's display text: the reference wraps only labels that contain
 * whitespace and leaves single words to the legend's natural width.
 *
 * @param {string} text the label.
 * @param {string} fontString the font.
 * @param {number} maxWidth the wrap width.
 * @param {TextMeasurer} measure the measurer.
 * @returns {string} the display text.
 */
function getLegendDisplayText(text, fontString, maxWidth, measure) {
    return /\s/.test(text.trim()) ? measure.wrap(text, maxWidth, fontString) : text;
}

/**
 * The series legend: a translucent pill, one solid swatch and one editable
 * label per series. A single-series chart gets no legend.
 *
 * @param {SpreadsheetSeries[]} series the chart series.
 * @param {string[]} seriesColors the colors, one per series.
 * @param {number} centerX the legend's center.
 * @param {number} minLegendTopY the first free y under the category labels.
 * @param {number} fallbackLegendY the minimum legend y.
 * @param {TextMeasurer} measure the measurer.
 * @returns {object[]} the legend literals.
 */
export function createSeriesLegend(
    series,
    seriesColors,
    centerX,
    minLegendTopY,
    fallbackLegendY,
    measure,
) {
    if (series.length <= 1) {
        return [];
    }

    const fontFamily = FONT_FAMILY["Lilita One"];
    const fontSize = FONT_SIZES.lg;
    const lineHeight = getLineHeight(fontFamily);
    const fontString = measure.fontString({ fontFamily, fontSize });
    const legendItems = series.map((seriesItem, index) => {
        const label = seriesItem.title?.trim() || `Series ${index + 1}`;
        const displayLabel = getLegendDisplayText(label, fontString, BAR_HEIGHT, measure);
        const metrics = measure.measure(displayLabel, fontString);
        const itemWidth = LEGEND_SWATCH_SIZE + LEGEND_TEXT_GAP + metrics.width;
        return {
            label,
            displayLabel,
            color: seriesColors[index],
            width: itemWidth,
            height: metrics.height,
        };
    });
    const maxLegendHalfHeight = Math.max(
        LEGEND_SWATCH_SIZE / 2,
        ...legendItems.map((item) => item.height / 2),
    );
    const legendY = Math.max(
        fallbackLegendY,
        minLegendTopY + maxLegendHalfHeight + LEGEND_LABEL_OFFSET,
    );

    const pillPaddingX = LEGEND_ITEM_GAP;
    const pillPaddingY = LEGEND_SWATCH_SIZE * 0.6;
    const totalLegendWidth =
        legendItems.reduce((total, item) => total + item.width, 0) +
        LEGEND_ITEM_GAP * Math.max(0, legendItems.length - 1);
    const pillWidth = totalLegendWidth + pillPaddingX * 2;
    const pillHeight = maxLegendHalfHeight * 2 + pillPaddingY * 2;

    const legendElements = [];

    legendElements.push(
        shapeElement({
            backgroundColor: COLOR_PALETTE.transparent,
            type: "rectangle",
            fillStyle: "solid",
            strokeColor: COLOR_PALETTE.black,
            x: centerX - pillWidth / 2,
            y: legendY - pillHeight / 2,
            width: pillWidth,
            height: pillHeight,
            roughness: ROUGHNESS.architect,
            roundness: { type: ROUNDNESS.PROPORTIONAL_RADIUS },
        }),
    );

    let cursorX = centerX - totalLegendWidth / 2;

    legendItems.forEach((item) => {
        legendElements.push(
            shapeElement({
                backgroundColor: item.color,
                type: "rectangle",
                x: cursorX,
                y: legendY - LEGEND_SWATCH_SIZE / 2,
                width: LEGEND_SWATCH_SIZE,
                height: LEGEND_SWATCH_SIZE,
                fillStyle: "solid",
                strokeColor: item.color,
                roughness: ROUGHNESS.architect,
                roundness: { type: ROUNDNESS.PROPORTIONAL_RADIUS },
            }),
        );

        legendElements.push(
            textElement(measure, {
                text: item.displayLabel,
                originalText: item.label,
                autoResize: false,
                x: cursorX + LEGEND_SWATCH_SIZE + LEGEND_TEXT_GAP,
                y: legendY,
                fontFamily,
                fontSize,
                lineHeight,
                textAlign: "left",
                verticalAlign: "middle",
            }),
        );

        cursorX += item.width + LEGEND_ITEM_GAP;
    });

    return legendElements;
}

/**
 * The palette offset a caller pinned through `at`, if any.
 *
 * @param {ChartAt} at the chart anchor.
 * @returns {number|undefined} the seed.
 */
function colorSeedFrom(at) {
    if (typeof at.colorSeed === "number") {
        return at.colorSeed;
    }
    return at.seed;
}

/**
 * A bar chart: title, category labels, value references, grid, one rectangle
 * per value and the legend when there is more than one series.
 *
 * @param {Spreadsheet} spreadsheet the chart data.
 * @param {ChartAt} at the anchor (x/y, optionally colorSeed/seed/debug).
 * @param {TextMeasurer} measure the injected measurer.
 * @returns {object[]} the element literals, in draw order.
 */
export function renderBarChart(spreadsheet, at, measure) {
    const series = spreadsheet.series;
    const layout = getCartesianChartLayout("bar", series.length);
    const max = Math.max(
        1,
        ...series.flatMap((seriesData) =>
            seriesData.values.map((value) => Math.max(0, value)),
        ),
    );
    const colorOffset = getColorOffset(colorSeedFrom(at));
    const backgroundColor = getBackgroundColor(colorOffset);
    const seriesColors = getSeriesColors(series.length, colorOffset);
    const interBarGap =
        series.length > 1 ? Math.max(1, Math.floor(layout.gap / (series.length + 1))) : 0;
    const barWidth =
        series.length > 1
            ? Math.max(
                  2,
                  (layout.slotWidth - interBarGap * (series.length - 1)) / series.length,
              )
            : layout.slotWidth;
    const clusterWidth = series.length * barWidth + interBarGap * (series.length - 1);
    const clusterOffset = (layout.slotWidth - clusterWidth) / 2;

    const bars = series[0].values.flatMap((_, categoryIndex) =>
        series.map((seriesData, seriesIndex) => {
            const value = Math.max(0, seriesData.values[categoryIndex] ?? 0);
            const barHeight = (value / max) * layout.chartHeight;
            const barColor =
                series.length > 1 ? seriesColors[seriesIndex] : backgroundColor;
            return shapeElement({
                backgroundColor: barColor,
                type: "rectangle",
                fillStyle: series.length > 1 ? "solid" : commonProps.fillStyle,
                strokeColor: series.length > 1 ? barColor : commonProps.strokeColor,
                x:
                    at.x +
                    categoryIndex * (layout.slotWidth + layout.gap) +
                    layout.gap +
                    clusterOffset +
                    seriesIndex * (barWidth + interBarGap),
                y: at.y - barHeight - layout.gap,
                width: barWidth,
                height: barHeight,
            });
        }),
    );

    const baseElements = chartBaseElements(
        spreadsheet,
        at.x,
        at.y,
        backgroundColor,
        layout,
        max,
        at.debug === true,
        measure,
    );
    const xLabels = chartXLabels(
        spreadsheet,
        at.x,
        at.y,
        backgroundColor,
        layout,
        measure,
    );
    const xLabelsBottomY = Math.max(
        at.y + layout.gap / 2,
        ...xLabels.map((label) => getRotatedTextElementBottom(label)),
    );
    const { chartWidth } = getChartDimensions(spreadsheet, layout);
    const seriesLegend = createSeriesLegend(
        series,
        seriesColors,
        at.x + chartWidth / 2,
        xLabelsBottomY,
        at.y + layout.gap * 5,
        measure,
    );

    return [...baseElements, ...bars, ...seriesLegend];
}

/**
 * A line chart: one polyline per series, a dotted guide down from each
 * category's highest value, one marker per value and the series legend.
 *
 * @param {Spreadsheet} spreadsheet the chart data.
 * @param {ChartAt} at the anchor (x/y, optionally colorSeed/seed/debug).
 * @param {TextMeasurer} measure the injected measurer.
 * @returns {object[]} the element literals, in draw order.
 */
export function renderLineChart(spreadsheet, at, measure) {
    const series = spreadsheet.series;
    const layout = getCartesianChartLayout("line", series.length);
    const max = Math.max(1, ...series.flatMap((seriesData) => seriesData.values));
    const colorOffset = getColorOffset(colorSeedFrom(at));
    const backgroundColor = getBackgroundColor(colorOffset);
    const seriesColors = getSeriesColors(series.length, colorOffset);

    const lines = series.map((seriesData, seriesIndex) => {
        const points = seriesData.values.map((value, valueIndex) => [
            valueIndex * (layout.slotWidth + layout.gap),
            -(value / max) * layout.chartHeight,
        ]);

        const maxX = Math.max(...points.map((point) => point[0]));
        const maxY = Math.max(...points.map((point) => point[1]));
        const minX = Math.min(...points.map((point) => point[0]));
        const minY = Math.min(...points.map((point) => point[1]));

        return shapeElement({
            backgroundColor: COLOR_PALETTE.transparent,
            type: "line",
            x: at.x + layout.gap + layout.slotWidth / 2,
            y: at.y - layout.gap,
            height: maxY - minY,
            width: maxX - minX,
            strokeColor: seriesColors[seriesIndex],
            strokeWidth: 2,
            points,
        });
    });

    const dots = series.flatMap((seriesData, seriesIndex) =>
        seriesData.values.map((value, valueIndex) => {
            const cx = valueIndex * (layout.slotWidth + layout.gap) + layout.gap / 2;
            const cy = -(value / max) * layout.chartHeight + layout.gap / 2;
            return shapeElement({
                backgroundColor: seriesColors[seriesIndex],
                fillStyle: "solid",
                strokeColor: seriesColors[seriesIndex],
                strokeWidth: 2,
                type: "ellipse",
                x: at.x + cx + layout.slotWidth / 2,
                y: at.y + cy - layout.gap * 2,
                width: layout.gap,
                height: layout.gap,
            });
        }),
    );

    const guideValues = series[0].values.map((_, valueIndex) =>
        Math.max(
            0,
            ...series.map((seriesData) => seriesData.values[valueIndex] ?? 0),
        ),
    );
    const guides = guideValues.map((value, valueIndex) => {
        const cx = valueIndex * (layout.slotWidth + layout.gap) + layout.gap / 2;
        const cy = (value / max) * layout.chartHeight + layout.gap / 2 + layout.gap;
        return shapeElement({
            backgroundColor,
            type: "line",
            x: at.x + cx + layout.slotWidth / 2 + layout.gap / 2,
            y: at.y - cy,
            height: cy,
            strokeStyle: "dotted",
            opacity: GRID_OPACITY,
            points: [
                [0, 0],
                [0, cy],
            ],
        });
    });

    const baseElements = chartBaseElements(
        spreadsheet,
        at.x,
        at.y,
        backgroundColor,
        layout,
        max,
        at.debug === true,
        measure,
    );
    const xLabels = chartXLabels(
        spreadsheet,
        at.x,
        at.y,
        backgroundColor,
        layout,
        measure,
    );
    const xLabelsBottomY = Math.max(
        at.y + layout.gap / 2,
        ...xLabels.map((label) => getRotatedTextElementBottom(label)),
    );
    const { chartWidth } = getChartDimensions(spreadsheet, layout);
    const seriesLegend = createSeriesLegend(
        series,
        seriesColors,
        at.x + chartWidth / 2,
        xLabelsBottomY,
        at.y + layout.gap * 5,
        measure,
    );

    return [...baseElements, ...lines, ...guides, ...dots, ...seriesLegend];
}
