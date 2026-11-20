// The laser pointer's trail: what fades, and by which rule, in one place.
//
// # What the trail is
//
// The laser pointer is the tool for pointing *at* a drawing while somebody
// else looks at it: the pointer leaves a red comet behind it that fades away
// on its own, and nothing it drew ever reaches the document. It is the eraser's
// opposite twin — the eraser drags and takes away, the laser drags and leaves
// nothing at all — and the two share one shape of contract: the ink decays with
// the clock, so a copy kept by the client is a picture of the moment it was
// taken and nothing after it.
//
// This module holds the two rules the decay follows, and the client holds none
// of the trail's history outside it: the pointer pipeline feeds the points in
// and the paint asks for what is still alive, and between the two events the
// module is the only place the trail exists.
//
// # The two rules, and where they come from
//
// Both are upstream's own (`laserTrails.ts:29-38`), and a point's brightness is
// the **smaller** of the two — the trail dies at whichever rule ends first:
//
// - **The clock.** A point lives `LASER_DECAY_TIME` milliseconds and no
//   longer. A point that has outlived the clock is not a dim point; it is not
//   a point.
// - **The distance from the head.** The `LASER_DECAY_LENGTH` points nearest
//   the newest one carry the light; further back than that the trail is
//   already dark even at the moment it is drawn. This is what makes the trail
//   a comet rather than a wire: a long fast stroke is bright at the head and
//   dark at the tail while every point of it is still young.
//
// The curve each rule eases with is upstream's `easeOut`
// (`packages/common/src/utils.ts:253`), which starts slow and arrives fast —
// the trail stays legible for most of its life and then goes quickly, the
// way a real laser dot does when it is switched off.

/** How long a point lives, in milliseconds (`laserTrails.ts:29`). */
export const LASER_DECAY_TIME = 1000;

/** How many points behind the head carry the light (`laserTrails.ts:30`). */
export const LASER_DECAY_LENGTH = 50;

/** The colour the trail draws with (`DEFAULT_LASER_COLOR`, `constants.ts:38`). */
export const LASER_COLOR = "red";

/**
 * Upstream's arrival curve (`utils.ts:253`): slow to start, fast to finish.
 *
 * @param {number} k The progress, 0 to 1.
 * @returns {number} The eased progress.
 */
export function easeOut(k) {
  return 1 - Math.pow(1 - k, 4);
}

/**
 * A trail that holds points and answers with the ones still alive.
 *
 * The points are in **screen** pixels, the space the pointer reports and the
 * space the canvas paints in. Upstream draws its trail in a fixed overlay over
 * the canvas (`LaserTrails.start`, `laserTrails.ts:65-67`), so its trail does
 * not move when the view pans under it, and neither does this one: a point
 * marks where the laser *was*, not where a piece of the drawing is.
 *
 * `points` prunes before it answers, so the trail's own memory is bounded by
 * the clock: a point past `LASER_DECAY_TIME` is dropped the next time anybody
 * asks, and a trail nobody asks about holds at most the length of one gesture.
 *
 * @returns {object} The trail.
 */
export function createLaserTrail() {
  let points = [];
  return {
    /**
     * Put a point down.
     *
     * @param {number} x Screen x.
     * @param {number} y Screen y.
     * @param {number} nowMs The clock, in milliseconds — the instant the point was born.
     * @returns {void}
     */
    add(x, y, nowMs) {
      points.push({ x, y, at: nowMs });
    },

    /**
     * The points still alive at `nowMs`, oldest first, pruned in place.
     *
     * @param {number} nowMs The clock, in milliseconds.
     * @returns {Array<{x: number, y: number, at: number}>}
     */
    points(nowMs) {
      points = points.filter((point) => nowMs - point.at < LASER_DECAY_TIME);
      return points;
    },

    /**
     * Whether the trail shows anything at `nowMs`.
     *
     * The question the paint asks to decide whether to keep the decay loop
     * running: a trail with nothing alive has nothing to draw and nothing to
     * wait for, so the loop stops by itself rather than being cancelled.
     *
     * @param {number} nowMs The clock, in milliseconds.
     * @returns {boolean}
     */
    alive(nowMs) {
      return this.points(nowMs).length > 0;
    },
  };
}

/**
 * The brightness of every point at `nowMs`, oldest first.
 *
 * This is upstream's `sizeMapping` read over the whole trail
 * (`laserTrails.ts:29-38`): each point's size is the **smaller** of the clock
 * factor — how much of its second it has left — and the head factor — how
 * close it sits to the newest point, measured in points and dark beyond
 * `LASER_DECAY_LENGTH` of them. Taking the smaller is what makes the two
 * rules *both* true: a point is as bright as its weakest claim, and neither
 * rule can be defeated by the other.
 *
 * The answer is parallel to the trail — entry `i` is point `i`'s brightness —
 * so the paint can walk the two together without a second question per point.
 *
 * @param {Array<{x: number, y: number, at: number}>} points The trail, oldest first.
 * @param {number} nowMs The clock, in milliseconds.
 * @returns {number[]} Each point's brightness, 0 to 1.
 */
export function laserSizes(points, nowMs) {
  const total = points.length;
  return points.map((point, index) => {
    const byClock = Math.max(0, 1 - (nowMs - point.at) / LASER_DECAY_TIME);
    const distanceToHead = total - 1 - index;
    const byHead =
      (LASER_DECAY_LENGTH - Math.min(LASER_DECAY_LENGTH, distanceToHead)) /
      LASER_DECAY_LENGTH;
    return Math.min(easeOut(byHead), easeOut(byClock));
  });
}
