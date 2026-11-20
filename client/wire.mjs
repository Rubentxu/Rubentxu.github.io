import { getStickyNoteFooter, placeStickyNoteFooter } from "./sticky-note-footer.mjs";

/**
 * The frame, read out of Wasm linear memory.
 *
 * ## Why this exists and what it is not
 *
 * `session.frame()` returned a JSON string, and the client paid two costs for
 * it that had nothing to do with drawing: Rust built a 7.7 MB string per
 * revision, and V8 parsed it. `examples/render_cost.rs` and
 * `crates/nextdraw-core/examples/codec_decode.mjs` measured both halves of the
 * alternative on the same scene, and the alternative won on both — postcard is
 * 2,49× smaller, and this reader costs 11 % of what `JSON.parse` costs for the
 * same frame. So the frame crosses as bytes and is read here.
 *
 * This is not a second format. `session.frame()` still exists and still returns
 * JSON, and that is deliberate: it is the **oracle** these bytes are compared
 * against, so a reader that has drifted cannot quietly disagree with the
 * producer. `client/wiring.test.mjs` fails if the client ever calls it.
 *
 * ## The tables are the whole coupling
 *
 * `postcard` is not self-describing, and the first version of this note got the
 * shape of that wrong in a way the code found out about. It said a struct is "a
 * field count and then that many values". It is not: `serialize_struct(name, n)`
 * takes that count as **serde metadata and discards it**. A struct on the wire
 * is its values in order, with neither names nor a count. So the tables below are
 * not the whole coupling — they are *most* of it — and the shape of what
 * surrounds them is this:
 *
 * - a `Vec` is a varint length, then that many values;
 * - a struct is its values in order, and **it cannot omit a key**;
 * - an enum is the **index** of its variant, in declaration order;
 * - `[f64; N]` is N consecutive little-endian `f64`s;
 * - an `Option<T>` is a tag byte — `0x00` for `None`, `0x01` *followed by* the `T`
 *   — so the tags and the payloads interleave rather than arriving in two runs.
 *
 * The "cannot omit a key" clause is not a detail. `ChromeRecord` shipped five
 * keys for a multi-select and eight for a solo one, which is what `serde_json`
 * wants and what no other format can express: the reader handed the shorter shape
 * has nothing to branch on and would read the next record's id as a handle. The
 * fix was in the producer — the seven fields are always written, the last three
 * as the `Option`s they already are — and under postcard the three tags cost
 * three bytes. See `readChrome`.
 *
 * The tables are not written here: the kernel publishes its vocabulary
 * (`wireSchema()`) and this module mounts it at startup, so the reader and the
 * writer cannot disagree about a name or about a position. What the reader still
 * has to know is the *shape* of each payload, and that is the branching below.
 *
 * ## The view is not returned, and that is the point
 *
 * `readFrame` builds a `Uint8Array` over `memory.buffer`, decodes it, and hands
 * back the decoded object. The view is never returned and never stored. A view
 * held across a Wasm call that allocates is **detached**: reading it yields
 * zeros or `undefined` and throws nothing, which is the same shape of failure as
 * a `querySelectorAll` that returns `[]`. Refusing to hand the view out is the
 * guard; a test asserts that a retained view really does go bad, so the rule has
 * a reason rather than a prohibition.
 *
 * `forbid(unsafe_code)` is untouched: the pointer comes from `Vec::as_ptr()`
 * through `buildFrame`, and `wasm32` puts it in a `u32`.
 */

const text = new TextDecoder("utf-8");

// --- the tables --------------------------------------------------------------
//
// The tables are not written here. postcard is not self-describing, so the reader
// has to know, before it reads a single byte, that the byte it is about to read is
// an op and not something else — and that knowledge is the *kernel's*: the order
// postcard numbers a variant in is the order the Rust enum is declared in.
//
// So the kernel publishes its vocabulary (`wireSchema()`) and this module mounts
// it. The tables used to be written out here and kept honest by guards that read
// the kernel's **source** with a regular expression, which is a guard that breaks
// when the source is refactored and passes when the source is worded differently.
// The vocabulary is data now, and a table that is a copy of a list is a copy that
// can drift.

/** The mounted vocabulary, or `null` before the kernel's schema arrives. */
let mounted = null;

/**
 * Mount the wire's vocabulary, as the kernel publishes it.
 *
 * The schema and the model version have to come from the **same build**: the
 * vocabulary names the bytes and the version names the model, and a reader that
 * holds one build's vocabulary with another build's bytes reads every frame wrong
 * without anything throwing. So the version the artifact reports and the version
 * the schema carries are compared here, and a mismatch refuses to start.
 *
 * @param {object} schema the kernel's published vocabulary.
 * @param {number} modelVersion the artifact's own model version.
 * @returns {object} the mounted tables.
 */
