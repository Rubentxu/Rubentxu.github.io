// Mermaid flowcharts to elements: a pure converter, in three steps that do not know each other.
//
//   parseFlowchart(source) -> graph      text in, a graph out; no sizes, no positions
//   layoutFlowchart(graph) -> layout     a graph in, boxes out; no text, no element types
//   flowchartElements(graph, layout)     both in, element literals out
//
// `mermaidToElements` runs the three. They are separate so the part that decides what a
// diagram *means* can be held to the reference converter's answers (type, label,
// connection, how an arrow is drawn) while the part that decides where things go stays this
// build's own: the reference lays out against the browser's font metrics, which is a
// machine with opinions, and this one is deterministic and measures nothing.
//
// # What is supported
//
//   - `flowchart` or `graph`, direction `TD`, `TB` or `LR`.
//   - Nodes `A[text]` and `A(text)` (rectangles), `A{text}` (diamond), `A((text))`
//     (ellipse). A node with no text is labelled with its id.
//   - Links `-->`, `---`, `-.->`, `==>`, chained (`A --> B --> C`), with a label `|text|`.
//
// # What is refused, and why that is an error
//
// Everything else is a typed `MermaidError`, never a partial scene. `subgraph` is the case
// that decides the rule: the reference does not convert it to elements at all, it answers
// ONE image of the rendered diagram. A converter that turned it into boxes would be
// promising what the reference does not do; one that silently dropped it would lose the
// user's group. So the user is told. The codes are:
//
//   - `not-a-diagram`  the text does not start with a diagram keyword;
//   - `unsupported`    valid Mermaid this converter does not draw (subgraph, other shapes,
//                      other directions, other diagram types, link forms outside the four);
//   - `syntax`         a line that is not a statement (a link with no target, an
//                      unterminated node).

/** A refusal with a machine-readable reason. */
export class MermaidError extends Error {
    /**
     * @param {"not-a-diagram" | "unsupported" | "syntax"} code why.
     * @param {string} message what to tell the user.
     * @param {number} [line] the 1-based source line, when there is one.
     */
    constructor(code, message, line) {
        super(line === undefined ? message : `line ${line}: ${message}`);
        this.name = "MermaidError";
        this.code = code;
        this.line = line;
    }
}

const DIRECTIONS = { TD: "down", TB: "down", LR: "right" };
const OTHER_DIRECTIONS = new Set(["RL", "BT"]);
const DIAGRAM_KEYWORDS = /^(flowchart|graph)\b/;
const OTHER_DIAGRAMS =
    /^(sequenceDiagram|classDiagram|stateDiagram(-v2)?|erDiagram|gantt|pie|journey|gitGraph|mindmap|timeline)\b/;

/**
 * The characters that open a shape this converter does not draw. A string, not a regex:
 * the wiring suite brace-matches client source and a `{` inside a regex literal unbalances it.
 */
const OPENERS = "[({<>/\\";

/** The four link forms, longest first so `-.->` is not read as `-` and `.->`. */
const LINKS = [
    { token: "-.->", strokeStyle: "dashed", strokeWidth: 2, endHead: "arrow" },
    { token: "==>", strokeStyle: "solid", strokeWidth: 4, endHead: "arrow" },
    { token: "-->", strokeStyle: "solid", strokeWidth: 2, endHead: "arrow" },
    { token: "---", strokeStyle: "solid", strokeWidth: 2, endHead: null },
];

// ---- parse ----------------------------------------------------------------------------

/**
 * Read one node reference at the head of `text`.
 *
 * @returns {{ node: {id: string, shape: string, label: string}, rest: string }}
 */
