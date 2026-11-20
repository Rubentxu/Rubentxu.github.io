// The client's drawing tool state, extracted as a pure module so it can be
// tested without a browser. The kernel does not know what a "tool" is — it
// only sees `Action::Insert(StampedElement)` with the four supported element
// types. The tool state lives entirely in the client: which shape a
// pointerdown gesture produces, and which keyboard shortcut maps to which
// tool.
//
// # The four tools
//
// The supported set is the minimum that makes the H3 selection /
// translate / resize / rotate work meaningful: a document with one
// element is just a viewer. Each tool corresponds to a JSON type the
// kernel already accepts (`rectangle`, `ellipse`, `diamond`, `line`).
//
// The "selection" tool is the absence of a draw tool: pointerdown on
// empty space starts a marquee or selects an element, exactly as
// before. The `Escape` key and any non-mapped key fall back to it.

/**
 * The draw tools, the one click tool, the eraser, and the implicit selection cursor.
 *
 * `freedraw` is upstream's own type (`packages/element/src/types.ts`), and it is the
 * only tool here whose geometry is not a box: it leaves a *path* of points behind, and
 * the ink that path draws is the kernel's business, not this module's.
 *
 * `eraser` is upstream's own tool too (`packages/excalidraw/components/Tools.tsx`), and it
 * is the only one here that leaves *nothing* behind: it marks elements and removes them on
 * the pointer's release. What it marks is the kernel's business, not this module's.
 */
export const TOOLS = Object.freeze({
  hand: "hand",
  selection: "selection",
  rectangle: "rectangle",
  ellipse: "ellipse",
  diamond: "diamond",
  line: "line",
  arrow: "arrow",
  freedraw: "freedraw",
  text: "text",
  eraser: "eraser",
  laser: "laser",
  frame: "frame",
  stickynote: "stickynote",
  embeddable: "embeddable",
});

/**
 * Every tool shortcut, in one table: key to tool.
 *
 * This is the single place a shortcut exists. `toolForKey` reads it to answer the keyboard,
 * and the toolbar's buttons read it to answer `title` and the guard's expectation, so the
 * hint and the buttons cannot name a key the keyboard would refuse — which is the failure
 * mode of the two being written separately, and there is no reason to write them separately.
 *
 * The keys match upstream (`r`, `o`, `d`, `l`, `a`, `p`, `t`, `e`) so the muscle memory
 * transfers. `a` for arrow is safe here: select-all is `Cmd+A`, which carries a
 * modifier, and this table is only reached for bare keys — the same rule that keeps
 * `Cmd+R` from drawing a rectangle.
 *
 * `p` is the freehand tool because that is upstream's primary letter for it
 * (`packages/excalidraw/components/Tools.tsx`: `freedraw: { letterKey: [KEYS.P, KEYS.X] }`).
 * Upstream offers a second letter for the same tool and this table takes the first one:
 * a second key for a tool nobody has learned yet is a key that can collide with the
 * next tool that wants it.
 *
 * `e` is the eraser, which is upstream's own letter for it
 * (`packages/excalidraw/components/Tools.tsx`: `eraser: { letterKey: KEYS.E }`).
 *
 * The rows used to carry a `label` beside the tool. It was the tool's own name in all six
 * rows — a second spelling of a fact the row already holds, and the toolbar button that
 * reads it would have been free to disagree. A label that cannot differ from the value it
 * labels is a field waiting to be wrong; the button derives its text from the tool instead.
 */
/**
 * The keyboard's own table, exported so the guards can read it: the
 * agreement "every tool the keyboard reaches has a button" is a fact about
 * this table and the button table together, and a guard that derived it from
 * the button table would be comparing a thing against itself.
 */
export const TOOL_KEYS = new Map([
  // The letters are the keyboard's homologated table, unchanged in keys and
  // bindings; only the ROW order moved, to upstream's
  // (`packages/excalidraw/components/Toolbar.tsx`, tarball 701b901a:
  // rectangle, diamond, ellipse, arrow, line, freedraw, text, sticky note,
  // eraser — the four shapes as separate buttons, the extras behind the
  // toolbar's divider). A Map's order is its insertion order, so the rows
  // below are the row the user sees.
  ["h", TOOLS.hand],
  ["r", TOOLS.rectangle],
  ["d", TOOLS.diamond],
  ["o", TOOLS.ellipse],
  ["a", TOOLS.arrow],
  ["l", TOOLS.line],
  ["p", TOOLS.freedraw],
  ["t", TOOLS.text],
  ["n", TOOLS.stickynote],
  ["e", TOOLS.eraser],
  // The laser pointer's key is upstream's own (`K`, `packages/excalidraw/components/Tools.tsx:150`).
  // It sits after the eraser because upstream holds it — with the frame and
  // the embed — behind the toolbar's extra-tools boundary, which is the
  // divider the toolbar draws here (TASK-166).
  ["k", TOOLS.laser],
  ["f", TOOLS.frame],
  // The web embed has no key, and upstream's own table is why: its
  // `embeddable` row carries an icon and no `letterKey`
  // (`packages/excalidraw/components/Tools.tsx:145-147`). A `null` key puts
  // the tool on the bar without promising a shortcut the keyboard would
  // refuse, and `keyForTool` answers `null` for it the way it does for the
  // selection — a tool that is reached by pointer, not by letter.
  [null, TOOLS.embeddable],
]);