export function mountWireSchema(schema, modelVersion) {
    if (schema === null || typeof schema !== "object") {
        throw new Error(
            "the wire schema is not an object: the kernel published no vocabulary to read " +
                "the frame with",
        );
    }
    if (schema.modelVersion !== modelVersion) {
        throw new Error(
            `the wire schema is for the model version ${schema.modelVersion} and the artifact is ` +
                `version ${modelVersion}: the vocabulary and the bytes do not belong to the same ` +
                "build, and every frame would be read wrong without anything throwing",
        );
    }
    for (const list of ["drawOps", "frameItems", "notePaths", "fillStyles", "strokeStyles"]) {
        if (!Array.isArray(schema[list]) || schema[list].length === 0) {
            throw new Error(
                `the wire schema has no ${list}: the reader cannot know what the byte it is ` +
                    "about to read means",
            );
        }
    }
    if (schema.frameProtocolVersion !== FRAME_PROTOCOL_VERSION) {
        throw new Error(`incompatible frame protocol version ${schema.frameProtocolVersion}; expected ${FRAME_PROTOCOL_VERSION}`);
    }
    if (!Array.isArray(schema.frameSections) ||
        schema.frameSections.length !== FRAME_SECTION_NAMES.length ||
        schema.frameSections.some((name, index) => name !== FRAME_SECTION_NAMES[index])) {
        throw new Error("the wire schema has incompatible frame sections");
    }
    mounted = {
        drawOps: [...schema.drawOps],
        frameItems: [...schema.frameItems],
        notePaths: [...schema.notePaths],
        fillStyles: [...schema.fillStyles],
        strokeStyles: [...schema.strokeStyles],
        frameSections: [...schema.frameSections],
    };
    return mounted;
}

/** The mounted vocabulary, or a refusal that says what is missing. */
function tables() {
    if (mounted === null) {
        throw new Error(
            "the wire tables are not mounted: the kernel's wireSchema() has to be mounted " +
                "before a frame is read, because postcard does not say what a byte means",
        );
    }
    return mounted;
}

// The geometric variants share one payload; `Image` and `Frame` are the two that
// do not, and the product already says so by giving them a different serializer.
// A reader that assumed a common shape would be wrong about a quarter of the ops.
//
// The freehand ink is geometric: it carries an id, a point list and the same
// style trio as every other mark. What makes it a *different* draw is that the
// client fills it instead of stroking it, and that is the painter's business,
// not the reader's — the two bytes on the wire are the same two bytes.
//
// The set is named rather than numbered, and that is the whole point of the
// mounted tables: a reader that is one position out reads every op as the wrong
// shape and says nothing. A variant the kernel adds and this set does not know is
// **refused** by name, loudly, instead of being read as whatever sat at that
// index before.
const GEOMETRIC = new Set(["Outline", "Polyline", "Arrowhead", "FreeDraw"]);


// --- the crop ----------------------------------------------------------------
//
// The region an image shows is an option on the wire, and an option is one tag
// byte — present or absent — followed by the six numbers the region carries
// when it is present. The reader is one function because the painter and the
// reader must never disagree about which six numbers in which order.

function readCropOption(cursor) {
    if (!cursor.tag("the region an image shows")) {
        return null;
    }
    return {
        x: cursor.f64(),
        y: cursor.f64(),
        width: cursor.f64(),
        height: cursor.f64(),
        naturalWidth: cursor.f64(),
        naturalHeight: cursor.f64(),
    };
}

// --- the cursor --------------------------------------------------------------
//
// Every read is bounds-checked against the end of the buffer and every failure
// names what it expected. The alternative is the failure mode above: a short
// read that quietly returns fewer ops than the frame claims.

class Cursor {
    constructor(bytes) {
        this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        this.at = 0;
    }

    varint() {
        const { view } = this;
        let result = 0;
        let scale = 1;
        let byte;
        do {
            if (this.at >= view.byteLength) {
                throw new Error(`varint runs past the end of the buffer at byte ${this.at}`);
            }
            byte = view.getUint8(this.at);
            this.at += 1;
            result += (byte & 0x7f) * scale;
            scale *= 128;
        } while (byte & 0x80);
        return result;
    }

    f64() {
        if (this.at + 8 > this.view.byteLength) {
            throw new Error(`f64 runs past the end of the buffer at byte ${this.at}`);
        }
        const value = this.view.getFloat64(this.at, true);
        this.at += 8;
        return value;
    }

    /** `[f64; n]`, which the wire writes as the numbers in order. */
    floats(n) {
        const out = new Array(n);
        for (let i = 0; i < n; i += 1) out[i] = this.f64();
        return out;
    }

    string() {
        const length = this.varint();
        if (this.at + length > this.view.byteLength) {
            throw new Error(
                `a string claims ${length} B at byte ${this.at}, which is past the end of a ` +
                    `${this.view.byteLength} B buffer`,
            );
        }
        const slice = new Uint8Array(this.view.buffer, this.view.byteOffset + this.at, length);
        this.at += length;
        return text.decode(slice);
    }

    /** An index into a name table, refused rather than looked up. */
    variant(table) {
        const index = this.varint();
        if (index >= table.length) {
            throw new Error(
                `discriminant ${index} is not one of the ${table.length} variants this reader ` +
                    `knows (${table.join(", ")}). The kernel's vocabulary and this reader have ` +
                    "drifted; nothing here can guess which one is right.",
            );
        }
        return { name: table[index], index };
    }

