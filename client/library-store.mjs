// The library of pieces a person keeps between sessions.
//
// # Why this exists
//
// A library file is laid on the drawing whole and forgotten. A library the page
// remembers needs somewhere to live that outlasts the tab, and that is a text
// kept by key, the same shape the image store already offers. This module is the
// list on top of it: which pieces there are, adding one, removing one.
//
// # How it is kept
//
// The whole list is one JSON text under one key. A library is a few dozen pieces,
// and one text is written or not written at once, so a write that is cut short
// leaves the old list and not half of a new one. Writes go through a queue: two
// `add` calls in a row both read the list and both write it, and without the
// queue the second would write a list that does not hold the first.
//
// # What it never does
//
// It never throws. A store that cannot be reached answers an empty library and a
// refused `add`; a text that is not a list of pieces is an empty library, not an
// error, because a damaged library must not stop the page from opening.

/** The key the list is kept under. */
export const LIBRARY_KEY = "library";

/**
 * @typedef {object} Piece
 * @property {string} id
 * @property {string} name
 * @property {object[]} elements The elements as the kernel inserts them.
 * @property {number} created Milliseconds since the epoch.
 */

/** A piece as stored, or `null` when the value is not one. */
function asPiece(value) {
    if (
        value === null ||
        typeof value !== "object" ||
        typeof value.id !== "string" ||
        value.id === "" ||
        !Array.isArray(value.elements) ||
        value.elements.length === 0
    ) {
        return null;
    }
    return {
        id: value.id,
        name: typeof value.name === "string" ? value.name : "",
        elements: value.elements,
        ...(value.files !== undefined ? { files: value.files } : {}),
        created: Number.isFinite(value.created) ? value.created : 0,
    };
}

/**
 * The elements as one text that does not depend on the order their keys were written in,
 * which is what tells a piece that is already kept from a different one.
 */
function contentKey(value) {
    if (Array.isArray(value)) {
        return `[${value.map(contentKey).join(",")}]`;
    }
    if (value !== null && typeof value === "object") {
        const keys = Object.keys(value).sort();
        return `{${keys.map((key) => `${JSON.stringify(key)}:${contentKey(value[key])}`).join(",")}}`;
    }
    return JSON.stringify(value) ?? "null";
}

/**
 * @param {import("./image-store.mjs").ImageStore} store A text kept by key.
 * @param {{ now?: () => number, newId?: () => string }} [options]
 */
export function createLibraryStore(store, { now = () => Date.now(), newId = () => crypto.randomUUID() } = {}) {
    /** The tail of the write queue. It never rejects. */
    let queue = Promise.resolve();

    /** @returns {Promise<Piece[]>} */
    async function read() {
        const text = await store.get(LIBRARY_KEY);
        if (text === null) {
            return [];
        }
        try {
            const list = JSON.parse(text);
            return Array.isArray(list) ? list.map(asPiece).filter((piece) => piece !== null) : [];
        } catch {
            return [];
        }
    }

    /** Run `change` on the list after every earlier change, and write what it answers. */
    function enqueue(change) {
        const run = queue.then(async () => {
            try {
                const before = await read();
                const outcome = change(before);
                if (outcome === null) {
                    return { ok: false, value: null };
                }
                const ok = await store.put(LIBRARY_KEY, JSON.stringify(outcome.list));
                return { ok, value: ok ? outcome.value : null };
            } catch {
                return { ok: false, value: null };
            }
        });
        queue = run.then(() => undefined);
        return run;
    }

    return {
        usable: () => store.usable(),

        /** The pieces, oldest first. */
        async load() {
            try {
                return await queue.then(read);
            } catch {
                return [];
            }
        },

        /**
         * Keep a piece. Answers it, or `null` when there is nothing to keep or it
         * could not be written.
         * @returns {Promise<Piece | null>}
         */
        async add(name, elements, files) {
            const piece = asPiece({ id: newId(), name, elements, files, created: now() });
            if (piece === null) {
                return null;
            }
            const { value } = await enqueue((list) => ({ list: [...list, piece], value: piece }));
            return value;
        },

        /**
         * Keep several pieces in one write, leaving out the ones the library already holds.
         *
         * A piece is already held when its elements and image files are the same, whatever its name or
         * id: importing the file the library was exported to must not double it. The same
         * rule applies among the pieces handed in. Answers how many were kept and how many
         * were left out, or `null` when the write failed.
         *
         * @param {Array<{ name?: string, elements: object[] }>} pieces
         * @returns {Promise<{ added: number, skipped: number } | null>}
         */
        async addMany(pieces) {
            let tally = null;
            const { ok } = await enqueue((list) => {
                const seen = new Set(list.map((piece) => contentKey([piece.elements, piece.files ?? {}])));
                const fresh = [];
                let skipped = 0;
                for (const candidate of pieces) {
                    const piece = asPiece({ id: newId(), name: candidate?.name, elements: candidate?.elements, files: candidate?.files, created: now() });
                    const key = piece === null ? null : contentKey([piece.elements, piece.files ?? {}]);
                    if (piece === null || seen.has(key)) {
                        skipped += 1;
                        continue;
                    }
                    seen.add(key);
                    fresh.push(piece);
                }
                tally = { added: fresh.length, skipped };
                // Nothing new is not a failure and needs no write.
                return fresh.length === 0 ? null : { list: [...list, ...fresh], value: tally };
            });
            if (tally === null || (tally.added > 0 && !ok)) {
                return null;
            }
            return tally;
        },

        /**
         * Drop a piece. Answers whether it was there and the list was written.
         * @returns {Promise<boolean>}
         */
        async remove(id) {
            const { value } = await enqueue((list) => {
                const rest = list.filter((piece) => piece.id !== id);
                return rest.length === list.length ? null : { list: rest, value: true };
            });
            return value === true;
        },
    };
}
