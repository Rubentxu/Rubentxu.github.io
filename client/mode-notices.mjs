// The sentences the status line says when a mode flips, a save lands or a recovery ends.
//
// Each one is a fixed sentence the person reads, so each is a catalog key with its English
// written here as the source. The table is the oracle of which keys exist: the catalogs
// translate these and nothing else, and a sentence added here without a translation fails the
// test that compares the two. A sentence that carries a value names it in braces, so the
// translator may put it wherever the language wants it.

/** Catalog key → English source, for every notice the application root says by key. */
export const MODE_NOTICES = Object.freeze({
    "notice.zen.on": "Zen mode: Alt+Z brings the controls back.",
    "notice.zen.off": "The controls are back.",
    "notice.view.on": "View mode: Alt+R gives the canvas back.",
    "notice.view.off": "The canvas is yours again.",
    "notice.grid.on": "Grid on, step {step}.",
    "notice.grid.off": "The grid is off.",
    "notice.snap.on": "Snap guides on.",
    "notice.snap.off": "Snap guides off; moves land where the pointer does.",
    "notice.midpoint.on": "Midpoint markers on. Choose Midpoint snapping again to turn them off.",
    "notice.midpoint.off": "Midpoint markers off.",
    "notice.vertex-delete.edit-mode": "The edit mode is on: pick a vertex and press Supr to take it out.",
    "notice.save.done": "Saved as nextdraw.nextdraw.",
    "notice.recover.done": "Recovered a drawing that could not be opened.",
    "notice.recover.offered": "The drawing was put aside and offered as a file. The copy is kept here.",
    "notice.recover.retry":
        "The file was written, but the copy kept here could not be removed. Press Recover to try again.",
    "notice.recover.unconfirmed": "The file was not confirmed on disk, so the copy is kept here.",
    "notice.recover.paused": "Autosave is still paused.",
    "notice.update.available": "A new version is ready. Reload the page to use it.",
    "notice.worker.failed":
        "The offline worker could not be registered, so this page will not work offline.",
    "notice.tabs.other":
        "The drawing changed in another tab. Autosave is paused until you choose which version to keep.",
});

/**
 * The words of one notice.
 *
 * @param {(key: string, source: string) => string} text The words by key; the application root's.
 * @param {keyof typeof MODE_NOTICES} key The notice.
 * @param {Record<string, string | number>} [values] What the braces in the sentence name.
 * @returns {string}
 */
export function noticeText(text, key, values = {}) {
    return text(key, MODE_NOTICES[key]).replace(/\{(\w+)\}/g, (whole, name) =>
        Object.hasOwn(values, name) ? String(values[name]) : whole,
    );
}