    /**
     * A `bool`, which postcard writes as a varint `0` or `1`.
     *
     * Read as a tag rather than a value: every bool on this wire is a *shape*
     * decision, so a truthy byte that is not exactly `1` means the producer
     * wrote something this reader cannot interpret.
     */
    tag(what) {
        const value = this.varint();
        if (value !== 0 && value !== 1) {
            throw new Error(
                `${what} is tagged ${value}, which is neither absent (0) nor present (1). ` +
                    "Nothing here can guess which one it was meant to be.",
            );
        }
        return value === 1;
    }

    atEnd() {
        return this.at === this.view.byteLength;
    }
}

// --- the frame ----------------------------------------------------------------

function readOp(cursor) {
    const { name } = cursor.variant(tables().drawOps);
    if (GEOMETRIC.has(name)) {
        const id = cursor.string();
        const points = new Array(cursor.varint());
        for (let p = 0; p < points.length; p += 1) points[p] = cursor.floats(2);
        // The strokes the pencil lays on top of the outline: a count, and then a path
        // per stroke. They are read here, between the points and the styles, because
        // postcard writes a struct's values in order with neither names nor a count:
        // a reader that skipped them would read the styles off the middle of a path.
        const strokes = [];
        for (let s = cursor.varint(); s > 0; s -= 1) {
            const stroke = new Array(cursor.varint());
            for (let p = 0; p < stroke.length; p += 1) stroke[p] = cursor.floats(2);
            strokes.push(stroke);
        }
        const fillStyle = cursor.variant(tables().fillStyles).name;
        const strokeStyle = cursor.variant(tables().strokeStyles).name;
        // The third style key, and it is a **number**, not a token.
        //
        // The width travels the way upstream stores it: the model holds the
        // number (`strokeWidth`), so the number is what the op carries and what
        // the canvas strokes at. A token here would have needed a second table
        // on this side to turn it back into a number, and that table is the
        // thing this change exists to delete — one number, one owner.
        //
        // It is here because postcard numbers a struct's fields by position and
        // nothing in the wire says "and then a width": a reader that stopped here
        // would parse every byte after it as the next op's tag, and the equality
        // gate is the only thing that would notice.
        const strokeWidth = cursor.f64();
        // The colour and the opacity, and they are the **element's** since H6.14.
        //
        // The style is a struct on this wire, and a struct is its values in order
        // with neither names nor a count: the reader has to know the order the
        // writer used or it reads the next field off the middle of a string. The
        // writer is `DrawStyle`'s own declaration order
        // (`crates/nextdraw-core/src/draw_ops.rs`), and the two are compared by
        // execution: the oracle in `client/artifact/wire.test.mjs` decodes the same
        // frame both ways and holds them equal, field for field and in order.
        //
        // The colours are the text the document used, so the reader reads a string
        // and not a token: `#1e1e1e` and `rgb(30, 30, 30)` are the same ink and
        // different bytes, and the frame carries the bytes the document had.
        const strokeColor = cursor.string();
        const backgroundColor = cursor.string();
        // The opacity, in the document's unit — a percent — already clipped to
        // `0…100` by the kernel. The client divides by a hundred to get the
        // fraction a surface draws at.
        const opacity = cursor.f64();
        return {
            [name]: {
                id,
                points,
                strokes,
                fillStyle,
                strokeStyle,
                strokeWidth,
                strokeColor,
                backgroundColor,
                opacity,
            },
        };
    }
    if (name === "Image") {
        return {
            [name]: {
                id: cursor.string(),
                x: cursor.f64(),
                y: cursor.f64(),
                width: cursor.f64(),
                height: cursor.f64(),
                angle: cursor.f64(),
                // The element's own mirror, as the element carries it: a
                // negative axis is one the user flipped. The painter scales
                // the raster by it after the rotation — how a bitmap is
                // mirrored without re-encoding a pixel of it. The pair reads
                // as the array the JSON oracle spells, because the walker and
                // the oracle are compared field for field.
                scale: [cursor.f64(), cursor.f64()],
                // The region of the bitmap the element shows, as the reference's
                // crop: an option reads a tag byte first — present or absent —
                // and the present one carries the rectangle in the bitmap's own
                // pixels plus the natural size the rectangle is measured
                // against. The painter reads exactly this slice out of the
                // decoded bitmap.
                crop: readCropOption(cursor),
                // The image has no ink to colour, so it carries no colours — but
                // the element's opacity is the element's, and upstream applies it
                // to the whole element before it draws it.
                opacity: cursor.f64(),
            },
        };
    }
    // The frame is the fifth shape and the fourth payload: a box, a title, and
    // the style both renderers draw it with. Its style is a struct of its own,
    // and postcard writes a struct's values in order with neither names nor a
    // count, so the order below is the order `FrameStyle` declares its fields
    // in.
    //
    // The name is checked rather than the frame being the fall-through. It used to
    // be the fall-through, which meant a sixth variant with a payload of its own
    // would have been read as a frame — and read as a frame it would have consumed
    // the wrong number of bytes and desynchronised every op after it. The reader
    // already refuses an unknown discriminant; this makes it refuse a *known*
    // discriminant read with the wrong reader.
    if (name === "Frame") {
        return {
            [name]: {
                id: cursor.string(),
                x: cursor.f64(),
                y: cursor.f64(),
                width: cursor.f64(),
                height: cursor.f64(),
                name: cursor.string(),
                style: readFrameStyle(cursor),
                // The frame's children, by id. They travel here because the clip is
                // made with this frame's box, and the box is in this op: a client
                // that had to ask the kernel for the children would be asking for a
                // second thing about the frame it is already holding.
                children: readStrings(cursor),
                // The children whose ink the clip may not cut: the arrows and the
                // labels bound to arrows (upstream's isFrameClippable, PR #12516).
                // Always present, empty when every child is clippable, so a reader
                // never has to tell "nothing is exempt" from "not there".
                unclipped: readStrings(cursor),
            },
        };
    }
    // The sticky note is the seventh shape: the paper's outline, the shadow's outline, and
    // the numbers both are drawn with. The two outlines are paths of commands and not
    // point lists, because the paper's rounded corner is a curve.
    if (name === "StickyNote") {
        return {
            [name]: {
                id: cursor.string(),
                face: readNotePaths(cursor),
                shadow: readNotePaths(cursor),
                style: readStickyNoteStyle(cursor),
                created: optionNumber(cursor),
                width: cursor.f64(),
                height: cursor.f64(),
                strokeColor: cursor.string(),
                x: cursor.f64(),
                y: cursor.f64(),
                angle: cursor.f64(),
            },
        };
    }
    // The hatch is the eighth shape: the interior's rows, already computed — one
    // polyline per run, the fill itself. The style reads flat, the same six fields
    // in `DrawStyle`'s declaration order the geometric ops read, because postcard
    // writes a struct's values in order with neither names nor a count.
    if (name === "Hatch") {
        const id = cursor.string();
        const polylines = new Array(cursor.varint());
        for (let r = 0; r < polylines.length; r += 1) {
            const run = new Array(cursor.varint());
            for (let p = 0; p < run.length; p += 1) run[p] = cursor.floats(2);
            polylines[r] = run;
        }
        return {
            [name]: {
                id,
                polylines,
                fillStyle: cursor.variant(tables().fillStyles).name,
                strokeStyle: cursor.variant(tables().strokeStyles).name,
                strokeWidth: cursor.f64(),
                strokeColor: cursor.string(),
                backgroundColor: cursor.string(),
                opacity: cursor.f64(),
            },
        };
    }
    throw new Error(
        `the DrawOp variant ${name} (index ${index}) has no reader in this build. The Rust enum ` +
            "and this table have drifted; nothing here can guess which payload it carries.",
    );
}