function readNode(text, line) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)/.exec(text);
    if (match === null) {
        throw new MermaidError("syntax", `expected a node, found "${text.slice(0, 12)}"`, line);
    }
    const id = match[1];
    let rest = text.slice(id.length);
    const forms = [
        ["((", "))", "ellipse"],
        ["[", "]", "rectangle"],
        ["(", ")", "rectangle"],
        ["{", "}", "diamond"],
    ];
    for (const [open, close, shape] of forms) {
        if (!rest.startsWith(open)) continue;
        const end = rest.indexOf(close, open.length);
        if (end === -1) {
            throw new MermaidError("syntax", `node ${id} is never closed (expected "${close}")`, line);
        }
        const raw = rest.slice(open.length, end).trim();
        // `[[x]]`, `([x])`, `{{x}}`, `[/x/]`: a second delimiter means a shape this converter
        // does not draw, and reading it as plain text would label the node "[x".
        if (OPENERS.includes(raw[0]) && raw[0] !== undefined) {
            throw new MermaidError("unsupported", `the shape of node ${id} is not supported`, line);
        }
        const label = raw.replace(/^"(.*)"$/, "$1");
        return { node: { id, shape, label: label === "" ? id : label }, rest: rest.slice(end + close.length) };
    }
    if (OPENERS.includes(rest[0] ?? "") && rest !== "") {
        throw new MermaidError("unsupported", `the shape of node ${id} is not supported`, line);
    }
    return { node: { id, shape: "rectangle", label: id }, rest };
}

/**
 * Parse a flowchart into a graph.
 *
 * @param {string} source the Mermaid text.
 * @returns {{direction: "down" | "right", nodes: object[], links: object[]}} the graph.
 * @throws {MermaidError} for anything outside the supported subset.
 */
export function parseFlowchart(source) {
    const lines = String(source)
        .split(/\r?\n/)
        .map((text, index) => ({ text: text.trim(), number: index + 1 }))
        .filter((line) => line.text !== "" && !line.text.startsWith("%%"));
    if (lines.length === 0) {
        throw new MermaidError("not-a-diagram", "the text is empty");
    }
    const header = lines[0];
    if (!DIAGRAM_KEYWORDS.test(header.text)) {
        if (OTHER_DIAGRAMS.test(header.text)) {
            throw new MermaidError("unsupported", "only flowcharts are supported", header.number);
        }
        throw new MermaidError("not-a-diagram", "the text does not start with a diagram keyword");
    }
    const direction = header.text.split(/\s+/)[1] ?? "TD";
    if (OTHER_DIRECTIONS.has(direction)) {
        throw new MermaidError("unsupported", `direction ${direction} is not supported`, header.number);
    }
    if (!(direction in DIRECTIONS)) {
        throw new MermaidError("syntax", `unknown direction "${direction}"`, header.number);
    }

    const nodes = new Map();
    const links = [];
    const remember = (node) => {
        const known = nodes.get(node.id);
        // A later mention without text must not erase the label an earlier one gave.
        if (known === undefined || (known.label === known.id && node.label !== node.id)) {
            nodes.set(node.id, node);
        }
    };

    for (const { text, number } of lines.slice(1)) {
        if (/^(subgraph|end)\b/.test(text)) {
            throw new MermaidError(
                "unsupported",
                "subgraphs are not supported: the reference converts them to a single image",
                number,
            );
        }
        if (/^(style|classDef|class|click|linkStyle|direction)\b/.test(text)) {
            throw new MermaidError("unsupported", `"${text.split(/\s+/)[0]}" is not supported`, number);
        }
        let { node, rest } = readNode(text, number);
        remember(node);
        for (;;) {
            rest = rest.trimStart();
            if (rest === "" || rest.startsWith(";")) break;
            const link = LINKS.find((candidate) => rest.startsWith(candidate.token));
            if (link === undefined) {
                if (/^(--|==|-\.|~~|<-|<=|[xo]-|&)/.test(rest)) {
                    throw new MermaidError("unsupported", `the link "${rest.slice(0, 6)}" is not supported`, number);
                }
                throw new MermaidError("syntax", `unexpected "${rest.slice(0, 12)}"`, number);
            }
            rest = rest.slice(link.token.length).trimStart();
            let label = null;
            if (rest.startsWith("|")) {
                const close = rest.indexOf("|", 1);
                if (close === -1) throw new MermaidError("syntax", "the link label is never closed", number);
                label = rest.slice(1, close).trim();
                rest = rest.slice(close + 1).trimStart();
            }
            if (rest === "") {
                throw new MermaidError("syntax", "a link needs a node after it", number);
            }
            const target = readNode(rest, number);
            remember(target.node);
            const { token: _token, ...style } = link;
            links.push({ from: node.id, to: target.node.id, label: label === "" ? null : label, ...style });
            node = target.node;
            rest = target.rest;
        }
    }
    return { direction: DIRECTIONS[direction], nodes: [...nodes.values()], links };
}

