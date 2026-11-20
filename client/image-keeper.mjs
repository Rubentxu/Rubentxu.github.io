// What the page has already put in the image store, and what it still owes.
//
// # Why this exists
//
// A save writes the document with its pictures replaced by their ids
// (`client/image-files.mjs`), and that is only honest if the pictures are in the
// store by then. The keeper is the page's memory of which pictures are there, so
// a save writes the ones that are new and not the whole gallery every time.
//
// # How a picture is remembered
//
// By id and by a fingerprint of its bytes. The id alone would be wrong: a file
// opened from disk may reuse an id for a different picture, and the keeper
// would call the new picture stored. The fingerprint is the length and a 32-bit
// FNV-1a hash of the data URL, which costs one pass over the string and keeps
// no second copy of it.
//
// # What it decides
//
// `plan(text)` answers, without waiting, what a save has to do: the document to
// write when everything is stored, the document to write when nothing can be
// (the full text, which is how it worked before the store), and the pictures
// that are new. `keep(missing)` writes those and says whether all of them
// stuck. The page decides what to do with the answer; the keeper decides
// nothing about timing.
//
// # Opening
//
// `preload(text)` fetches the pictures a stored document names, and
// `hydrate(text)` puts them back synchronously, so the open that follows is the
// same synchronous open it always was. `release()` lets the fetched bytes go.

import { hydrateImages, referencedImageIds, splitImages } from "./image-files.mjs";

/** The length of a data URL and its FNV-1a hash: cheap, and different for different pictures. */
function fingerprint(dataURL) {
    let hash = 0x811c9dc5;
    for (let index = 0; index < dataURL.length; index += 1) {
        hash ^= dataURL.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return `${dataURL.length}:${hash >>> 0}`;
}

/**
 * @typedef {object} Plan
 * @property {string} slim The document with the pictures as ids. Equal to `full` when it has none.
 * @property {Array<[string, string]>} missing The pictures the store does not hold yet.
 */

/**
 * @typedef {object} ImageKeeper
 * @property {() => boolean} active Whether pictures may leave the document at all.
 * @property {(text: string) => Plan} plan What a save of `text` has to write and keep.
 * @property {(missing: Array<[string, string]>) => Promise<boolean>} keep Store the pictures; whether all stuck.
 * @property {(text: string) => Promise<void>} preload Fetch the pictures a stored document names.
 * @property {(text: string) => string} hydrate The document with the fetched pictures back.
 * @property {() => void} release Forget the fetched pictures.
 */

/**
 * @param {import("./image-store.mjs").ImageStore} store
 * @returns {ImageKeeper}
 */
export function createImageKeeper(store) {
    /** @type {Map<string, string>} id -> fingerprint of the picture the store holds. */
    const kept = new Map();
    /** @type {Map<string, string>} The pictures fetched for the open in progress. */
    let fetched = new Map();

    return {
        active: () => store.usable(),

        plan(text) {
            const { text: slim, images } = splitImages(text);
            const missing = [];
            for (const [id, dataURL] of images) {
                if (kept.get(id) !== fingerprint(dataURL)) {
                    missing.push([id, dataURL]);
                }
            }
            return { slim, missing };
        },

        async keep(missing) {
            for (const [id, dataURL] of missing) {
                if (!(await store.put(id, dataURL))) {
                    return false;
                }
                kept.set(id, fingerprint(dataURL));
            }
            return true;
        },

        async preload(text) {
            fetched = new Map();
            if (!store.usable()) {
                return;
            }
            for (const id of referencedImageIds(text)) {
                const dataURL = await store.get(id);
                if (dataURL !== null) {
                    fetched.set(id, dataURL);
                    kept.set(id, fingerprint(dataURL));
                }
            }
        },

        hydrate: (text) => hydrateImages(text, fetched),

        release() {
            fetched = new Map();
        },
    };
}