/** The table every frame is drawn with, in the order `FrameStyle` declares it. */
function readFrameStyle(cursor) {
    return {
        stroke: cursor.string(),
        strokeWidth: cursor.f64(),
        radius: cursor.f64(),
        titleColor: cursor.string(),
        titleFontSize: cursor.f64(),
        titleOffsetY: cursor.f64(),
    };
}

/**
 * One command of a sticky note's outline.
 *
 * The note's outline is not a polyline: it has curves, and the curve **is** the paper's
 * rounded corner — and, on a cartoonist's note, the fold. So the commands travel one by
 * one, each saying what it is, and the painter walks them in order.
 *
 * The command is named by its variant, the way every other thing on the wire is named:
 * the mounted table says what the variants are, and the reader reads the **name** to
 * know which payload to read. A reader that decided by position would read a command
 * the kernel had moved as the command that used to sit there, and the note's corner
 * would be drawn with the wrong curve.
 */
function readNotePath(cursor) {
    const { name } = cursor.variant(tables().notePaths);
    if (name === "Move") {
        return { [name]: { point: cursor.floats(2) } };
    }
    if (name === "Line") {
        return { [name]: { point: cursor.floats(2) } };
    }
    return { [name]: { control: cursor.floats(2), point: cursor.floats(2) } };
}

/**
 * A note's outline: the commands, in order.
 *
 * The list is written as a count and then the commands, so the reader reads the count
 * first and then exactly that many commands.
 */
function readNotePaths(cursor) {
    const commands = new Array(cursor.varint());
    for (let c = 0; c < commands.length; c += 1) commands[c] = readNotePath(cursor);
    return commands;
}

/**
 * The table the note is drawn with, in the order `StickyNoteStyle` declares its fields.
 */
function readStickyNoteStyle(cursor) {
    return {
        background: cursor.string(),
        shadowColor: cursor.string(),
        shadowOpacity: cursor.f64(),
        edgeShadowStrokeWidth: cursor.f64(),
        edgeShadowOpacity: cursor.f64(),
    };
}

/**
 * One item of the frame: a mark, or a text record.
 *
 * A mark is a `DrawOp`, and a `DrawOp` is tagged too — the item says *what kind
 * of thing* this is and the mark says *which kind of mark*. So a mark item on
 * the wire carries two tags, and a text item carries one.
 *
 * The item is the unit of order. The frame is a vector of these and the vector
 * is the scene's order, so a reader that walked the vector in sequence paints
 * the picture in the order the scene says. The order is not in the tag: `Mark`
 * and `Text` are *kinds*, and the kind says nothing about which of two things
 * is on top.
 */
function readFrameItem(cursor) {
    const { name } = cursor.variant(tables().frameItems);
    if (name === "Mark") {
        return { [name]: readOp(cursor) };
    }
    return { [name]: readTextView(cursor) };
}

