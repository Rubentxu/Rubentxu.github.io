// The pointer shape over the selection's chrome: the cursor half of D7.
//
// # What this decides
//
// Upstream publishes a cursor per affordance, and the canvas is the only place
// a user finds out what a press would do. Four answers cover the chrome:
//
// - a resize handle names the axis its drag resizes (`nwse-resize`,
//   `ns-resize`, ...), and the name is turned with the element
//   (`getCursorForResizingElement` and `rotateResizeCursor`,
//   `packages/element/src/resizeTest.ts:221-285`);
// - the rotate dot offers `grab`, the same `getCursorForResizingElement`
//   answers for `transformHandleType === "rotation"`;
// - the end or the middle of a linear element offers `pointer`
//   (`handleHoverSelectedLinearElement`,
//   `packages/excalidraw/components/App.tsx:7400-7412`);
// - the element itself, or the inside of a selection's common box, offers
//   `move` (`CURSOR_TYPE.MOVE`, the same handler).
//
// A point over none of those is not this module's answer: the canvas falls
// back to the tool's own cursor, the way upstream clears the inline cursor to
// the stylesheet's value.
//
// # Why the angle comes from the record
//
// A turned element's handles are laid out on its unturned frame and turned
// about its centre, so the turn is a fact of the record the painter drew.
// Reading it back from that record — rather than from a second copy of the
// element — is what makes the cursor and the square under the pointer the
// same object: a client that asked the scene again could disagree with the
// glass after an undo, a preview, or a frame the painter had not caught up
// with.
//
// The frame's horizontal axis is the `w`→`e` handle segment; a rotation moves
// it by exactly the element's angle, and the four names repeat every 180°, so
// an angle whose sign is lost is still the right cursor. The flip is the
// corner order: a rotation cannot change the sign of the polygon's cross
// product, and a stored width and height that disagree reverse it — the same
// product upstream tests with `Math.sign(height) * Math.sign(width) === -1`.

/**
 * The four names upstream rotates through, in its order.
 *
 * The order is the whole of the 45°-step rule: each step moves to the next
 * name, so a 45° turn makes `ns` diagonal and a 90° turn makes it horizontal.
 * The names are bare here and `-resize` is appended once, because upstream
 * formats the cursor the same way.
 */
const RESIZE_CURSORS = ["ns", "nesw", "ew", "nwse"];

/** The 45° a turn is rounded to. */
const RESIZE_STEP = Math.PI / 4;

/**
 * `cursor` turned by `angle` in 45° steps, in upstream's list.
 *
 * `Math.round` and not `Math.floor`: an element turned 44° still shows the
 * cursor it had, and one turned 46° shows the next. The index is normalised
 * into the list rather than trusted to JavaScript's signed `%`, which would
 * answer `undefined` for the first negative step and turn a rotated element's
 * cursor into nothing.
 *
 * @param {string} cursor a bare name from [`RESIZE_CURSORS`].
 * @param {number} angle the element's turn, in radians.
 * @returns {string} the bare name at that turn.
 */
function turnCursor(cursor, angle) {
    const index = RESIZE_CURSORS.indexOf(cursor);
    if (index < 0) {
        return cursor;
    }
    const steps = Math.round(angle / RESIZE_STEP);
    return RESIZE_CURSORS[((index + steps) % RESIZE_CURSORS.length + RESIZE_CURSORS.length) % RESIZE_CURSORS.length];
}

/**
 * The cursor of one resize handle, turned with its element.
 *
 * The handle names a side or a corner. A side resizes one axis; a corner
 * resizes both, and a corner on a flipped element names the two axes the other
 * way round — upstream's `shouldSwapCursors`. A flipped element keeps its side
 * cursors, because a flip reverses both axes and a horizontal side was already
 * horizontal.
 *
 * @param {string} name the handle's wire name (`nw`, `n`, ...).
 * @param {number} [angle] the element's turn, in radians.
 * @param {{ flipped?: boolean }} [frame] whether the stored width and height disagree.
 * @returns {string | null} a CSS cursor, or `null` when the name is not a handle.
 */
export function resizeCursorFor(name, angle = 0, { flipped = false } = {}) {
    let cursor;
    switch (name) {
        case "n":
        case "s":
            cursor = "ns";
            break;
        case "w":
        case "e":
            cursor = "ew";
            break;
        case "nw":
        case "se":
            cursor = flipped ? "nesw" : "nwse";
            break;
        case "ne":
        case "sw":
            cursor = flipped ? "nwse" : "nesw";
            break;
        default:
            // The caller has asked about a name the chrome never publishes. A
            // made-up cursor would advertise a control that is not there.
            return null;
    }
    return `${turnCursor(cursor, angle)}-resize`;
}

/**
 * The cursor the chrome under the pointer offers, or `null` for none.
 *
 * The order is the order the hit already resolved: this function is handed the
 * one piece the kernel named, so the rotate dot cannot be shadowed by a handle
 * and an end of a line cannot be shadowed by the body. The `handle` answer is
 * the only one that needs the element's frame.
 *
 * A segment handle of a turning arrow answers `move`, not `pointer`: upstream's
 * hover path gives `pointer` to the real points and to a two-point line's
 * midpoint, while the handle of a segment reaches the element's own move. The
 * drag still pins the segment; only the cursor is the element's.
 *
 * @param {{ kind?: string, name?: string } | null} hit what the chrome names under the pointer.
 * @param {number} [angle] the element's turn, in radians.
 * @param {{ flipped?: boolean }} [frame] whether the stored width and height disagree.
 * @returns {string | null} a CSS cursor, or `null` when the piece has no cursor of its own.
 */