/**
 * The same table read the other way: one row per tool, with the key that
 * reaches it and the order the toolbar shows it in — led by the selection,
 * which has no row in the keyboard's table at all.
 *
 * The selection's row is a BUTTON fact and lives only here: upstream's
 * toolbar leads with its selection button (`packages/excalidraw/components/
 * Toolbar.tsx`, `<SelectionToolButton/>` first after the hand tool), and the
 * tool is reached by pointer and by `Escape`, not by a letter. It cannot be a
 * row of `TOOL_KEYS` — a Map holds one `null` key, and the embeddable already
 * carries it — and putting it there would overwrite the embeddable's row
 * rather than join it. Prepending here keeps the keyboard's table exactly the
 * homologated table while the button leads the row.
 *
 * This is the button table. The toolbar's buttons are rendered from it rather
 * than written out in `index.html` and re-asserted there, because a hand-written
 * list of six buttons is six chances to spell a tool the keyboard would not
 * accept — and the way that goes wrong is not a crash but an `aria-pressed` that
 * stops lighting, or a button that reaches a tool no key reaches.
 */
export const TOOL_BUTTONS = Object.freeze(
  [
    // Upstream's row leads with the hand, then the selection
    // (`Toolbar.tsx`: `<HandToolButton/>` before `<SelectionToolButton/>`).
    ["h", TOOLS.hand],
    [null, TOOLS.selection],
    // The hand has its row above; the keyboard table's copy is not repeated.
    ...[...TOOL_KEYS.entries()].filter(([, tool]) => tool !== TOOLS.hand),
  ].map(([key, tool]) => Object.freeze({ key, tool })),
);

/** The key that reaches `tool`, or `null` when no bare key does. */
export function keyForTool(tool) {
  for (const [key, candidate] of TOOL_KEYS) {
    if (candidate === tool) {
      return key;
    }
  }
  return null;
}

/**
 * The tools a drag leaves something behind, with the key that reaches each.
 *
 * Derived from `TOOL_BUTTONS` rather than listed beside it. The two were separate lists
 * once, and an arrow spent a whole milestone able to be drawn by a key that nothing on
 * screen named — a capability with no affordance is not a capability.
 *
 * The text tool is the one exclusion: it is a single click rather than a drag, so
 * `shapeJsonFor` has nothing to say about it. It still has a button and a key; it is
 * only absent from *this* list, which is about what a drag leaves behind.
 *
 * The eraser is the other, and for the opposite reason: it *is* a drag, and it leaves
 * nothing behind. It takes elements away instead of putting them down, so calling it a
 * draw tool would say the opposite of what it does. It has a button and a key and a
 * gesture of its own, and it is absent from this list only because this list is about
 * what a drag *creates*.
 *
 * The freehand tool is in the list because it *is* a drag, even though `shapeJsonFor`
 * has nothing to say about it either: what a freehand drag leaves behind is a path of
 * points rather than a box, and it has its own constructor below. Listing it here is
 * what keeps the two facts apart — "a drag leaves something" and "a drag leaves a box"
 * are not the same claim, and the freehand tool is the one that proves it.
 *
 * The laser pointer is the third, and for the eraser's reason carried further: its drag
 * leaves nothing behind *and* takes nothing away. The trail it draws decays on its own
 * and never reaches the document, so there is nothing this list could say about it —
 * it has a button and a key and a gesture of its own, and the gesture's table is where
 * its behaviour lives.
 */
const NON_DRAG_TOOLS = new Set([TOOLS.text]);
// The selection is not a drawing act either: it is what every tool returns
// to, and it leads the button row (TASK-166) without belonging in the hint's
// list of things a drag leaves behind.
const NON_DRAWING_TOOLS = new Set([TOOLS.hand, TOOLS.selection, TOOLS.eraser, TOOLS.laser]);
const DRAW_TOOLS = Object.freeze(
  TOOL_BUTTONS.filter(
    ({ tool }) => !NON_DRAG_TOOLS.has(tool) && !NON_DRAWING_TOOLS.has(tool),
  ),
);

/**
 * Map a keyboard event to a tool. Returns the new tool, or `null` if the
 * key is not a tool shortcut. Modifiers are intentionally ignored: a
 * `Cmd+R` must keep its browser meaning (reload), not silently switch
 * to the rectangle tool. The caller has already filtered for bare
 * unmodified keypresses in the same way the rest of the keyboard
 * handler does.
 *
 * @param {string} key The `event.key` value, lower-cased.
 * @returns {string | null}
 */
export function toolForKey(key) {
  // The number upstream offers beside every letter (`Tools.tsx`: `numericKey`)
  // is a real shortcut, not a label: the same furniture answers it, so a button
  // that advertises "2" advertises a key the keyboard takes.
  return TOOL_KEYS.get(key) ?? TOOL_BY_NUMBER.get(key) ?? null;
}

/**
 * The three shapes an arrow can take.
 *
 * An arrow is one element with three looks, and the look is chosen by the
 * user rather than by the tool: the arrow tool is one tool, and the key that
 * reaches it changes the arrow's shape once the tool is already armed.
 *
 * - `sharp` draws the arrow with square corners.
 * - `round` draws it with corners rounded in proportion to its own size, and
 *   it is the one an arrow starts as.
 * - `elbow` draws it turning at right angles, with the route the shape
 *   chooses between the two ends.
 */
export const ARROW_TYPES = Object.freeze({
  sharp: "sharp",
  round: "round",
  elbow: "elbow",
});

/**
 * The three in the order the key walks through them.
 *
 * The order is a cycle, so the one after the last is the first. Starting
 * from the default, one press reaches the turning arrow and a second press
 * reaches the square-cornered one.
 */
const ARROW_TYPE_ORDER = Object.freeze([
  ARROW_TYPES.sharp,
  ARROW_TYPES.round,
  ARROW_TYPES.elbow,
]);

/** The shape an arrow has until the user asks for another one. */
export const DEFAULT_ARROW_TYPE = ARROW_TYPES.round;

/**
 * The corner radius a rounded arrow carries, as the document writes it.
 *
 * The value is the one the format calls the proportional radius: the
 * rounding grows with the size of the arrow instead of staying the same
 * number of units on a small arrow and a large one.
 */
const PROPORTIONAL_RADIUS = 2;

/**
 * The shape the arrow takes after the key is pressed once more.
 *
 * A shape that is not one of the three has no place in the cycle, and the
 * default is what it falls back to rather than a shape nobody can reach.
 *
 * @param {string} type The shape the arrow has now.
 * @returns {string} The shape the arrow takes next.
 */
