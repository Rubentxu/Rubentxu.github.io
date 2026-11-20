const MIN_SIZE = 75;
const PADDING = 16;
const MIN_BODY_WIDTH_FOR_YEAR = 80;
const BASELINE_FROM_BOTTOM = 14;

function partsAt(milliseconds, timeZone) {
  const date = new Date(milliseconds);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    day: "numeric",
    month: "short",
    year: "numeric",
  }).formatToParts(date);
  return Object.fromEntries(parts.map(({ type, value }) => [type, value]));
}

/**
 * The one date-and-position decision shared by frame painting and SVG export.
 * Callers provide the frame/export time and IANA timezone explicitly; this function never reads a clock.
 */
export function getStickyNoteFooter({ created, width, height }, { nowMs, timeZone }) {
  if (width < MIN_SIZE || height < MIN_SIZE || !Number.isFinite(created)) {
    return null;
  }
  const date = partsAt(created, timeZone);
  const current = partsAt(nowMs, timeZone);
  if (date === null || current === null || date.day === undefined || current.year === undefined) {
    return null;
  }
  const label = `${Number(date.day)} ${date.month}`;
  const short = width - PADDING * 2 < MIN_BODY_WIDTH_FOR_YEAR;
  const text = short || date.year === current.year
    ? label
    : `${label} ${date.year}`;
  return { text, x: width - PADDING, y: height - BASELINE_FROM_BOTTOM };
}

/** Place an upstream note-local footer anchor in destination coordinates. */
export function placeStickyNoteFooter({ x, y, width, height, angle = 0 }, footer) {
  const radians = Number.isFinite(angle) ? angle : 0;
  const centerX = x + width / 2;
  const centerY = y + height / 2;
  const localX = footer.x - width / 2;
  const localY = footer.y - height / 2;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return {
    ...footer,
    x: centerX + localX * cosine - localY * sine,
    y: centerY + localX * sine + localY * cosine,
    angle: radians,
  };
}