function readTextView(cursor) {
    return {
        id: cursor.string(),
        x: cursor.f64(),
        y: cursor.f64(),
        width: cursor.f64(),
        height: cursor.f64(),
        angle: cursor.f64(),
        fontSize: cursor.f64(),
        // The family travels **resolved**: the kernel owns the rule that
        // turns the document's number into a stack of names, so the string
        // that arrives is the one both renderers are to use. A reader that
        // expected the number here would read the length of the stack as the
        // number and everything after it as nonsense.
        fontFamily: cursor.string(),
        textAlign: cursor.string(),
        verticalAlign: cursor.string(),
        lineAdvance: cursor.f64(),
        lines: readStrings(cursor),
    };
}

/** The eight resize handles, in the order the product names them. */
const HANDLE_KEYS = ["nw", "n", "ne", "w", "e", "sw", "s", "se"];

/**
 * An `Option<T>` on the wire: one tag byte, then the value only if the tag says
 * present. The tag is *not* separate from the payload — reading three tags in a
 * row and then three payloads reads three numbers of a payload as tags, which is
 * how the first version of this reader mistook a resize handle's first `f64` for
 * a presence flag and refused a frame that was perfectly well formed.
 */
function readOption(cursor, readValue, what) {
    if (!cursor.tag(what)) return { present: false, value: null };
    return { present: true, value: readValue() };
}

function readHandles(cursor) {
    const handles = {};
    for (const key of HANDLE_KEYS) handles[key] = cursor.floats(2);
    return handles;
}

/**
 * The vertices of a polyline, as the chrome shows them.
 *
 * Each position travels with the index it has in the element's own point list,
 * because the index is what names the vertex in the document: the elbow arrow
 * shows its first and last point, and those are not points 0 and 1.
 *
 * So a position is a pair — the index, then the point — and the reader reads
 * both, in that order, which is the order the Rust tuple writes them.
 *
 * The midpoints are read the same way, and their index names the **segment**
 * they belong to: a vertex is added to a segment, not to a point.
 *
 * The point the pointer rests over is the last field. Both it and the picked
 * vertex are `Option`s in Rust, so the wire writes a tag for each and the
 * reader reads the tag before the number: a reader that assumed the number was
 * always there would read the tag of the next thing as an index, and the point
 * it highlighted would be the wrong one.
 */
function readVertices(cursor) {
    return {
        positions: readIndexedPoints(cursor),
        midpoints: readIndexedPoints(cursor),
        // The handles of the segments of a turning arrow, and the segments
        // that are already pinned: the two lists the elbow arrow carries and
        // a polyline does not. The writer sends eight fields, always — a
        // reader that stopped after the midpoints would read the empty
        // segments list as the radius and take the frame apart from there
        // (the tag of `selected` arrived as 8193 once, which is how this
        // comment earned its place).
        segments: readIndexedPoints(cursor),
        pinned: new Array(cursor.varint()).fill(0).map(() => cursor.varint()),
        radius: cursor.f64(),
        midpointRadius: cursor.f64(),
        selected: readOption(cursor, () => cursor.varint(), "ChromeVertices.selected").value,
        hover: readOption(cursor, () => cursor.varint(), "ChromeVertices.hover").value,
    };
}

/** A list of points, each with the index that names it. */
function readIndexedPoints(cursor) {
    const points = new Array(cursor.varint());
    for (let i = 0; i < points.length; i += 1) {
        const index = cursor.varint();
        points[i] = [index, cursor.floats(2)];
    }
    return points;
}

/**
 * One selection-chrome record.
 *
 * Every number in it is in screen pixels: the kernel builds the chrome in the
 * same space the drawing is painted in, so the reader hands the painter the
 * coordinates as they are and never has to know the zoom.
 *
 * The last three fields are `Option`s in Rust and postcard writes a tag for each
 * one, so the record always has the same shape and the reader always knows how
 * far to read. That is not an optimisation, it is the only thing that works: a
 * producer that omitted the absent fields — which is what `serde_json` wants and
 * what this record used to do — leaves a reader with nothing to branch on, and a
 * reader that guesses reads the next record's id as a resize handle.
 *
 * The handles are then checked against their half-extent rather than trusted.
 * They move together by construction on the Rust side — one is the size of the
 * other — so a record with one and not the other did not come from this
 * producer, and one like that would paint handles with no radius, with nothing
 * thrown. The rotate dot is not part of that pair: an image's record carries a
 * dot and no handles, because the kernel refuses to resize an image and never
 * refuses to turn one.
 */