export function nextArrowType(type) {
  const index = ARROW_TYPE_ORDER.indexOf(type);
  if (index < 0) {
    return DEFAULT_ARROW_TYPE;
  }
  return ARROW_TYPE_ORDER[(index + 1) % ARROW_TYPE_ORDER.length];
}

/**
 * The tools whose key pressed **again** hands the pointer back. Upstream's
 * `TOGGLE_TOOLS` are the entries with `toggle: true`
 * (`packages/excalidraw/components/Tools.tsx`) — the hand and the eraser —
 * and re-activating one switches back to the tool that was active before it
 * (`App.tsx:5797-5804`): a key that arms an eraser nobody can disarm
 * strands the user in it, which is what the receipt `key-toggle-tool`
 * measured.
 */
const TOGGLE_TOOLS = new Set([TOOLS.hand, TOOLS.eraser]);

/**
 * A fresh tool state. The default is `selection` so the existing click /
 * marquee / drag behaviour is unchanged until the user explicitly picks
 * a draw tool. The arrow's shape is a separate fact from the tool, and it
 * starts as the rounded one. `lastActiveTool` is where a toggle tool
 * records the tool its next press returns to; it starts as nothing.
 */
export function createToolState() {
  return {
    currentTool: TOOLS.selection,
    arrowType: DEFAULT_ARROW_TYPE,
    lastActiveTool: null,
  };
}

/**
 * Apply a keypress to the state in place. Returns `true` if the state
 * changed. `Escape` always resets to the selection tool; unknown keys
 * leave the state untouched so a stray keystroke does not silently
 * switch tools.
 *
 * The key that reaches the arrow tool does a second thing when the arrow
 * tool is already armed: it changes the arrow's shape. One key, two
 * meanings, and the second meaning only exists while the tool is up — the
 * same key that arms the tool arms the shape it draws with.
 */
export function applyKey(state, key) {
  const next = toolForShortcut(key);
  if (next !== null) {
    if (next === TOOLS.arrow && state.currentTool === TOOLS.arrow) {
      state.arrowType = nextArrowType(state.arrowType);
      return true;
    }
    if (state.currentTool === next) {
      if (!TOGGLE_TOOLS.has(next)) {
        return false;
      }
      // The toggle rule: a toggle tool pressed again goes back to the tool
      // that was active before it, or to the selection when there is none
      // (`App.tsx:5800`, `lastActiveTool || preferredSelectionTool`), and
      // the return clears the record — the press after that arms the tool
      // afresh.
      state.currentTool = state.lastActiveTool ?? TOOLS.selection;
      state.lastActiveTool = null;
      return true;
    }
    // Activating a toggle tool records where its next press returns to, the
    // way upstream records `lastActiveTool` on every activation of one. A
    // non-toggle tool records nothing: its own key pressed again is a no-op.
    if (TOGGLE_TOOLS.has(next)) {
      state.lastActiveTool = state.currentTool;
    }
    state.currentTool = next;
    return true;
  }
  // Both spellings arrive: the module's own callers pass the event's
  // "Escape", and the page's key path passes the lower-cased "escape" it
  // uses for every other key. A case that only answered one of the two was
  // the reason the tool never went home by keyboard.
  if (key === "Escape" || key === "escape") {
    if (state.currentTool === TOOLS.selection) {
      return false;
    }
    state.currentTool = TOOLS.selection;
    return true;
  }
  return false;
}

/**
 * How far the pointer must travel, in screen pixels, before a straight
 * gesture becomes a line or an arrow.
 *
 * Upstream keeps a straight element alive only when the pointer travelled
 * at least this far; a shorter travel does not finish the shape but opens
 * the multi-point editor instead, where the user clicks further points.
 * The client has no multi-point editor, so a shorter travel ends the way an
 * empty drag on a closed shape ends: no element at all.
 */
export const MINIMUM_LINEAR_SIZE = 20;

/**
 * Whether a straight gesture travelled far enough to become an element.
 *
 * The distance is the straight-line one between the two ends of the
 * gesture, which is the same distance upstream measures — a drag that
 * crosses itself is still one line.
 *
 * @param {number} dx Screen pixels travelled horizontally.
 * @param {number} dy Screen pixels travelled vertically.
 * @returns {boolean}
 */
export function linearDragIsLongEnough(dx, dy) {
  return Math.hypot(dx, dy) >= MINIMUM_LINEAR_SIZE;
}

/**
 * Build the JSON document for a straight element of any length, drawn from
 * `origin` through the points given.
 *
 * This is the one place the document's spelling of a line or an arrow
 * exists — `shapeJsonFor` hands it the two points a drag produces, and
 * the click-by-click mode hands it the path its user clicked — so the two
 * gestures cannot drift into two dialects. The points are measured from
 * the origin, the way the document measures a linear element's points
 * from its own corner, and the box is their extent: a horizontal line has
 * zero height and a vertical one zero width, both ordinary.
 *
 * @param {string} tool The line tool or the arrow tool.
 * @param {string} id Element id, pre-minted by the caller.
 * @param {{x: number, y: number}} origin Scene point the element hangs from.
 * @param {Array<[number, number]>} points The path, relative to the origin.
 * @param {{arrowType?: string}} [options] The shape an arrow takes.
 * @returns {string | null} The JSON string, or `null` for an empty extent.
 */
/**
 * The seed an element is born with.
 *
 * The seed decides where a hand-drawn stroke wobbles, and in the reference
 * every element is born with one of its own: two rectangles drawn one after
 * the other wobble differently, and a drawing saved comes out the same
 * elsewhere because the seed it was born with travels in it. A seed fixed at
 * birth by a constant would make every sibling wobble the same way, which is
 * a drawing of identical twins.
 *
 * The range is the reference's own: a whole signed 32-bit number
 * (`randomInteger`, `packages/random/src/*.ts`), because the sketch generator
 * reads it as one and a narrower range would be a second truth about the
 * seeds the format carries.
 *
 * @returns {number} A fresh seed, in the reference's own range.
 */
