// The browser's storage, and the two ways it can say no.
//
// # Why this is its own file
//
// Two things live in the browser's storage: the drawing that survives the tab
// (`client/persist.mjs`) and the theme the user chose (`client/theme.mjs`).
// Both need the same three answers — where the store is, what is written in
// it, and whether a write stuck — and both have to survive the same two
// refusals.
//
// A refusal is not an edge case. Reading `globalThis.localStorage` can throw
// on the *property access*: a sandboxed origin or a blocked-cookies setting
// raises there, not on the first `setItem`. And a full quota throws on the
// write. The first copy of that guard lived inside `client/persist.mjs`, and
// a second copy in the theme would be a second answer to the same question —
// the shape this repository keeps paying for.
//
// # What a refusal means
//
// Reading: there is no value. That is not an error the user can act on, so it
// is `null` and nobody shouts about it.
//
// Writing: the value did not stick. That *is* something the user has to be
// told about, because a silent refusal is how a user finds out their drawing
// was never saved. So a write answers with a boolean and the caller decides
// what to say.
//
// Taking a value away: the key is empty afterwards. It is the same shape as
// the write, because it can fail the same way — a store that refuses to be
// written to can also refuse to be emptied.

/**
 * The storage to use, or `null` when there is none.
 *
 * Reading `globalThis.localStorage` can itself throw — a sandboxed origin or a
 * blocked-cookies setting raises on the *property access*, not on the first
 * `setItem` — so that read lives inside the guard. A caller-supplied storage
 * is returned untouched, which is the whole reason this is a parameter: the
 * tests run under `node:test` with no DOM and no browser.
 *
 * @param {unknown} [candidate] A storage to use instead of the browser's.
 * @returns {unknown | null}
 */
export function resolveStorage(candidate) {
    if (candidate !== undefined && candidate !== null) {
        return candidate;
    }
    try {
        return globalThis.localStorage ?? null;
    } catch {
        return null;
    }
}

/**
 * The text stored under `key`, or `null` when there is none.
 *
 * An empty string counts as absent. It is never a real value — a document
 * serialises to a non-empty JSON object and a theme is one of two words — so
 * it is what a store emptied by hand looks like, and handing it to a caller
 * that expects a document would be handing it something it cannot use.
 *
 * A store that throws on the read is treated as a store with nothing in it:
 * there is no value to report and no action the user could take about it.
 *
 * @param {string} key The key to read.
 * @param {unknown} [storage] A storage to use instead of the browser's.
 * @returns {string | null}
 */
export function readStored(key, storage) {
    const store = resolveStorage(storage);
    if (store === null) {
        return null;
    }
    let text;
    try {
        text = store.getItem(key);
    } catch {
        return null;
    }
    return text === null || text === "" ? null : text;
}

/**
 * Store `value` under `key`, reporting whether it stuck.
 *
 * The boolean is not decoration. A full quota or a blocked storage throws, and
 * the caller is in the middle of something the user is waiting for. Swallowing
 * that silently means the user finds out their choice was never kept when they
 * reload — so the caller gets to say so once, instead of losing it quietly.
 *
 * @param {string} key The key to write.
 * @param {string} value The text to write.
 * @param {unknown} [storage] A storage to use instead of the browser's.
 * @returns {boolean} Whether the store now holds the value.
 */
export function writeStored(key, value, storage) {
    const store = resolveStorage(storage);
    if (store === null) {
        return false;
    }
    try {
        store.setItem(key, value);
        return true;
    } catch {
        return false;
    }
}

/**
 * Empty `key`, reporting whether it happened.
 *
 * The third answer the store has to give, beside "is there a value" and "did
 * the value stick": "take it away". It is what lets a drawing that could not
 * be opened be *moved* rather than copied — the bytes stop sitting in the
 * place the live drawing lives, and that place can be written again.
 *
 * A store that refuses is reported, never thrown, like the other two answers.
 *
 * @param {string} key The key to empty.
 * @param {unknown} [storage] A storage to use instead of the browser's.
 * @returns {boolean} Whether the key is empty afterwards.
 */
export function clearStored(key, storage) {
    const store = resolveStorage(storage);
    if (store === null) {
        return false;
    }
    try {
        store.removeItem(key);
        return true;
    } catch {
        return false;
    }
}
