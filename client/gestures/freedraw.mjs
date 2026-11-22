// The freehand gesture: a stroke drawn with the pen tool.
//
// # What it is
//
// A press with the freehand tool open, a drag, and a release. The result is one
// element whose points are every position the pointer passed through, so the path is
// collected as it happens rather than derived from the start and the end.
//
// # The accumulator, and why the path is not an array
//
// A stroke collects one point per pointermove. Building the path as a plain array —
// `points: [...gesture.points, [dx, dy]]` — copied the whole prefix on every event, so
// a stroke of n points moved n(n+1)/2 pairs before the release: the O(n²) the
// 2026-11 audit flagged (ND-P02). The store here is append-only in fixed chunks, and
// every gesture carries a *cursor* over it: an older gesture's view is its cursor, so
// it stays untouched while the store grows underneath — nobody copies anything, each
// element is written exactly once (`written` counts them; the performance suite holds
// that count against the quadratic prefix sum), and the definitive arrays are
// materialized only where a plain array is required: the kernel's commit and
// `preview`. The accumulator never crosses into the document.
//
// Appends continue from the live gesture only — the pipeline hands the newest gesture
// forward, and the release's append is the last one a stroke makes.
//
// # The four moments
//
// `start` opens the stroke in the kernel, which reads the zoom once and answers the
// origin the points are relative to: a stroke that changed scale halfway through would
// hold points measured with two transforms. It also carries the element's identity —
// the id and the seed the commit will insert under. `move` returns the gesture with
// the point added. `commit` adds the point the release carries, asks the kernel for
// the smoothed path and returns the document of the new element. `preview` is the
// json of the stroke travelled so far — the live preview's input, the commit's own
// smoothing and builder, one stroke in two moments.
//
// # What stays outside
//
// Nothing here inserts: the document goes back to the page, and the page's one door
// for creating elements decides what happens to it (selection, history, tool). The id
// is minted by the caller, as it is for every other creation. Nothing here catches: a
// refusal is the pipeline's to report.

import { GESTURES } from "../gesture.mjs";
import { FREEDRAW_STROKE_WIDTH, FREEDRAW_STREAMLINE, FREEDRAW_VARIABILITY, freedrawJsonFor } from "../tools.mjs";

/**
 * @typedef {{ x: number, y: number }} Point
 */

/** Elements per chunk of the stroke's store. */
const TRAVEL_CHUNK = 256;

/**
 * The stroke's accumulator: a chunked, append-only store read through a cursor.
 *
 * A descriptor never mutates — its cursor fixes which elements belong to the gesture
 * that carries it — and an append writes at the store's frontier, beyond every
 * cursor that came before, so older gestures keep their view without anyone copying
 * the prefix for them.
 */
class StrokeTravel {
    /**
     * @param {Array<Array>} chunks The store's chunks: one fixed-size array each,
     *   holding the elements up to `TRAVEL_CHUNK` of them.
     * @param {number} cursor The elements this descriptor sees.
     * @param {number} fill The elements the last chunk already holds.
     * @param {number} written Every element ever placed in the store.
     */
    constructor(chunks, cursor, fill, written) {
        this.chunks = chunks;
        this.cursor = cursor;
        this.fill = fill;
        this.written = written;
    }

    /** A store with no elements yet. */
    static empty() {
        return new StrokeTravel([new Array(TRAVEL_CHUNK)], 0, 0, 0);
    }

    /**
     * The descriptor with `value` added at the frontier. Appends continue from the
     * live gesture only, so the frontier is always the newest cursor.
     *
     * @param {number|number[]} value
     * @returns {StrokeTravel}
     */
    append(value) {
        let fill = this.fill;
        if (fill === TRAVEL_CHUNK) {
            this.chunks.push(new Array(TRAVEL_CHUNK));
            fill = 0;
        }
        this.chunks[this.chunks.length - 1][fill] = value;
        return new StrokeTravel(this.chunks, this.cursor + 1, fill + 1, this.written + 1);
    }

    /** The elements this descriptor sees. */
    get length() {
        return this.cursor;
    }

    /**
     * The element at `index`.
     *
     * @param {number} index
     * @returns {number|number[]}
     */
    at(index) {
        return this.chunks[Math.floor(index / TRAVEL_CHUNK)][index % TRAVEL_CHUNK];
    }