export function freshSeed() {
    return Math.floor(Math.random() * 2 ** 31);
}

export function linearJsonFor(tool, id, origin, points, options = {}) {
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  if (width === 0 && height === 0) {
    return null;
  }
  const document = {
    id,
    angle: 0,
    seed: freshSeed(),
    type: tool,
    x: origin.x,
    y: origin.y,
    width,
    height,
    points: points.map(([x, y]) => [x, y]),
  };
  if (tool === TOOLS.arrow) {
    // The arrow's shape is part of the document, not of the tool: an
    // arrow drawn with square corners and one drawn with rounded ones
    // are the same kind of element with different looks.
    const arrowType = options.arrowType ?? DEFAULT_ARROW_TYPE;
    document.elbowed = arrowType === ARROW_TYPES.elbow;
    // The rounding only applies to the rounded shape; the other two say
    // so by having no rounding at all.
    document.roundness = arrowType === ARROW_TYPES.round
      ? { type: PROPORTIONAL_RADIUS }
      : null;
  }
  if (tool === TOOLS.line && options.polygon === true) {
    // A line whose path closed its own loop is a polygon: the flag is the
    // element's claim about its shape, written at the birth the finalize
    // makes (`actionFinalize.tsx:307-338`). An open line carries no claim
    // of its own — the kernel's answer is already `false`.
    document.polygon = true;
  }
  return JSON.stringify(document);
}

/**
 * Build the JSON document the kernel's `Session.insert` expects for the
 * given tool, drawn between the two ends of a gesture. The id is left to
 * the caller because the kernel's `insert` already mints a fresh id when
 * given one and a fresh id is also what the paste path needs.
 *
 * # The two ends, and why each shape uses them differently
 *
 * A closed shape hangs from its smallest corner: the corner is where the
 * box starts, and the size is how far the box reaches. A straight shape
 * hangs from **the point the pointer went down on**, and its two points
 * are the travel away from there, signed.
 *
 * That difference is not a choice made here — it is what the document
 * says. A line dragged up and to the left keeps the point it started at
 * as its origin and its second point is the travel, which is negative in
 * both directions. The origin is therefore *not* the smallest corner, and
 * an element that moved to the smallest corner instead would draw from
 * the wrong place.
 *
 * @param {string} tool One of the draw tools.
 * @param {string} id Element id, pre-minted by the caller.
 * @param {{x: number, y: number}} from Scene point the gesture began at.
 * @param {{x: number, y: number}} to Scene point the gesture ended at.
 * @param {{arrowType?: string}} [options] The shape an arrow takes.
 * @returns {string | null} The JSON string, or `null` for an empty gesture.
 */
export function shapeJsonFor(tool, id, from, to, options = {}) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const width = Math.abs(dx);
  const height = Math.abs(dy);
  // A seed the caller names is a draft's seed: the preview and the commit are
  // the same element, so the wobble the user watched grow is the wobble that
  // lands. Everyone else gets a fresh one, as always.
  const common = { id, angle: 0, seed: options.seed ?? freshSeed() };
  switch (tool) {
    case TOOLS.rectangle:
    case TOOLS.ellipse:
    case TOOLS.diamond:
    case TOOLS.frame:
    case TOOLS.stickynote:
    case TOOLS.embeddable: {
      // A closed shape with no extent in one axis is a click, not a shape.
      if (width <= 0 || height <= 0) {
        return null;
      }
      const shape = {
        ...common,
        type: tool,
        x: Math.min(from.x, to.x),
        y: Math.min(from.y, to.y),
        width,
        height,
      };
      // A frame is a closed shape with one extra field: its title. `null` means the
      // frame has no name of its own, which is not the same as a frame named with
      // the empty string — and the kernel resolves the title, so the client does
      // not spell upstream's default here.
      if (tool === TOOLS.frame) {
        shape.name = null;
        // The frame's own look is upstream's `FRAME_STYLE`
        // (`packages/common/src/constants.ts:209-221`), and it is the *creation*
        // call that carries it there too: a frame the reference draws stores
        // `strokeColor: "#bbb"` and `roughness: 0` — the receipt
        // `frame-children` measured both — and a frame that stored the pen's
        // defaults would look like every shape and weigh like one. The width
        // stays the kernel's: `FRAME_STYLE.strokeWidth` is 2, which is the
        // `medium` the kernel already answers.
        shape.strokeColor = "#bbb";
        shape.roughness = 0;
      }
      // A web embed is a closed shape with one extra field: the address it
      // shows. `null` is a frame with nothing in it yet — upstream writes the
      // base `link` the same way — and the kernel owns whether a page may
      // fill it, so the client does not keep the list of allowed domains.
      if (tool === TOOLS.embeddable) {
        shape.link = null;
      }
      // A note carries one more field: the height the user set, from which the note grows
      // above to fit its label (`packages/element/src/types.ts:104`). The drag's height
      // *is* that height — the note grows above it, never below — and the kernel owns
      // what happens next: the minimum size, and the floor under the base height.
      if (tool === TOOLS.stickynote) {
        shape.baseHeight = height;
        if (Number.isFinite(options.created)) {
          shape.created = options.created;
        }
      }
      return JSON.stringify(shape);
    }
    case TOOLS.line:
    case TOOLS.arrow: {
      // A line and an arrow are the same element with a different `type`: same
      // two points, same box, and the only difference is that `Arrow` makes the
      // kernel emit a `DrawOp::Arrowhead` alongside the polyline. Fusing the two
      // cases is not a shortcut — it is the statement that they are one gesture.
      //
      // Both are two points and the box is the extent of them. A
      // horizontal line has zero height and a vertical one zero width —
      // both are ordinary lines — so the test is "no extent at all",
      // which is what a click without a drag looks like.
      if (width === 0 && height === 0) {
        return null;
      }
      // `points` are measured from the origin, not absolute, and the origin is
      // the point the pointer went down on. Sending the press point as
      // `points[0]` stores the origin twice and the kernel draws the shape at
      // 2x — the box says one place and the points another, which is the
      // defect its invariant checker names.
      return linearJsonFor(tool, id, from, [[0, 0], [dx, dy]], options);
    }
    default:
      return null;
  }
}