function readChrome(cursor) {
    const record = {
        id: cursor.string(),
        kind: cursor.string(),
        box: cursor.floats(4),
        polygon: readPoints(cursor),
    };
    const handles = readOption(cursor, () => readHandles(cursor), "ChromeRecord.handles");
    const half = readOption(cursor, () => cursor.f64(), "ChromeRecord.handleHalf");
    const rotate = readOption(
        cursor,
        () => ({
            handle: cursor.floats(2),
            centre: cursor.floats(2),
            radius: cursor.f64(),
        }),
        "ChromeRecord.rotate",
    );
    // The vertices are their own option and do not move with the other three:
    // a rectangle has handles and no vertices, and an element being edited has
    // vertices and no handles. They are two different facts about two
    // different modes, and the wire writes each one where it belongs.
    const vertices = readOption(cursor, () => readVertices(cursor), "ChromeRecord.vertices");
    // The pair is checked against itself rather than trusted: the handles and
    // their half-extent move together by construction on the Rust side — one is
    // the size of the other — so a record with one and not the other did not
    // come from this producer, and one like that would paint a handle with no
    // radius, with nothing thrown.
    //
    // The rotate dot is deliberately *not* part of that pair. A record with a
    // dot and no handles is this producer's own answer for the one element the
    // kernel refuses to resize — an image, whose natural aspect lives in the
    // bitmap the kernel does not read — and refusing that record refused the
    // whole frame: every selected image killed the paint loop, and nothing the
    // user did reached the glass again. Rotation needs a centre, not an aspect,
    // so the dot travels alone.
    if (handles.present !== half.present) {
        throw new Error(
            "ChromeRecord has " +
                `handles=${handles.present}, handleHalf=${half.present}, ` +
                "and the two are present or absent together by construction — one is the " +
                "size of the other. A record that mixes them would paint a handle with no " +
                "size, so it is refused rather than drawn.",
        );
    }
    if (!handles.present) {
        // The keys are written with a null value rather than omitted, which is
        // what the `Option` in Rust means and what the JSON oracle now says.
        // `null` and `undefined` are equally falsy, so every reader of these —
        // `record.handles && …`, `rec?.rotate`, `record.handleHalf ?? 4` — behaves
        // the same either way. The reason to name the key is that the JSON frame
        // names it, and this object is compared against that JSON byte for byte:
        // a reader that omitted the key would disagree with its own oracle about
        // the *shape* of the value even though the two draw identically. The
        // rotate dot keeps its own presence: an image's record has no handles
        // and a dot, and a reader that nulled the dot with the handles would
        // take away the one affordance that element has.
        record.handles = null;
        record.handleHalf = null;
        record.rotate = rotate.present ? rotate.value : null;
        record.vertices = vertices.present ? vertices.value : null;
        return record;
    }
    record.handles = handles.value;
    record.handleHalf = half.value;
    record.rotate = rotate.value;
    record.vertices = vertices.present ? vertices.value : null;
    return record;
}

function readPoints(cursor) {
    const points = new Array(cursor.varint());
    for (let p = 0; p < points.length; p += 1) points[p] = cursor.floats(2);
    return points;
}

function readStrings(cursor) {
    const lines = new Array(cursor.varint());
    for (let i = 0; i < lines.length; i += 1) lines[i] = cursor.string();
    return lines;
}

// Frame packets are protocol-versioned; the published schema owns section order.
const FRAME_PROTOCOL_VERSION = 2;
const FRAME_SECTION_NAMES = ["static", "chrome", "ui", "overlays", "resources"];

function readStaticSection(cursor) {
    const items = new Array(cursor.varint());
    for (let i = 0; i < items.length; i += 1) items[i] = readFrameItem(cursor);
    return { items, background: cursor.string(), grid: readGrid(cursor) };
}

function readChromeSection(cursor) {
    const chrome = new Array(cursor.varint());
    for (let i = 0; i < chrome.length; i += 1) chrome[i] = readChrome(cursor);
    return { chrome };
}

function readUiSection(cursor) {
    return {
        canUndo: cursor.tag("canUndo"),
        canRedo: cursor.tag("canRedo"),
        zoom: cursor.f64(),
        selected: readSelected(cursor),
        styles: readStyleTokens(cursor),
    };
}

function readOverlaySection(cursor) {
    return { embeddables: readEmbeddableOverlays(cursor) };
}

/**
 * Decode one full packet or one section delta from the kernel's bytes.
 *
 * A full mask is composed into the public frame shape; partial masks remain
 * packets for {@link mergeFramePacket}, which retains untouched section identities.
 * The protocol version, section tags and trailing-byte check make drift fail closed.
 *
 * @param {Uint8Array} bytes the whole packet, from offset zero.
 * @returns {object} a complete frame for a full packet, otherwise a section packet.
 */
export function decodeFrame(bytes) {
    const cursor = new Cursor(bytes);
    const protocolVersion = cursor.varint();
    if (protocolVersion !== FRAME_PROTOCOL_VERSION) {
        throw new Error(`incompatible frame protocol version ${protocolVersion}; expected ${FRAME_PROTOCOL_VERSION}`);
    }
    const revisions = {
        document: cursor.varint(), viewport: cursor.varint(), selection: cursor.varint(),
        overlays: cursor.varint(), resources: cursor.varint(),
    };
    const changedSections = cursor.varint();
    const knownMask = (1 << FRAME_SECTION_NAMES.length) - 1;
    if (changedSections & ~knownMask) throw new Error(`unknown frame section bits: ${changedSections}`);
    const packet = { protocolVersion, revisions, changedSections };
    for (const [name, reader] of [
        ["static", readStaticSection], ["chrome", readChromeSection],
        ["ui", readUiSection], ["overlays", readOverlaySection],
    ]) {
        const present = cursor.tag(`${name} section`);
        if (present !== Boolean(changedSections & (1 << FRAME_SECTION_NAMES.indexOf(name)))) {
            throw new Error(`${name} section payload does not match changed-section mask`);
        }
        packet[`${name}Section`] = present ? reader(cursor) : null;
    }
    if (!cursor.atEnd()) {
        throw new Error(`${cursor.view.byteLength - cursor.at} B are left over after the frame`);
    }
    return changedSections === knownMask ? mergeFramePacket(null, packet) : packet;
}