    /** The last element this descriptor sees. */
    last() {
        return this.at(this.cursor - 1);
    }

    /**
     * The definitive array: the elements in order, materialized once, for whoever
     * needs a plain array — the kernel's commit, and `preview`.
     *
     * @returns {Array}
     */
    toArray() {
        const out = new Array(this.cursor);
        for (let index = 0; index < this.cursor; index++) {
            out[index] = this.at(index);
        }
        return out;
    }
}

/**
 * Resolve the press-time style snapshot into the birth style the builder writes.
 *
 * One call per gesture, at the press: the line-width token becomes the freehand
 * table's number here and never again, so the sampling loop and every preview
 * frame read numbers that already exist (TASK-296 AC6). An absent snapshot is
 * no style at all — the stroke is born at the kernel's defaults, which is the
 * road every caller without drawing preferences takes.
 *
 * @param {{ strokeColor: string, lineWidth: string, opacity: number } | null} [snapshot]
 * @returns {{ strokeColor: string, strokeWidth: number, opacity: number } | null}
 */
function birthStyle(snapshot) {
    if (snapshot === null || snapshot === undefined) {
        return null;
    }
    return {
        strokeColor: snapshot.strokeColor,
        strokeWidth: FREEDRAW_STROKE_WIDTH[snapshot.lineWidth] ?? FREEDRAW_STROKE_WIDTH.medium,
        opacity: snapshot.opacity,
    };
}

/**
 * Open a stroke at the press.
 *
 * @param {{ beginStroke: (x: number, y: number) => ArrayLike<number> }} session
 * @param {Point} startScreen Where the pointer went down.
 * @param {{ pressure: number, pointerType: string }} pointer
 * @param {{ id: string, seed: number }} identity The element's identity, minted by
 *   the caller at the press: the id the commit will insert under and the seed the
 *   sketch wobbles with. The preview and the commit carry the same two.
 * @param {object | null} [style] The drawing preferences' snapshot, read ONCE here
 *   (`snapshot()` on the instance's `stylePreferences`, TASK-296). It is resolved
 *   into the gesture's birth style at the press and rides every later moment
 *   unchanged: the trail the user watches, the element the release inserts and
 *   its undo all carry the same colour, width and opacity. A gesture cancelled
 *   discards it with itself, and the next press reads the preferences again —
 *   which is how two consecutive strokes can be two colours.
 * @returns {object} The payload for a new gesture, without its owners.
 */
export function start(session, startScreen, pointer, identity, style = null) {
    // A pointer that reports the flat 0.5 has no pressure to read: the kernel derives
    // it from the speed of the stroke instead.
    const simulatePressure = pointer.pressure === 0.5;
    const origin = session.beginStroke(startScreen.x, startScreen.y);
    return {
        kind: GESTURES.FREEDRAW,
        startScreen,
        currentScreen: startScreen,
        id: identity.id,
        seed: identity.seed,
        origin: { x: origin[0], y: origin[1] },
        // The points are the travels from the press, in screen pixels; the first
        // point is the press itself.
        points: StrokeTravel.empty().append([0, 0]),
        pressures: simulatePressure ? StrokeTravel.empty() : StrokeTravel.empty().append(pointer.pressure),
        simulatePressure,
        variability: FREEDRAW_VARIABILITY,
        streamline: pointer.pointerType === "mouse" ? FREEDRAW_STREAMLINE.mouse : FREEDRAW_STREAMLINE.precise,
        // Resolved once, at the press: preview and commit read these numbers and
        // never go back to the preferences.
        style: birthStyle(style),
    };
}

/**
 * The gesture with the pointer at its new place and the point added. A position the
 * stroke already ended at adds nothing. The gesture it was given is not touched: its
 * view is its cursor, and the append lands beyond it.
 *
 * @param {object} gesture
 * @param {Point} next
 * @param {number} pressure
 * @returns {object}
 */
export function move(gesture, next, pressure) {
    const dx = next.x - gesture.startScreen.x;
    const dy = next.y - gesture.startScreen.y;
    const last = gesture.points.last();
    if (last[0] === dx && last[1] === dy) {
        return { ...gesture, currentScreen: next };
    }
    return {
        ...gesture,
        currentScreen: next,
        points: gesture.points.append([dx, dy]),
        pressures: gesture.simulatePressure ? gesture.pressures : gesture.pressures.append(pressure),
    };
}