/**
 * Whether the width of a freehand stroke follows the pressure.
 *
 * `"constant"` is upstream's **toolbar** default (`appState.ts:45`,
 * `currentItemStrokeVariability: "constant"`), and it is the one that reaches the
 * screen: upstream's app always hands `currentItemStrokeVariability` to
 * `newFreeDrawElement`, so the document default of `"variable"`
 * (`newElement.ts:616-619`) only applies to a file that never mentions the key.
 *
 * The two are genuinely different strokes, not a setting with two spellings:
 * `"constant"` draws a uniform ribbon around the centreline and `"variable"` draws a
 * ribbon whose width follows the pressure.
 */
export const FREEDRAW_VARIABILITY = "constant";

/**
 * How much a freehand stroke's points are smoothed before the ink is drawn.
 *
 * Upstream picks between two constants by the *kind of pointer* rather than by a
 * setting (`App.tsx:8305-8309`): a mouse gets `DEFAULT_STROKE_STREAMLINE` (`0.5`)
 * and anything else — a stylus, a finger — gets
 * `DEFAULT_STROKE_STREAMLINE_PRECISE` (`0.2`). The reason is that a mouse reports a
 * pressure of `0.5` no matter how it is moved, so a variable stroke from a mouse
 * would be flat, and the smoothing is what keeps the ribbon from looking like a
 * polygon.
 */
export const FREEDRAW_STREAMLINE = Object.freeze({
    mouse: 0.5,
    precise: 0.2,
});

/**
 * Build the JSON document the kernel's `Session.insert` expects for a freehand
 * stroke.
 *
 * The stroke is a **path**, not a box: the document carries the points the pointer
 * travelled through, relative to `(x, y)`, and the kernel derives the box from
 * them. That is why `width` and `height` are sent as zero and not computed here —
 * the client has one answer to give about the geometry (the points), and the kernel
 * owns the other. Upstream does the same thing one step later: `mutateElement`
 * overwrites the size with `getSizeFromPoints(points)` every time the points
 * change (`packages/element/src/mutateElement.ts:76-77`).
 *
 * The origin is the point the user pressed, and the points are relative to it, so
 * a point can be negative — a stroke that travels left of where it started has
 * points with a negative x. That is upstream's shape too, and it is the reason the
 * box of a freehand stroke is `x + min(points)` to `x + max(points)` rather than
 * `x` to `x + width`.
 *
 * @param {string} id Element id, pre-minted by the caller.
 * @param {number} x Scene-unit x of the point the stroke started at.
 * @param {number} y Scene-unit y of the point the stroke started at.
 * @param {object} stroke The stroke itself.
 * @param {number[][]} stroke.points The points, relative to `(x, y)`.
 * @param {number[]} stroke.pressures One pressure per point, or none at all when the
 *   pressure is simulated.
 * @param {boolean} stroke.simulatePressure Whether the pressure is derived from the
 *   speed of the stroke instead of read from the pointer.
 * @param {string} stroke.variability `"constant"` or `"variable"`.
 * @param {number} stroke.streamline How much the points are smoothed.
 * @param {{seed?: number}} [options] The seed the element is born with. A draft
 *   passes the seed its gesture was minted with, so the preview's wobble is the
 *   wobble the commit lands with; a commit passes nothing and gets a fresh one.
 * @returns {string} The JSON string ready for `Session.insert`.
 */
export function freedrawJsonFor(id, x, y, stroke, options = {}) {
    return JSON.stringify({
        id,
        type: "freedraw",
        x,
        y,
        // The birth width is the freedraw table's own (`getCurrentItemStrokeWidth`,
        // `App.tsx:8812-8814` → `FREEDRAW_STROKE_WIDTH`, `constants.ts:497-505`):
        // thin 0.5, medium 1, bold 2 — "freedraw schema 2.0 uses thinner stroke",
        // the generic table halved. The receipt `create-freedraw` measured
        // upstream 1 where this port's kernel default (the generic `medium` 2)
        // landed. The restore rule never sees this field: a document that
        // misses the key gets the type-blind generic default
        // (`restore.ts:481`), and a copy travels with an explicit width — so
        // the birth is the one moment this table applies, and the builder is
        // where the birth is.
        strokeWidth: 1,
        // The kernel derives the box from the points. These two are the place the
        // document's own shape has to be, and they are overwritten on the way in.
        width: 0,
        height: 0,
        angle: 0,
        points: stroke.points,
        pressures: stroke.pressures,
        simulatePressure: stroke.simulatePressure,
        strokeOptions: {
            variability: stroke.variability,
            streamline: stroke.streamline,
        },
        seed: options.seed ?? freshSeed(),
    });
}

/**
 * Build the JSON document the kernel's `Session.insert` expects for a
 * text element anchored at `(x, y)` in scene units. The text body
 * lives in `unmodelled.text` — the H5.8 wire contract: the body is
 * part of the document, not the geometry, and the kernel does not
 * model it (H5.11 is the cycle that adds the measurer + inline
 * editing). The fixed `width: 80, height: 25` matches Excalidraw's
 * default text box; the user resizes with the corner handles the
 * cycle that this row enables.
 *
 * The id is left to the caller because `Session.insert` mints nothing
 * on its own and the caller also needs the id to select the new
 * element afterwards.
 *
 * @param {string} id Element id, pre-minted by the caller.
 * @param {number} x Scene-unit x of the top-left corner.
 * @param {number} y Scene-unit y of the top-left corner.
 * @returns {string} The JSON string ready for `Session.insert`.
 */
