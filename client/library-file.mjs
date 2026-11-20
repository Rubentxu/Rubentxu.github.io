// The library file: the pieces of the store, and the `.excalidrawlib` text that carries them.
//
// # What this file is
//
// Two pure functions. One reads the reference's library file into pieces the store can
// keep; the other writes the pieces back as a library file. Neither touches the page,
// the store or the kernel, and neither throws: a file that cannot be read is an answer
// with a reason, because the person who chose it is the one who has to be told.
//
// # What it checks, and what it leaves to the kernel
//
// Only the envelope and the shape of each piece: the type word, a version this build
// knows, the list of pieces, and that each piece is a non-empty list of elements that
// are objects with a `type`. The elements themselves are not judged here. They are
// hardened by the kernel at the moment a piece is laid on the drawing, which is the one
// door every library piece goes through, so a second reading of their fields in
// JavaScript would be a second rule about elements.
//
// # The two spellings
//
// The first version of the file keeps its pieces under `library`, each one a bare list
// of elements. The second keeps them under `libraryItems`, each one an object with
// `elements` and usually a `name`. Both are read, the newer name first, and a bare list
// is accepted under either name because the reference's own reader accepts it. Files are
// always written in the second version.

/** The word the envelope's `type` carries. */
export const LIBRARY_TYPE = "excalidrawlib";

/** The versions of the file this build reads. A file that names another is refused. */
export const READABLE_VERSIONS = Object.freeze([1, 2]);

/** The version this build writes. */
export const WRITTEN_VERSION = 2;

/** The name a downloaded library is given. */
export const LIBRARY_FILE_NAME = "nextdraw.excalidrawlib";

/**
 * @typedef {object} ReadPiece
 * @property {string} name
 * @property {object[]} elements
 */

/**
 * @typedef {{ ok: true, pieces: ReadPiece[], skipped: number } | { ok: false, reason: "invalid" | "version" | "empty" }} Reading
 */

const refuse = (reason) => ({ ok: false, reason });

const isElement = (value) => value !== null && typeof value === "object" && !Array.isArray(value) && typeof value.type === "string";

/**
 * Read a library file.
 *
 * `invalid` is a text that is not JSON, not a library, or whose pieces are not where
 * they live; `version` is a library of a version this build does not know; `empty` is a
 * library none of whose pieces can be kept. A piece that cannot be kept while others
 * can is counted in `skipped` and does not stop the rest.
 *
 * @param {string} text
 * @returns {Reading}
 */
export function readLibraryFile(text) {
    let file;
    try {
        file = JSON.parse(text);
    } catch {
        return refuse("invalid");
    }
    if (file === null || typeof file !== "object" || Array.isArray(file) || file.type !== LIBRARY_TYPE) {
        return refuse("invalid");
    }
    // A file with no version at all is read, as the kernel reads it; one that names a
    // version this build does not know is not, because its pieces may mean something else.
    if (file.version !== undefined && !READABLE_VERSIONS.includes(file.version)) {
        return refuse("version");
    }
    const items = file.libraryItems ?? file.library;
    if (!Array.isArray(items)) {
        return refuse("invalid");
    }
    /** @type {ReadPiece[]} */
    const pieces = [];
    for (const item of items) {
        const elements = Array.isArray(item) ? item : item?.elements;
        if (!Array.isArray(elements) || elements.length === 0 || !elements.every(isElement)) {
            continue;
        }
        pieces.push({
            name: !Array.isArray(item) && typeof item.name === "string" ? item.name : "",
            elements,
            ...(!Array.isArray(item) && item.files !== undefined ? { files: item.files } : {}),
        });
    }
    if (pieces.length === 0) {
        return refuse("empty");
    }
    return { ok: true, pieces, skipped: items.length - pieces.length };
}

/**
 * The text of a library file for the pieces of the store.
 *
 * @param {Array<{ id: string, name: string, elements: object[], created: number }>} pieces
 * @returns {string}
 */
export function writeLibraryFile(pieces) {
    return JSON.stringify(
        {
            type: LIBRARY_TYPE,
            version: WRITTEN_VERSION,
            source: "nextdraw",
            libraryItems: pieces.map((piece) => ({
                id: piece.id,
                status: "unpublished",
                created: piece.created,
                name: piece.name,
                elements: piece.elements,
                ...(piece.files && Object.keys(piece.files).length > 0 ? { files: piece.files } : {}),
            })),
        },
        null,
        2,
    );
}
