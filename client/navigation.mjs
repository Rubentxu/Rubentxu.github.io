// Navigation of the view: what a wheel event and a view key mean.
//
// Pure on purpose. The page owns the session and the repaint; this module only
// answers "which move is this input?", so the answer can be tested without a
// browser and the page has one place to look.

import { wheelZoom } from "./zoom.mjs";

/** Pixels a "line" wheel (`deltaMode` 1) is worth; browsers report lines for some mice. */
const LINE_PIXELS = 16;

/** Pixels a "page" wheel (`deltaMode` 2) is worth. */
const PAGE_PIXELS = 800;

function pixels(delta, mode) {
  if (mode === 1) {
    return delta * LINE_PIXELS;
  }
  if (mode === 2) {
    return delta * PAGE_PIXELS;
  }
  return delta;
}

/**
 * The move a wheel event asks for.
 *
 * - Ctrl or Meta (a trackpad pinch arrives as Ctrl+wheel): zoom by the wheel's
 *   own arithmetic — every tick moves, `delta / 100` clamped to one step and
 *   lifted by the zoomed-in acceleration — toward the cursor. There is no notch
 *   threshold to hold a tick back: the reference answers each one, and a tick
 *   too small to matter moves too little to repaint for.
 * - Otherwise: pan by the delta. The content follows the wheel, so the scroll
 *   offset moves the other way. Shift with a purely vertical delta scrolls
 *   sideways, as it does in every other editor.
 *
 * @param {{ deltaX: number, deltaY: number, deltaMode?: number, ctrlKey?: boolean,
 *   metaKey?: boolean, shiftKey?: boolean, offsetX?: number, offsetY?: number }} event
 * @param {number} zoom The session's current zoom.
 * @param {number} pending The zoom accumulator carried between events.
 * @returns {{ move: { dx: number, dy: number } | { zoomTo: number } | null,
 *   pending: number }} A pan carries screen-pixel offsets; a zoom carries its target.
 */
export function wheelMove(event, zoom, pending) {
  const mode = event.deltaMode ?? 0;
  if (event.ctrlKey || event.metaKey) {
    const target = wheelZoom(zoom, pixels(event.deltaY, mode));
    // A zoom at the bounds has nowhere to go; no move means no repaint.
    return { move: target === zoom ? null : { zoomTo: target }, pending };
  }
  let dx = pixels(event.deltaX, mode);
  let dy = pixels(event.deltaY, mode);
  if (event.shiftKey && dx === 0) {
    dx = dy;
    dy = 0;
  }
  if (dx === 0 && dy === 0) {
    return { move: null, pending };
  }
  return { move: { dx: -dx, dy: -dy }, pending };
}

/**
 * The view command a key press names, or `null`.
 *
 * Ctrl/Meta with `+`, `=`, `-`, `0` zoom in, out and back to 100%; Shift+1 fits the
 * whole drawing and Shift+2 fits the selection. The digit is read from `code` first
 * because the character Shift+1 types depends on the layout.
 *
 * @param {{ key: string, code?: string, ctrlKey?: boolean, metaKey?: boolean,
 *   shiftKey?: boolean, altKey?: boolean }} event
 * @returns {"zoom-in" | "zoom-out" | "zoom-reset" | "fit-content" | "fit-selection" | null}
 */
export function viewKeyAction(event) {
  if (event.altKey) {
    return null;
  }
  const mod = Boolean(event.ctrlKey || event.metaKey);
  // The zoom keys name the physical key (`actionCanvas.tsx:181,233`: the
  // keyTest is `CODES.EQUAL`/`NUM_ADD` in and `MINUS`/`NUM_SUBTRACT` out,
  // with Ctrl or Shift held) — the character Shift types differs per layout,
  // so the character is the wrong reader.
  const zoomKey =
    event.code === "Equal" || event.code === "NumpadAdd"
      ? "zoom-in"
      : event.code === "Minus" || event.code === "NumpadSubtract"
        ? "zoom-out"
        : null;
  if (zoomKey !== null && (mod || event.shiftKey)) {
    return zoomKey;
  }
  if (mod) {
    if (event.key === "+" || event.key === "=") {
      return "zoom-in";
    }
    if (event.key === "-" || event.key === "_") {
      return "zoom-out";
    }
    if (event.key === "0") {
      return "zoom-reset";
    }
    return null;
  }
  if (event.shiftKey) {
    if (event.code === "Digit1" || event.key === "!") {
      return "fit-content";
    }
    if (event.code === "Digit2" || event.key === "@") {
      return "fit-selection";
    }
  }
  return null;
}