export function textJsonFor(id, x, y) {
  return JSON.stringify({
    id,
    type: "text",
    x,
    y,
    width: 80,
    height: 25,
    angle: 0,
    fontSize: 20,
    // No `fontFamily` here on purpose: the family is an entry of the format's
    // font table, and that table has one owner — the kernel
    // (`DEFAULT_FONT_FAMILY`) — which applies it to an element that names no
    // family. A client that carries the index carries a second place to
    // change it: the format's default could move and the client would go on
    // naming the old face.
    textAlign: "left",
    verticalAlign: "top",
    lineHeight: 1.25,
    baseFontSize: null,
    seed: freshSeed(),
    groupIds: [],
    frameId: null,
    roundness: null,
    fillStyle: "solid",
    strokeStyle: "solid",
    fill: "#1e1e1e",
    stroke: "#1e1e1e",
    // No `strokeWidth` here on purpose: the width is a number the kernel owns
    // (`default_stroke_width`, the `medium` upstream writes), and a client that
    // carries its own value is a second place to change it.
    opacity: 100,
    roughness: 1,
    unmodelled: { text: "Hello" },
  });
}

/**
 * The document a **created** text is born as — the one the text tool's
 * editor writes when the user confirms, upstream's
 * `textElement` with `autoResize: true` (the road itself is
 * `packages/excalidraw/components/App.textTool.ts`, whose editor births
 * the element at `newElement.ts` with `originalText` and `autoResize`;
 * the measured receipt `create-text`, d3a9c2a1). The receipt measured the
 * birth road
 * field by field: the reference writes `autoResize: true`,
 * `originalText` (the body before any wrap — equal to the body here, since
 * the text is born unwrapped) and `labelPosition: null`, and it writes no
 * `fill`/`stroke` pair — those two names are this port's old vocabulary,
 * and a birth that carries them is a birth the reference never made. The
 * box handed over is only a claim: the kernel measures the body on the way
 * in and writes the true one.
 *
 * @param {string} id Element id, pre-minted by the caller.
 * @param {string} body The text the user wrote and confirmed.
 * @param {number} x The scene x of the click that opened the editor.
 * @param {number} y The scene y of the click that opened the editor.
 * @returns {string} The JSON string ready for `Session.insert`.
 */
export function createdTextJsonFor(id, body, x, y, fixedWidth = null) {
  return JSON.stringify({
    id,
    type: "text",
    x,
    y,
    // The width a fixed birth carries is the drag's, and the kernel keeps
    // it (`TEXT-02`): a claim it honours for a body it also wraps at — the
    // auto-sizing birth sends a claim the kernel checks and replaces with
    // the body's own measure, exactly as it always has.
    width: fixedWidth ?? 80,
    height: 25,
    angle: 0,
    fontSize: 20,
    // No `fontFamily` here, the same reason `textJsonFor` names none.
    textAlign: "left",
    verticalAlign: "top",
    lineHeight: 1.25,
    baseFontSize: null,
    originalText: body,
    seed: freshSeed(),
    groupIds: [],
    frameId: null,
    roundness: null,
    fillStyle: "solid",
    strokeStyle: "solid",
    // No `fill`/`stroke` here on purpose: the receipt measured them as
    // missing-in-upstream, and a birth document that carries them carries
    // fields the reference never wrote.
    opacity: 100,
    roughness: 1,
    unmodelled: {
      text: body,
      autoResize: fixedWidth === null,
      labelPosition: null,
    },
  });
}

/**
 * Build the JSON document an **empty arrow label** is born as — the label a
 * double click on a turning arrow opens, upstream's `startTextEditing` bound
 * text (`App.text.ts`). The fields are the executed oracle's own: the
 * `elbow-release-segment` receipt measured the reference's answer field by
 * field — an 8×25 text bound to the arrow, `textAlign: "center"`,
 * `verticalAlign: "middle"`, `labelPosition: 0.5`, `originalText: ""`,
 * `autoResize: true` — and the kernel writes the box (the cursor's 8) and
 * the place on the chain itself, so the geometry here is a claim it checks
 * and discards, exactly as with every other bound text.
 *
 * @param {string} id the label's own identity, minted by the caller.
 * @param {string} [body] the text the user wrote, when the label is born with
 *   one. The text tool's click binds the label at the commit, with the body
 *   the editor handed back (`TEXT-04`); the double click's arrow editor starts
 *   empty and keeps the draft outside the document, so it names none.
 */
export function arrowLabelJsonFor(id, body = "") {
  return JSON.stringify({
    id,
    type: "text",
    x: 0,
    y: 0,
    width: 80,
    height: 25,
    angle: 0,
    fontSize: 20,
    // No `fontFamily` here, the same reason `textJsonFor` names none.
    textAlign: "center",
    verticalAlign: "middle",
    lineHeight: 1.25,
    baseFontSize: null,
    originalText: body,
    seed: freshSeed(),
    groupIds: [],
    frameId: null,
    roundness: null,
    fillStyle: "solid",
    strokeStyle: "solid",
    // No `fill`/`stroke` here, the same reason `createdTextJsonFor` names
    // none: the receipt measured them as missing-in-upstream.
    opacity: 100,
    roughness: 1,
    unmodelled: { text: body, autoResize: true, labelPosition: 0.5 },
  });
}

/**
 * Build the JSON document the kernel's `Session.bindText` expects for a text
 * to bind to a container.
 *
 * The **body** is the user's, and the **geometry** is not: the kernel wraps
 * the body at the container's width, measures it, grows the container if the
 * label does not fit, and places the label in the middle of it. So the box
 * sent here is a claim the kernel checks and discards, exactly as it does
 * with every other text (`Action::Insert`), and the place sent here is a
 * placeholder for the same reason: the label goes where the shape puts it.
 *
 * The id is the caller's, because the client mints ids and the kernel mints
 * none.
 *
 * @param {string} id Element id, pre-minted by the caller.
 * @param {string} body The text the user wrote.
 * @returns {string} The JSON string ready for `Session.bindText`.
 */