/** Compose a packet with the last complete frame, retaining untouched section identities. */
export function mergeFramePacket(previous, packet) {
    if (packet?.protocolVersion !== FRAME_PROTOCOL_VERSION) throw new Error("invalid frame packet");
    const staticSection = packet.staticSection ?? previous?.staticSection;
    const chromeSection = packet.chromeSection ?? previous?.chromeSection;
    const uiSection = packet.uiSection ?? previous?.uiSection;
    const overlaysSection = packet.overlaysSection ?? previous?.overlaysSection;
    if (!staticSection || !chromeSection || !uiSection || !overlaysSection) {
        throw new Error("a frame packet is missing sections and has no complete frame to merge with");
    }
    const frame = {
        items: staticSection.items, background: staticSection.background, grid: staticSection.grid,
        chrome: chromeSection.chrome, ...uiSection, embeddables: overlaysSection.embeddables,
    };
    Object.defineProperties(frame, {
        protocolVersion: { value: packet.protocolVersion },
        revisions: { value: packet.revisions },
        changedSections: { value: packet.changedSections },
        staticSection: { value: staticSection }, chromeSection: { value: chromeSection },
        uiSection: { value: uiSection }, overlaysSection: { value: overlaysSection },
    });
    return frame;
}

/**
 * The overlays the web embeddables show, in the frame's own pixels.
 *
 * The boxes come transformed by the session's own viewport — the same
 * projection the frame's marks went through — and each row carries the
 * address and the policy's answer, so the DOM layer the client keeps over
 * the canvas is a rendering of one document. An empty list is the common
 * frame and the cheap one.
 *
 * @param {Cursor} cursor the reader positioned at the overlays' count.
 * @returns {object[]} the rows, each `{id, x, y, width, height, angle, src,
 *   render, sameOrigin}` as the JSON oracle names them.
 */
function readEmbeddableOverlays(cursor) {
    const views = new Array(cursor.varint());
    for (let i = 0; i < views.length; i += 1) {
        views[i] = {
            id: cursor.string(),
            x: cursor.f64(),
            y: cursor.f64(),
            width: cursor.f64(),
            height: cursor.f64(),
            angle: cursor.f64(),
            src: optionString(cursor),
            render: cursor.tag("render"),
            sameOrigin: cursor.tag("sameOrigin"),
        };
    }
    return views;
}

/**
 * The session's own selection, in the kernel's order.
 *
 * @param {Cursor} cursor the reader positioned at the selection's count.
 * @returns {string[]} the ids, empty when nothing is selected.
 */
function readSelected(cursor) {
    const ids = new Array(cursor.varint());
    for (let i = 0; i < ids.length; i += 1) ids[i] = cursor.string();
    return ids;
}

/** An `Option<String>`, which postcard writes as a tag and, when present, the string. */
function optionString(cursor) {
    return cursor.tag("optional string") ? cursor.string() : null;
}

/** An `Option<f64>`, same tag rule. */
function optionNumber(cursor) {
    return cursor.tag("optional number") ? cursor.f64() : null;
}

/**
 * The selection's aggregate style, the answer the toolbars light their rows by.
 *
 * The shape is the JSON oracle's, key for key: `fill`, `stroke`, `lineWidth`,
 * `roughness`, `opacity`, `edges`, `strokeColor`, `backgroundColor`,
 * `fontFamily`, `fontSize`, `textAlign`, `verticalAlign`, `startArrowhead`,
 * `endArrowhead`, `arrowType` — with `"mixed"` where the selection disagrees
 * and `null` where a family has no row to light. The size is the one family
 * whose disagreement is `null` rather than the word: an untagged enum writes
 * a number and a string on this wire with no byte saying which, and a frame
 * two readers decode two ways is not a frame.
 *
 * @param {Cursor} cursor the reader positioned at the aggregate's tag.
 * @returns {object | null} the aggregate, or `null` with nothing selected.
 */
function readStyleTokens(cursor) {
    if (!cursor.tag("styles")) {
        return null;
    }
    return {
        fill: cursor.string(),
        stroke: cursor.string(),
        lineWidth: optionString(cursor),
        roughness: optionString(cursor),
        opacity: optionNumber(cursor),
        edges: optionString(cursor),
        strokeColor: cursor.string(),
        backgroundColor: cursor.string(),
        fontFamily: optionString(cursor),
        fontSize: optionNumber(cursor),
        textAlign: optionString(cursor),
        verticalAlign: optionString(cursor),
        startArrowhead: optionString(cursor),
        endArrowhead: optionString(cursor),
        arrowType: optionString(cursor),
    };
}


