// The chart data's reader: what a pasted text must say before the editor
// offers to draw it as a chart.
//
// The reader is a port of the reference's own
// (`packages/excalidraw/charts/charts.parse.ts`), reasons and quirks
// included, because the offer a user sees has to be the offer the reference
// makes for the same paste: the same delimiters scored the same way, the
// same shapes recognised, and the same words when the data is refused. A
// refusal here is not an error — it is the answer "this text is not a
// chart", and the paste falls through to the ordinary text door.

/**
 * One number as the reader understands it: an optional sign, an optional
 * currency mark glued to it, a figure, and an optional percent.
 *
 * @param {string} s the cell's text.
 * @returns {number | null} the number, or null when the cell is not one.
 */
export function tryParseNumber(s) {
    const match = /^([-+]?)[$\u20AC\u00A3\u00A5\u20A9]?([-+]?)([\d.,]+)[%]?$/.exec(s);
    if (!match) {
        return null;
    }
    return parseFloat(`${match[1] || match[2]}${match[3]}`.replace(/,/g, ""));
}

/**
 * @param {string[][]} lines the rows, each already split into cells.
 * @param {number} columnIndex the column asked about.
 * @returns {boolean} whether every row past the first carries a number there.
 */
function isNumericColumn(lines, columnIndex) {
    return lines.slice(1).every((line) => tryParseNumber(line[columnIndex]) !== null);
}

/**
 * Read a rectangular block of cells into a chart's data.
 *
 * The three shapes the reference recognises, in its own order: a block of
 * three or more columns (first row a header of titles when none of its
 * cells is a number, first column the labels, every other column a series —
 * and the transposed "wide" shape when the columns outnumber the rows); a
 * single column of numbers (title when the first cell is not one); and the
 * two-column shape (labels left, values right).
 *
 * @param {string[][]} cells the block.
 * @returns {{ok: true, data: {title: string|null, labels: string[]|null,
 *   series: {title: string, values: number[]}[]}} | {ok: false, reason: string}}
 *   the chart's data, or the named reason it is not one.
 */
export function tryParseCells(cells) {
    const numCols = cells[0].length;

    if (numCols > 2) {
        const hasHeader = cells[0].every((cell) => tryParseNumber(cell) === null);
        const rows = hasHeader ? cells.slice(1) : cells;

        if (rows.length < 1) {
            return { ok: false, reason: "No data rows" };
        }

        const invalidNumericColumn = rows.some((row) =>
            row.slice(1).some((value) => tryParseNumber(value) === null),
        );
        if (invalidNumericColumn) {
            return { ok: false, reason: "Value is not numeric" };
        }

        // Wide format — more value columns than data rows — is transposed:
        // columns become the labels and rows become the series, which is
        // the shape the reference's radar charts read.
        const numValueCols = numCols - 1;
        if (numValueCols > rows.length) {
            const labels = hasHeader ? cells[0].slice(1).map((h) => h.trim()) : null;
            const series = rows.map((row) => ({
                title: row[0]?.trim() || null,
                values: row.slice(1).map((v) => tryParseNumber(v)),
            }));
            const title =
                series.length === 1 ? series[0].title : hasHeader ? cells[0][0].trim() || null : null;
            return {
                ok: true,
                data: { title, labels, series },
            };
        }

        const series = cells[0].slice(1).map((seriesTitle, index) => {
            const valueColumnIndex = index + 1;
            const fallbackTitle = `Series ${valueColumnIndex}`;
            return {
                title: hasHeader ? seriesTitle.trim() || fallbackTitle : fallbackTitle,
                values: rows.map((row) => tryParseNumber(row[valueColumnIndex])),
            };
        });

        return {
            ok: true,
            data: {
                title: hasHeader ? cells[0][0].trim() || null : null,
                labels: rows.map((row) => row[0]),
                series,
            },
        };
    }

    if (numCols === 1) {
        if (!isNumericColumn(cells, 0)) {
            return { ok: false, reason: "Value is not numeric" };
        }

        const hasHeader = tryParseNumber(cells[0][0]) === null;
        const title = hasHeader ? cells[0][0] : null;
        const values = (hasHeader ? cells.slice(1) : cells).map((line) => tryParseNumber(line[0]));

        if (values.length < 2) {
            return { ok: false, reason: "Less than two rows" };
        }

        return {
            ok: true,
            data: {
                title,
                labels: null,
                series: [{ title, values }],
            },
        };
    }

    const hasHeader = tryParseNumber(cells[0][1]) === null;
    const rows = hasHeader ? cells.slice(1) : cells;

    if (rows.length < 2) {
        return { ok: false, reason: "Less than 2 rows" };
    }

    const invalidNumericColumn = rows.some((row) => tryParseNumber(row[1]) === null);
    if (invalidNumericColumn) {
        return { ok: false, reason: "Value is not numeric" };
    }

    const title = hasHeader ? cells[0][1] : null;

    return {
        ok: true,
        data: {
            title,
            labels: rows.map((row) => row[0]),
            series: [{ title, values: rows.map((row) => tryParseNumber(row[1])) }],
        },
    };
}

/**
 * Read a pasted text as a spreadsheet.
 *
 * Three delimiters are tried — tab, comma, semicolon, in that order of
 * preference — and the one that splits the text into rows of a *consistent*
 * column count with the most columns wins, which is how a CSV full of
 * commas inside its cells does not defeat a tab-separated paste. A text
 * whose rows disagree about their column count is not a spreadsheet, and
 * the reason says so.
 *
 * @param {string} text the pasted text.
 * @returns {{ok: true, data: {title: string|null, labels: string[]|null,
 *   series: {title: string, values: number[]}[]}} | {ok: false, reason: string}}
 *   the chart's data, or the named reason it is not one.
 */
export function tryParseSpreadsheet(text) {
    // Copy/paste from excel, spreadsheets, TSV, CSV, semicolon-separated.
    const parseDelimitedLines = (delimiter) =>
        text
            .replace(/\r\n?/g, "\n")
            .split("\n")
            .filter((line) => line.trim().length > 0)
            .map((line) => line.split(delimiter).map((cell) => cell.trim()));

    // Score each delimiter: prefer consistent column counts with the most columns.
    // A delimiter that produces all single-column rows likely isn't the right one.
    const candidates = ["\t", ",", ";"].map((delimiter) => {
        const parsed = parseDelimitedLines(delimiter);
        const numCols = parsed[0]?.length ?? 0;
        const isConsistent =
            parsed.length > 0 && parsed.every((line) => line.length === numCols);
        return { delimiter, parsed, numCols, isConsistent };
    });

    // Prefer: consistent + most columns. Among ties, tab > comma > semicolon
    // (the array order already encodes this priority).
    const best =
        candidates.find((c) => c.isConsistent && c.numCols > 1) ??
        candidates.find((c) => c.isConsistent) ??
        candidates[0];

    const lines = best.parsed;

    if (lines.length === 0) {
        return { ok: false, reason: "No values" };
    }

    const numColsFirstLine = lines[0].length;
    const isSpreadsheet = lines.every((line) => line.length === numColsFirstLine);

    if (!isSpreadsheet) {
        return {
            ok: false,
            reason: "All rows don't have same number of columns",
        };
    }

    return tryParseCells(lines);
}