export function boundTextJsonFor(id, body) {
    const json = JSON.parse(textJsonFor(id, 0, 0));
    // No `fill`/`stroke`: those two names are this port's old vocabulary, and
    // a birth that carries them is a birth the reference never made — the
    // `text-bind-container` receipt measured them as `missing-in-upstream` on
    // the label. `createdTextJsonFor` and `arrowLabelJsonFor` drop them for
    // the same reason.
    delete json.fill;
    delete json.stroke;
    // `labelPosition` is written even though a shape's label has none: the
    // reference writes the key with `null` on a bound text, and a key only one
    // of the two documents carries is a difference (`text-bind-container`
    // measured the field). A turning arrow's label carries `0.5` instead
    // (`arrowLabelJsonFor`), which is the same field with the arrow's own
    // meaning.
    json.unmodelled = { text: body, labelPosition: null };
    return JSON.stringify(json);
}

/** The drag tools in hint order, as names. Exposed for tests and for the hint. */
export const DRAW_TOOL_ORDER = Object.freeze(DRAW_TOOLS.map(({ tool }) => tool));

/**
 * Keyboard shortcut the user reaches the selection tool with. Excalidraw
 * uses `V`; we accept both `V` and `M` because `M` is the legacy
 * convention in some drawing apps, and one extra key is cheaper than
 * a user muscle-memory break. Case is normalised by the caller.
 */
const SELECTION_KEYS = new Set(["v", "m"]);

/**
 * Map a tool to a CSS cursor value. The selection tool answers `auto`, the
 * stylesheet's own cursor: upstream clears the interactive canvas's inline
 * cursor for the selection tool (`AppCursor.applyForTool`, the empty branch of
 * the `selection` arm, `packages/excalidraw/components/App.cursor.ts`), and a
 * cleared inline style computes to the stylesheet's value. The hovering
 * canvas has no `cursor` rule, so that value is the initial `auto` — which is
 * what HOVER-03 measures on the pin, over empty canvas at rest. The draw tools
 * all get `crosshair`: the user is picking two points, the canvas is the
 * workspace, the crosshair makes the drag's start visually obvious.
 *
 * The set is closed: an unknown tool falls back to `default` rather than
 * throwing, so a future tool can land without the CSS being a blocking
 * dependency. An unknown tool is not the selection tool, so its fallback is
 * not the selection tool's answer.
 *
 * The eraser takes the crosshair too. Upstream gives it a cursor of its own — an SVG
 * eraser icon (`applyEraser`, `packages/excalidraw/components/App.cursor.ts`) — and
 * reproducing that would mean shipping upstream's asset, while inventing one would mean a
 * cursor that is not the cursor upstream draws. The crosshair says the same thing with the
 * pen this client already has; the difference is recorded in `docs/PARITY.md`.
 *
 * @param {string} tool One of `TOOLS`.
 * @returns {string} A CSS `cursor` value.
 */
export function cursorFor(tool) {
  switch (tool) {
    case TOOLS.hand:
      return "grab";
    case TOOLS.selection:
      // Upstream's selection arm calls `clear()`, not `set("default")`: the
      // inline cursor is removed and the stylesheet's `auto` shows through.
      // Setting it explicitly to `auto` is the same computed value and keeps
      // the pipeline's one assignment per event (`syncCursor`).
      return "auto";
    case TOOLS.rectangle:
    case TOOLS.ellipse:
    case TOOLS.diamond:
    case TOOLS.line:
    case TOOLS.arrow:
    case TOOLS.freedraw:
    case TOOLS.eraser:
    case TOOLS.laser:
    case TOOLS.frame:
    case TOOLS.stickynote:
    case TOOLS.embeddable:
      return "crosshair";
    case TOOLS.text:
      return "text";
    default:
      return "default";
  }
}

/**
 * Whether the pointer may take hold of the chrome of the selection.
 *
 * The chrome is the handles and the rotate dot that surround the chosen element. Only
 * the selection tool may grab it, because only the selection tool is asking "what
 * happens to what is already there?" Every other tool is asking "what happens where I
 * put the pointer?", and the answer to that question does not depend on what happens to
 * be under it.
 *
 * The rule exists because the two used to be read in the wrong order: the chrome was
 * asked about first, so a drag that began on the handle of a chosen element resized it
 * even with a draw tool armed — the tool the user had just chosen lost against a piece
 * of the selection that happened to be under the pointer. The toolbar tool is the user's
 * intent and the hit test is a default for the case where there is no tool, so the tool
 * is asked first and the chrome is only consulted when the tool is the selection.
 *
 * @param {string} tool One of `TOOLS`.
 * @returns {boolean}
 */
export function consultsChrome(tool) {
    return tool === TOOLS.selection;
}

/**
 * Map a keyboard event to a tool, including the back-to-selection
 * shortcuts. Returns the new tool, or `null` if the key is not
 * recognised. The caller is expected to have already filtered for
 * bare unmodified keypresses; this is the last chance to claim a
 * tool change before the key falls through to the rest of the
 * keyboard handler.
 *
 * @param {string} key The `event.key` value, lower-cased.
 * @returns {string | null}
 */
export function toolForShortcut(key) {
  const draw = toolForKey(key);
  if (draw !== null) {
    return draw;
  }
  if (SELECTION_KEYS.has(key)) {
    return TOOLS.selection;
  }
  return null;
}

/**
 * Every key that reaches a tool: the draw tools' letters and the selection's two.
 *
 * It is the tool table read as a list, so the registry names one verb per row and a
 * tool added to the table gets its shortcut without a second list. `Shift` is not
 * among the modifiers of any of them: a plain tool is only reached when Shift is
 * **absent**, or `Shift+V` would pick the selection tool *and* flip the selection.
 */