/**
 * The grid's lines, four numbers per line.
 *
 * The kernel names every line it wants stroked — the step, the pitch a screen
 * cannot separate, the viewport conversion — and this reads the answer in
 * place. An empty list is the honest "no grid"; nothing here decides what
 * should be visible, because a client that recomputed the pitch would be the
 * second place precision lives (ADR-007).
 *
 * @param {Cursor} cursor the reader positioned at the grid's count.
 * @returns {number[][]} the lines, each `[x1, y1, x2, y2]` in screen pixels.
 */
function readGrid(cursor) {
    const lines = new Array(cursor.varint());
    for (let i = 0; i < lines.length; i += 1) lines[i] = cursor.floats(4);
    return lines;
}

/**
 * The current frame, as the decoded object the painter takes.
 *
 * The view is built here and dies here. Nothing downstream of this function ever
 * holds bytes, which is what makes a `memory.grow()` impossible to survive.
 *
 * @param {{buildFrame: (resourcesRevision: number) => number, frameLen: () => number}} session
 * @param {WebAssembly.Memory} memory the module's linear memory.
 * @param {number} resourcesRevision the client's decoded-image revision.
 */
export function readFrame(session, memory, resourcesRevision = 0, footerContext = null) {
    const at = session.buildFrame(resourcesRevision);
    const length = session.frameLen();
    if (length === 0) {
        throw new Error("buildFrame reported no bytes for a complete frame");
    }
    return withStickyNoteFooters(
        mergeFramePacket(null, decodeFrame(frameView(memory, at, length))),
        footerContext,
    );
}

/**
 * The frame's bytes, as a view that dies the moment this function returns.
 *
 * The one place in the client that may look into linear memory: the view is
 * built, checked and consumed here, so no caller can hold one across a Wasm
 * call that grows the memory and detach it under itself.
 *
 * @param {WebAssembly.Memory} memory the module's linear memory.
 * @param {number} at where the frame starts.
 * @param {number} length how many bytes it runs for.
 * @returns {Uint8Array} the frame, readable until the next kernel call.
 */
function frameView(memory, at, length) {
    // Throws a RangeError if the buffer is detached or the range is out of it,
    // which is the loud half of the guard. The quiet half is that the view never
    // leaves this function.
    const bytes = new Uint8Array(memory.buffer, at, length);
    if (bytes.buffer !== memory.buffer) {
        throw new Error("the frame view was taken over a different buffer than linear memory");
    }
    return bytes;
}

/**
 * Take the frame if the kernel says it moved; answer nothing if it did not.
 *
 * This is the crossing a paint pays, and it is one call: the question "has the
 * frame moved?" — which the cache used to ask as a `revision()` probe, and then
 * licensed with a pointer and a length — is answered on the Rust side against
 * the session's own counter, in the same call that would encode the frame. A
 * quiet paint pays the ask and nothing else; a paint that follows a change pays
 * it and the bytes ride the same answer.
 *
 * The answer packs its two halves into one `u64` — the offset into linear
 * memory in the low 32 bits, the byte length in the high 32 — because a pointer
 * and a length do not fit in one `u32`, and on wasm32 a pointer is a u32, so
 * the packing is exact where the boundary lives. JavaScript reads the `u64` as a
 * `BigInt`, and the unpack is arithmetic on it, in the same turn the kernel
 * answered: the view over the bytes dies here, like every view this module takes.
 *
 * Zero is an answer about *this session's takes*: it says the last take encoded
 * a frame that is still current. A caller that never took one — a fresh cache
 * over a session another cache held — has no frame to reuse, which is why the
 * cache's cold read still goes through `readFrame` and zero is only read on a
 * warm ask.
 *
 * @param {{takeFrame: (resourcesRevision: number) => bigint}} session
 * @param {WebAssembly.Memory} memory the module's linear memory.
 * @param {number} resourcesRevision the client's decoded-image revision.
 * @returns {object|null} the decoded full frame or section packet, or `null` for unchanged.
 */
export function takeFrame(session, memory, resourcesRevision = 0, footerContext = null) {
    const packed = session.takeFrame(resourcesRevision);
    if (packed === 0n) {
        return null;
    }
    const at = Number(packed & 0xFFFF_FFFFn);
    const length = Number(packed >> 32n);
    if (length === 0) {
        throw new Error(
            "takeFrame handed over no bytes. An empty scene still has a frame — two zero " +
                "lengths — so this is the absence of one, not a frame that decodes to nothing.",
        );
    }
    return withStickyNoteFooters(decodeFrame(frameView(memory, at, length)), footerContext);
}

function withStickyNoteFooters(frame, footerContext) {
    if (footerContext === null) return frame;
    const decorate = (items) => items.map((item) => {
        const note = item.Mark?.StickyNote;
        if (note === undefined) return item;
        const localFooter = getStickyNoteFooter(note, footerContext);
        const answer = localFooter === null ? null : placeStickyNoteFooter(note, localFooter);
        const footer = answer === null ? null : { ...answer, color: note.strokeColor };
        return { ...item, Mark: { ...item.Mark, StickyNote: { ...note, footer } } };
    });
    if (frame.staticSection?.items) {
        frame.staticSection.items = decorate(frame.staticSection.items);
    }
    if (frame.items) {
        frame.items = decorate(frame.items);
        if (frame.staticSection) frame.staticSection.items = frame.items;
    }
    return frame;
}