// ---- layout ---------------------------------------------------------------------------

const NODE_HEIGHT = 60;
const MIN_WIDTH = 60;
const CHAR_WIDTH = 11;
const PADDING = 40;
const RANK_GAP = 50;
const SIBLING_GAP = 40;
const MARGIN = 8;

/**
 * Place the nodes of a graph: layered, deterministic, no measurement.
 *
 * A node's rank is its longest path from a source, ignoring edges that close a cycle, so
 * every link points forward. Within a rank nodes keep the order they were first written.
 *
 * @param {{direction: string, nodes: object[], links: object[]}} graph the parsed graph.
 * @returns {Map<string, {x: number, y: number, width: number, height: number}>} one box per node.
 */
export function layoutFlowchart(graph) {
    const order = new Map(graph.nodes.map((node, index) => [node.id, index]));
    const forward = graph.links.filter((link) => order.get(link.from) < order.get(link.to));
    const rank = new Map(graph.nodes.map((node) => [node.id, 0]));
    // Longest path over forward edges only: the DAG that is left once back edges are ignored.
    for (let pass = 0; pass < graph.nodes.length; pass++) {
        for (const link of forward) {
            rank.set(link.to, Math.max(rank.get(link.to), rank.get(link.from) + 1));
        }
    }
    const size = (node) => ({
        width: Math.max(MIN_WIDTH, node.label.length * CHAR_WIDTH + PADDING),
        height: NODE_HEIGHT,
    });
    const ranks = new Map();
    for (const node of graph.nodes) {
        const r = rank.get(node.id);
        if (!ranks.has(r)) ranks.set(r, []);
        ranks.get(r).push(node);
    }
    const down = graph.direction === "down";
    const boxes = new Map();
    let cursor = MARGIN;
    for (const r of [...ranks.keys()].sort((a, b) => a - b)) {
        const row = ranks.get(r);
        let across = MARGIN;
        let depth = 0;
        for (const node of row) {
            const { width, height } = size(node);
            boxes.set(node.id, down ? { x: across, y: cursor, width, height } : { x: cursor, y: across, width, height });
            across += (down ? width : height) + SIBLING_GAP;
            depth = Math.max(depth, down ? height : width);
        }
        cursor += depth + RANK_GAP;
    }
    return boxes;
}

// ---- elements -------------------------------------------------------------------------

/**
 * Turn a graph and its layout into element literals (skeletons: a label rides on its shape,
 * an arrow names the ids it joins).
 *
 * @returns {object[]} nodes first, then arrows, in source order.
 */
export function flowchartElements(graph, layout) {
    const shapes = graph.nodes.map((node) => {
        const box = layout.get(node.id);
        return { id: node.id, type: node.shape, ...box, label: { text: node.label } };
    });
    const arrows = graph.links.map((link) => {
        const from = layout.get(link.from);
        const to = layout.get(link.to);
        const down = graph.direction === "down";
        const start = down
            ? { x: from.x + from.width / 2, y: from.y + from.height }
            : { x: from.x + from.width, y: from.y + from.height / 2 };
        const end = down
            ? { x: to.x + to.width / 2, y: to.y }
            : { x: to.x, y: to.y + to.height / 2 };
        const arrow = {
            id: `${link.from}_${link.to}`,
            type: "arrow",
            x: start.x,
            y: start.y,
            points: [
                [0, 0],
                [end.x - start.x, end.y - start.y],
            ],
            strokeStyle: link.strokeStyle,
            strokeWidth: link.strokeWidth,
            endArrowhead: link.endHead,
            start: { id: link.from },
            end: { id: link.to },
        };
        if (link.label !== null) arrow.label = { text: link.label };
        return arrow;
    });
    return [...shapes, ...arrows];
}

/**
 * Convert a Mermaid flowchart to element literals.
 *
 * @param {string} source the Mermaid text.
 * @returns {object[]} the elements.
 * @throws {MermaidError} for anything outside the supported subset.
 */
export function mermaidToElements(source) {
    const graph = parseFlowchart(source);
    return flowchartElements(graph, layoutFlowchart(graph));
}
