// Asking the browser not to evict the drawing.
//
// # Why this exists
//
// `localStorage` is "best effort" until the origin is marked persistent: under
// storage pressure the browser may clear it without asking, and the drawing
// goes with it. `navigator.storage.persist()` is the request that moves the
// origin out of that class. It is a request, not a command — the browser may
// say no, may show a prompt, or may not have the API at all — so nothing here
// can be allowed to matter to the save.
//
// # When it is asked
//
// Once, after the first write that stuck. Asking before there is anything to
// protect would prompt a user who has drawn nothing, and a prompt without a
// reason is a prompt that gets refused. Asking again after a "no" would repeat
// a question the browser has already weighed, so the answer is final for the
// life of the page.
//
// # What it never does
//
// It never throws and never rejects: the API missing, `persisted()` failing,
// `persist()` refusing and the property access itself raising all end in the
// same quiet `false`. The save already landed when this runs, so the drawing is
// safe whatever this answers.
//
// # The browser is a parameter
//
// The `navigator` comes in, as the document and the window do elsewhere in the
// client, so a test holds a fake `storage` and the page passes the real one.

/**
 * @typedef {object} PersistRequest
 * @property {() => Promise<boolean>} afterWrite Call after a write that stuck.
 *   The first call asks the browser; later calls do nothing and answer `false`.
 *   Resolves to whether the origin is persistent.
 * @property {() => boolean} asked Whether the request has been made.
 */

/**
 * @param {{ storage?: { persist?: () => Promise<boolean>, persisted?: () => Promise<boolean> } } | null} [browser]
 *   The navigator to ask. Defaults to the global one.
 * @returns {PersistRequest}
 */
export function createPersistRequest(browser = globalThis.navigator) {
    let asked = false;

    async function ask() {
        let storage;
        try {
            storage = browser?.storage;
        } catch {
            return false;
        }
        try {
            // A missing method is a TypeError here, and lands in the same
            // quiet `false` as a refusal.
            if (typeof storage?.persisted === "function" && (await storage.persisted()) === true) {
                return true;
            }
            return (await storage.persist()) === true;
        } catch {
            return false;
        }
    }

    return {
        afterWrite() {
            if (asked) {
                return Promise.resolve(false);
            }
            asked = true;
            return ask();
        },
        asked: () => asked,
    };
}
