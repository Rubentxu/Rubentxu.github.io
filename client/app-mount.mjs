// The markup the factory mounts into, and the error contract of a boot
// that cannot happen.
//
// `createNextDrawApp(root)` is the one way a foreign page gets the editor,
// and the first thing it does with `root` is look up eight nodes by id. When
// one is missing the old answer was a TypeError from deep inside the boot —
// the kind of failure a consumer cannot catch by name, because nothing says
// which piece of markup went missing. This module owns the list and the
// check, so the factory can refuse before anything loads and say exactly
// what the page forgot:
//
//     createNextDrawApp(aDivWithoutMarkup)
//         → rejects with "nextdraw-boot: root lacks #canvas" …
//
// The contract, written where both sides can read it:
//
// - The call returns a promise. It **resolves** with `{ root, session }`
//   when the markup is whole and the kernel loaded.
// - It **rejects** with an `Error` whose message starts `nextdraw-boot:`
//   when it cannot: markup missing (the message names every missing id),
//   or the kernel failing to load (the message carries the kernel's own).
//   A page that catches it owns the failure display; the status line also
//   says the human-readable half when the markup still has one.
// - Booting twice into one root is not refused here: the browser answers a
//   second service-worker registration with the first, the event listeners
//   of the second boot bind to the same nodes, and the page that wants one
//   editor mounts once. The refusal the factory does make is the markup
//   one, above, because a half-built mount is a bug in the page and saying
//   so beats a crash an hour later.

/**
 * The ids the factory's boot looks up in `root`, in the order it looks
 * them up. The list is the contract: a root carrying these eight nodes is
 * a root the editor can mount into.
 *
 * @type {string[]}
 */
export const REQUIRED_MARKUP = Object.freeze([
    "#canvas",
    "#status",
    "#embeddable-layer",
    "#chart-dialog",
    "#link-dialog",
    "#clear-canvas-dialog",
    "#link-popup",
    "#tab-conflict-dialog",
]);

/**
 * Which of the required nodes `root` lacks.
 *
 * Every missing id is collected rather than only the first, because the
 * cheapest debugging session is the one that names all the forgotten nodes
 * at once.
 *
 * @param {ParentNode} root the box the page offers the editor.
 * @returns {string[]} the selectors with no node behind them, in the
 *   contract's order.
 */
export function missingMarkup(root) {
    if (root === null || root === undefined) {
        return [...REQUIRED_MARKUP];
    }
    return REQUIRED_MARKUP.filter((selector) => root.querySelector(selector) === null);
}

/**
 * Refuse a root that lacks part of the contract, with the message the page shows.
 *
 * The refusal is the mount's first act, before the kernel is asked for and
 * before anything binds: a root that lacks a node is a bug in the page, and a
 * named error beats a TypeError an hour deep. The status line is told when the
 * root still carries one, because a page that does not catch the rejection
 * still deserves the message on screen.
 *
 * @param {ParentNode} root the box the page offers the editor.
 * @returns {string | null} the refusal's message, or `null` when the root is whole.
 */
export function refuseMissingMarkup(root) {
    const missing = missingMarkup(root);
    if (missing.length === 0) return null;
    const message = `nextdraw-boot: root lacks ${missing.join(", ")}`;
    const statusNode = root === null || root === undefined ? null : root.querySelector("#status");
    if (statusNode !== null) {
        statusNode.textContent = message;
        statusNode.style.color = "#a40000";
        statusNode.style.opacity = "0.9";
    }
    console.error(message);
    return message;
}
