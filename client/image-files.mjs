// The pictures of a document, taken out of its text and put back.
//
// # Why this exists
//
// The document the kernel writes carries every picture inside its `files`
// table, as a data URL. A few photographs are enough to pass the quota of
// `localStorage`, and a drawing that cannot be stored is a drawing that is lost
// on reload. The pictures are kept somewhere with room (`client/image-store.mjs`)
// and the stored document names them by id only.
//
// # What it does, and what it leaves alone
//
// These are functions over text. They know the one corner of the envelope that
// matters here — `files[id].dataURL` — and nothing else about the format: the
// kernel is the one that reads and validates a document, and a document that
// has lost a picture's bytes is a document it already knows how to open, since
// a table entry without bytes is left alone by the reader.
//
// A document that does not mention a data URL is returned as the very same
// string, so a drawing without pictures pays one substring search and no parse.
// A text that is not an envelope is returned as it came: the kernel will say
// what is wrong with it, and this file is not the place that decides.

/** @typedef {Map<string, string>} Images The data URLs by the id of their `files` entry. */

/** The envelope parsed, when it has a `files` table and the text mentions `needle`. */
function parseFiles(text, needle) {
    if (typeof text !== "string" || !text.includes(needle)) {
        return null;
    }
    let document;
    try {
        document = JSON.parse(text);
    } catch {
        return null;
    }
    const files = document?.files;
    if (files === null || typeof files !== "object" || Array.isArray(files)) {
        return null;
    }
    return { document, files };
}

/** Whether a `files` entry is an object that holds its picture. */
function holdsPicture(entry) {
    return entry !== null && typeof entry === "object" && typeof entry.dataURL === "string";
}

/**
 * The document without its pictures, and the pictures.
 *
 * Every `files` entry that holds a data URL loses it; the entry itself stays,
 * with the rest of what it says, so the element that points at it still finds
 * its address.
 *
 * @param {string} text The document as the kernel wrote it.
 * @returns {{ text: string, images: Images }}
 */
export function splitImages(text) {
    const parsed = parseFiles(text, '"dataURL"');
    const images = new Map();
    if (parsed === null) {
        return { text, images };
    }
    for (const [id, entry] of Object.entries(parsed.files)) {
        if (holdsPicture(entry)) {
            images.set(id, entry.dataURL);
            delete entry.dataURL;
        }
    }
    if (images.size === 0) {
        return { text, images };
    }
    return { text: JSON.stringify(parsed.document), images };
}

/**
 * The ids of the `files` entries that name a picture without holding it.
 *
 * These are the pictures a stored document is waiting for.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function referencedImageIds(text) {
    const parsed = parseFiles(text, '"files"');
    if (parsed === null) {
        return [];
    }
    return Object.entries(parsed.files)
        .filter(([, entry]) => entry !== null && typeof entry === "object" && !holdsPicture(entry))
        .map(([id]) => id);
}

/**
 * The document with its pictures back.
 *
 * Only an entry that holds no picture is filled, and only from an id that is in
 * `images`. An entry that already holds its picture — a document saved before
 * the pictures moved out — is left exactly as it is, and an id nobody has a
 * picture for stays without one.
 *
 * @param {string} text
 * @param {Images} images
 * @returns {string}
 */
export function hydrateImages(text, images) {
    if (images.size === 0) {
        return text;
    }
    const parsed = parseFiles(text, '"files"');
    if (parsed === null) {
        return text;
    }
    let filled = false;
    for (const [id, entry] of Object.entries(parsed.files)) {
        if (entry !== null && typeof entry === "object" && !holdsPicture(entry) && images.has(id)) {
            entry.dataURL = images.get(id);
            filled = true;
        }
    }
    return filled ? JSON.stringify(parsed.document) : text;
}