/**
 * The document of the finished stroke.
 *
 * The release point is the one the event carries and not the last move's: the release
 * has the coordinates the pointer actually left the canvas with. It is a travel from
 * the press like the others, and the kernel nudges a release that lands on the first
 * point, so a dot still has an outline. This is where the accumulator publishes its
 * definitive arrays — the only plain arrays a stroke ever makes are the ones the
 * kernel reads.
 *
 * @param {{ strokePointsFlat: (travels: Float64Array) => void }} session
 * @param {object} gesture
 * @param {Point} release
 * @param {number} pressure
 * @returns {{ id: string, json: string }}
 */
export function commit(session, gesture, release, pressure) {
    const travel = gesture.points.append([release.x - gesture.startScreen.x, release.y - gesture.startScreen.y]);
    const pressures = gesture.simulatePressure ? gesture.pressures.toArray() : gesture.pressures.append(pressure).toArray();
    // The flat door: the travels cross as the f64s they are and the kernel
    // writes the scene points into the same buffer — no string crosses, and
    // the four serialisations the JSON path paid (stringify, parse, serde in,
    // serde out) are gone. The A/B measured it at ten times the JSON door's
    // speed on a 20.000-point stroke. The JSON door stays in the boundary as
    // the oracle the artifact's own suite compares this answer against, bit
    // for bit.
    const flat = new Float64Array(travel.length * 2);
    for (let i = 0; i < travel.length; i += 1) {
        const [x, y] = travel.at(i);
        flat[2 * i] = x;
        flat[2 * i + 1] = y;
    }
    session.strokePointsFlat(flat);
    const smoothed = new Array(travel.length);
    for (let i = 0; i < travel.length; i += 1) {
        smoothed[i] = [flat[2 * i], flat[2 * i + 1]];
    }
    const json = freedrawJsonFor(gesture.id, gesture.origin.x, gesture.origin.y, {
        points: smoothed,
        pressures,
        simulatePressure: gesture.simulatePressure,
        variability: gesture.variability,
        streamline: gesture.streamline,
    }, { seed: gesture.seed, style: gesture.style });
    return { id: gesture.id, json };
}

/**
 * The json of the stroke travelled so far, read before it exists.
 *
 * This is the live preview's half (TASK-132): the same smoothing the commit runs
 * (`strokePointsFlat`), the same builder, the same id and seed the press minted — the
 * ink the user watches trail from the pen is the ink that lands. The travels are
 * materialized for the crossing and nothing else: the gesture's store is not appended
 * to, and a stroke that ends as a `pointercancel` has previewed a path nobody inserted.
 *
 * The smoothing runs per paint, not per move: the paint is the coalesced ask, so a
 * stroke of n points pays the kernel's smoothing once a frame and not once an event.
 * The cost is the outline's own — upstream regenerates its path on the same clock.
 *
 * @param {{ strokePointsFlat: (travels: Float64Array) => void }} session
 * @param {object} gesture
 * @returns {string | null}
 */
export function preview(session, gesture) {
    if (gesture?.kind !== GESTURES.FREEDRAW) {
        return null;
    }
    const travel = gesture.points;
    // The pressures the stroke carries so far: empty when they are simulated (the
    // kernel derives them from the speed), the store's view otherwise. The release
    // appends nothing here — the release point is the commit's, not the preview's.
    const pressures = gesture.pressures.toArray();
    const flat = new Float64Array(travel.length * 2);
    for (let i = 0; i < travel.length; i += 1) {
        const [x, y] = travel.at(i);
        flat[2 * i] = x;
        flat[2 * i + 1] = y;
    }
    session.strokePointsFlat(flat);
    const smoothed = new Array(travel.length);
    for (let i = 0; i < travel.length; i += 1) {
        smoothed[i] = [flat[2 * i], flat[2 * i + 1]];
    }
    return freedrawJsonFor(gesture.id, gesture.origin.x, gesture.origin.y, {
        points: smoothed,
        pressures,
        simulatePressure: gesture.simulatePressure,
        variability: gesture.variability,
        streamline: gesture.streamline,
    }, { seed: gesture.seed, style: gesture.style });
}
