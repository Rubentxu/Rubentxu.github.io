// Where the pictures of a drawing are kept: IndexedDB, by id.
//
// # Why this exists
//
// `localStorage` holds a few megabytes for the whole origin. A drawing with a
// handful of photographs does not fit, and the browser answers with a quota
// error that costs the user their drawing. IndexedDB has room for pictures, so
// the stored document names them and this store holds them.
//
// # What it never does
//
// It never throws and never rejects. IndexedDB missing, refusing to open (a
// private window, a sandboxed origin), a transaction that aborts, a quota
// error and a request that never answers all end in the same quiet answer:
// `put` says `false` and `get` says `null`. After the first failure the store is
// inert for the life of the page, because a store that failed once is a store
// the save should stop waiting for — the caller then keeps the pictures in the
// document, which is how it worked before this store existed.
//
// # Nothing waits forever
//
// A request that never answers would leave the save waiting with it, and a save
// that never finishes is a drawing that is never written. Every operation is
// given a deadline; a request that misses it counts as a failure.
//
// # The factory is a parameter
//
// The `indexedDB` object comes in, as the navigator does for the persistence
// request, so a test holds a fake one and the page passes the real one.

/** The database's name: one per application, shared by every tab of the origin. */
export const DATABASE_NAME = "nextdraw.images";

/** The object store's name; a picture is its value and its id is its key. */
export const STORE_NAME = "images";

/** How long an operation may take before it counts as failed, in milliseconds. */
export const DEADLINE_MS = 4000;

/**
 * The browser's `indexedDB`, or `undefined` when reading the property is refused.
 *
 * A sandboxed origin raises on the property access itself, not on the first
 * call, so the read lives inside a guard.
 *
 * @returns {unknown}
 */
export function browserIndexedDB() {
    try {
        return globalThis.indexedDB;
    } catch {
        return undefined;
    }
}

/**
 * @typedef {object} ImageStore
 * @property {(id: string, dataURL: string) => Promise<boolean>} put Keep a picture; whether it stuck.
 * @property {(id: string) => Promise<string | null>} get A picture, or `null` when there is none.
 * @property {() => boolean} usable Whether the store may still be asked: `false` once it has failed
 *   or when there was nothing to open.
 */

/**
 * @param {unknown} factory The `indexedDB` object. Absent means the store does nothing.
 * @param {{ deadline?: number, database?: string }} [options] `database` names the
 *   database, so another keeper of text by key can have a database of its own.
 * @returns {ImageStore}
 */
export function createImageStore(factory, { deadline = DEADLINE_MS, database = DATABASE_NAME } = {}) {
    let failed = factory === undefined || factory === null;
    /** @type {Promise<any> | null} */
    let opening = null;

    /** Race `work` against the deadline, and let the store go inert if it loses or throws. */
    function guarded(work) {
        return new Promise((resolve) => {
            const timer = setTimeout(() => settle(false, null), deadline);
            timer.unref?.();
            let done = false;
            function settle(ok, value) {
                if (done) {
                    return;
                }
                done = true;
                clearTimeout(timer);
                if (!ok) {
                    failed = true;
                }
                resolve({ ok, value });
            }
            try {
                work().then(
                    (value) => settle(true, value),
                    () => settle(false, null),
                );
            } catch {
                settle(false, null);
            }
        });
    }

    function open() {
        if (opening === null) {
            opening = new Promise((resolve, reject) => {
                const request = factory.open(database, 1);
                request.onupgradeneeded = () => {
                    request.result.createObjectStore(STORE_NAME);
                };
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
                request.onblocked = () => reject(new Error("blocked"));
            });
        }
        return opening;
    }

    return {
        usable: () => !failed,

        async put(id, dataURL) {
            if (failed) {
                return false;
            }
            const { ok } = await guarded(async () => {
                const db = await open();
                await new Promise((resolve, reject) => {
                    const transaction = db.transaction(STORE_NAME, "readwrite");
                    transaction.oncomplete = () => resolve(undefined);
                    transaction.onerror = () => reject(transaction.error);
                    transaction.onabort = () => reject(transaction.error);
                    transaction.objectStore(STORE_NAME).put(dataURL, id);
                });
            });
            return ok;
        },

        async get(id) {
            if (failed) {
                return null;
            }
            const { ok, value } = await guarded(async () => {
                const db = await open();
                return new Promise((resolve, reject) => {
                    const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(id);
                    request.onsuccess = () => resolve(request.result);
                    request.onerror = () => reject(request.error);
                });
            });
            return ok && typeof value === "string" ? value : null;
        },
    };
}