/**
 * The number each tool answers besides its letter, from the reference's table.
 *
 * Upstream's help lists every tool twice — by letter and by number — and the
 * number is the second way to reach the same tool, not a second tool. The
 * digits follow the toolbar's row, so a person who counts the buttons lands on
 * the same keys the reference counts them with.
 */
export const TOOL_NUMBER_ALIASES = Object.freeze({
  v: "1",
  r: "2",
  d: "3",
  o: "4",
  a: "5",
  l: "6",
  p: "7",
  t: "8",
  e: "0",
});

/**
 * The same table read the other way: the digit reaches the tool its letter
 * reaches.
 *
 * The selection is the one row whose letter is not in `TOOL_KEYS` — it lives
 * in `SELECTION_KEYS` — so it is named here instead of looked up, and `1`
 * answers the selection the way upstream's `numericKey` does.
 */
const TOOL_BY_NUMBER = new Map(
  Object.entries(TOOL_NUMBER_ALIASES).map(([letter, number]) => [
    number,
    letter === "v" ? TOOLS.selection : (TOOL_KEYS.get(letter) ?? null),
  ]),
);

/**
 * The letter a tool is reached by, in the case upstream writes it, or `null`.
 *
 * Upstream's badge is the capital letter (`getToolLetter`, `Tools.tsx:178`),
 * and the selection has one even though it has no row in the keyboard's
 * letter table: `V` is the key `Escape` and the selection button share.
 *
 * @param {string} tool One of `TOOLS`.
 * @returns {string|null}
 */
export function letterKeyFor(tool) {
  const key = keyForTool(tool);
  if (key !== null) {
    return key.toUpperCase();
  }
  return tool === TOOLS.selection ? "V" : null;
}

/**
 * The digit upstream lists beside this tool, or `null`.
 *
 * The digits follow the toolbar's row, so the number is derived from the same
 * letter table the keyboard reads rather than written a second time.
 *
 * @param {string} tool One of `TOOLS`.
 * @returns {string|null}
 */
export function numericKeyFor(tool) {
  if (tool === TOOLS.selection) {
    return TOOL_NUMBER_ALIASES.v;
  }
  for (const [letter, candidate] of TOOL_KEYS) {
    if (candidate === tool) {
      return TOOL_NUMBER_ALIASES[letter] ?? null;
    }
  }
  return null;
}

/**
 * The tool's shortcut as upstream prints it: "R o 2" in Spanish, "R or 2" in
 * English, and the bare letter when the tool has no digit.
 *
 * One place composes it — the button's `title`, its `aria-keyshortcuts` and
 * the translated rebuild in `localizeTools` all call this — so the tooltip,
 * the assistive name and the badge cannot name three different keys.
 *
 * @param {string} tool One of `TOOLS`.
 * @param {string} [or] The locale's word for "or".
 * @returns {string|null} `null` for the web embed, whose upstream row has no key.
 */
export function shortcutLabelFor(tool, or = "or") {
  const letter = letterKeyFor(tool);
  const numeric = numericKeyFor(tool);
  if (letter !== null && numeric !== null) {
    return `${letter} ${or} ${numeric}`;
  }
  return letter ?? numeric;
}

/**
 * The letter the button prints in its corner, or `null` when upstream hides it.
 *
 * Upstream's hand button carries `hideKeyBinding` (`Toolbar.tsx:289`): the
 * title and `aria-keyshortcuts` still name H, but the badge stays off the
 * glass because the hand is reached by every pointer as much as by its key.
 * The selection shows V, and every other lettered tool shows its letter.
 *
 * @param {string} tool One of `TOOLS`.
 * @returns {string|null}
 */
export function keyBindingFor(tool) {
  if (tool === TOOLS.hand) {
    return null;
  }
  return letterKeyFor(tool) ?? numericKeyFor(tool);
}

export const TOOL_SHORTCUT_KEYS = Object.freeze([
  ...[...TOOL_KEYS.keys()].filter((key) => key !== null),
  ...SELECTION_KEYS,
]);

/**
 * The six alignment gestures, keyed by the key that triggers them.
 *
 * The four arrows cover the four edges and `H` / `V` cover the two centres,
 * because there is no fifth or sixth arrow to press. `Control+Shift` is the
 * modifier pair upstream's help lists (`HelpDialog.tsx`, «Alineación superior
 * Control Shift Up»), which is why `Alt` is not in the caller: it leaves
 * `Shift+Arrow` free for the coarse nudge and `Alt+Arrow` for the flowchart
 * walk.
 *
 * Values are the two strings the WASM boundary takes verbatim, so this table is
 * the whole client-side contract for alignment — there is no arithmetic here to
 * get wrong, only a lookup.
 */
const ALIGN_KEYS = new Map([
  ["arrowleft", { axis: "horizontal", mode: "start" }],
  ["arrowright", { axis: "horizontal", mode: "end" }],
  ["arrowup", { axis: "vertical", mode: "start" }],
  ["arrowdown", { axis: "vertical", mode: "end" }],
  ["h", { axis: "horizontal", mode: "center" }],
  ["v", { axis: "vertical", mode: "center" }],
]);

/** Every key that names an alignment, as the table spells it (lower case). */
export const ALIGN_SHORTCUT_KEYS = Object.freeze([...ALIGN_KEYS.keys()]);

/**
 * Map a keyboard event to an alignment, or `null` if the key is not one.
 *
 * The caller is expected to have already filtered for `Alt+Shift` without `Cmd`;
 * this only decides *which* alignment, and a fresh object each call so a caller
 * that mutates the result cannot corrupt the table for the next keystroke.
 *
 * @param {string} key The `event.key` value, lower-cased.
 * @returns {{ axis: string, mode: string } | null}
 */
export function alignOpFor(key) {
  const op = ALIGN_KEYS.get(key);
  return op === undefined ? null : { ...op };
}