export function cursorForChrome(hit, angle = 0, { flipped = false } = {}) {
    switch (hit?.kind) {
        case "handle":
            return typeof hit.name === "string" ? resizeCursorFor(hit.name, angle, { flipped }) : null;
        case "rotate":
            return "grab";
        case "vertex":
        case "midpoint":
            return "pointer";
        case "segment":
        case "body":
            return "move";
        default:
            return null;
    }
}

/**
 * The turn and the flip of a chrome record, as the painter drew it.
 *
 * The turn comes from the frame's horizontal axis, which is the `w`→`e` handle
 * segment. The rotate dot is the fallback: it hangs from the frame's up
 * direction, so its vector from the centre is the turn minus a quarter. An
 * element with neither is upright, which is also the answer for a missing
 * record: a cursor that refused to exist because the frame was not in hand
 * would leave the canvas with no hover at all.
 *
 * The flip is the sign of the corner polygon's cross product. The polygon is
 * the stored box rotated once, and a rotation preserves the sign, so the sign
 * is the stored width and height disagreeing — upstream's
 * `Math.sign(height) * Math.sign(width) === -1`.
 *
 * A record that carries `vertices` is a linear element's, and its ring is the
 * polyline rather than a box's four corners: a four-point polyline would
 * otherwise look like a corner polygon and be read as flipped. Upstream's
 * width and height of a linear element are its extent's and never disagree,
 * so a linear element is never flipped and its handles are laid out on the
 * upright frame.
 *
 * @param {{ handles?: object | null, rotate?: object | null, vertices?: object | null, polygon?: number[][] | null } | null} record the chrome record.
 * @returns {{ angle: number, flipped: boolean }} the frame's facts.
 */
export function chromeGeometry(record) {
    let angle = null;
    const handles = record?.handles ?? null;
    if (Array.isArray(handles?.w) && Array.isArray(handles?.e)) {
        const dx = handles.e[0] - handles.w[0];
        const dy = handles.e[1] - handles.w[1];
        if (Number.isFinite(dx) && Number.isFinite(dy) && (dx !== 0 || dy !== 0)) {
            angle = Math.atan2(dy, dx);
        }
    }
    if (angle === null && Array.isArray(record?.rotate?.handle) && Array.isArray(record?.rotate?.centre)) {
        const dx = record.rotate.handle[0] - record.rotate.centre[0];
        const dy = record.rotate.handle[1] - record.rotate.centre[1];
        if (Number.isFinite(dx) && Number.isFinite(dy) && (dx !== 0 || dy !== 0)) {
            angle = Math.atan2(dy, dx) + Math.PI / 2;
        }
    }
    // A linear element's ring is its points, not a box's corners, and a
    // four-point polyline would otherwise be read as a flipped box. Its stored
    // width and height are its extent's, which never disagree.
    const boxed = record?.vertices === null || record?.vertices === undefined;
    return { angle: angle ?? 0, flipped: boxed && flippedPolygon(record?.polygon) };
}

/**
 * Whether a chrome record's corner polygon was drawn in the flipped order.
 *
 * Four points or none: a linear element's ring is its points and says nothing
 * about a box, so it is not a corner polygon and cannot be flipped. The sign
 * of the cross product at the first two edges is the box's orientation, and
 * the rotation applied to the polygon does not change it.
 *
 * @param {number[][] | null | undefined} polygon the record's ring.
 * @returns {boolean} whether the stored corners turn the other way.
 */
function flippedPolygon(polygon) {
    if (!Array.isArray(polygon) || polygon.length !== 4) {
        return false;
    }
    const [first, second, third] = polygon;
    if (!Array.isArray(first) || !Array.isArray(second) || !Array.isArray(third)) {
        return false;
    }
    const cross =
        (second[0] - first[0]) * (third[1] - second[1]) -
        (second[1] - first[1]) * (third[0] - second[0]);
    return cross > 0;
}

/**
 * The text tool's own cursor over a hover, from what a click there would edit.
 *
 * The pin answers the hover and the click with one question — `getTargetAt`
 * — "so the affordance can never promise something the click won't deliver"
 * (`App.textTool.ts`), and its `cursorFor` reads that answer
 * (`App.textTool.ts:266`): POINTER over an arrow, TEXT over text, otherwise
 * CROSSHAIR. The kernel's target answer already names the roads this client
 * edits with: `text` is the text under the pointer, `container` with
 * `arrowLabel` is the empty arrow whose centre the click would label — the
 * pin's `{type:"arrow", anchor:"label"}` of `toHoverState`
 * (`App.textTool.ts:47-66`) — and a plain `container` is the shape's label
 * road, which the pin leaves under the crosshair. Everything else is free
 * text, the crosshair's road too.
 *
 * Ctrl or Cmd is "no binding" for the whole tool (`App.textTool.ts:128`):
 * the modifier suppresses the container target, so only the text under the
 * pointer keeps its own cursor and everything else falls back to the
 * crosshair of free text.
 *
 * @param {{ text?: string, container?: string, arrowLabel?: boolean } | null} target what a click at the pointer would edit.
 * @param {{ ctrlOrCmd?: boolean }} [modifiers] the modifiers of the move in hand.
 * @returns {string} a CSS cursor.
 */
export function textToolCursorFor(target, { ctrlOrCmd = false } = {}) {
  if (target?.text !== undefined) {
    return "text";
  }
  if (target?.arrowLabel === true && !ctrlOrCmd) {
    return "pointer";
  }
  return "crosshair";
}
