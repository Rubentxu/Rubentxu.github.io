// The drawings we could not open, and the way the user gets them back.
//
// # What this is
//
// A drawing the kernel refuses is not nothing. It is bytes somebody wrote, and
// they are very often a perfectly good drawing that *this build* cannot read:
// a document from a newer version, or one whose save was cut in half by a
// closed tab. The only thing wrong with them is that this application cannot
// show them.
//
// So they are kept, under their own key, and the user can take them away as a
// file. The place they were living — the key the autosave writes — is freed as
// soon as the copy is safe, because a live drawing that can never be replaced
// is a live drawing that is never saved.
//
// # Why a queue and not a single slot
//
// Two unreadable drawings can exist: one from a crash yesterday and one from a
// crash today. A single slot would make the second destroy the first, and the
// whole point of this module is that nothing here is destroyed. The queue is a
// list, oldest first, and the user takes them out one at a time.
//
// # What this module does not do
//
// It does not decide what a drawing is, and it does not decide whether a
// drawing is readable. The kernel answers the second question and only the
// kernel can: this module is told the bytes that could not be opened, and its
// only job is to keep them and hand them back.
//
// It does not touch the live key either. The key the autosave writes belongs to
// `client/persist.mjs`, and the moving of the bytes from one key to the other
// is done by whoever owns both — see `openStoredDocument` there.
//
// # The two places a drawing can wait
//
// A drawing that could not be opened ends up in one of two places, and the
// difference between them is not a detail:
//
// - The queue. The bytes were copied there and the place the live drawing
//   lives was emptied, so the drawing on screen is saved as usual and the old
//   drawing waits to be taken away as a file.
// - The place the live drawing lives. The bytes stayed there because the copy
//   could not be made — either the store refused to take it, or the queue
//   itself holds bytes this version cannot make sense of and must not write
//   over. Those bytes exist nowhere else, so the drawing on screen is not
//   saved until the user has taken the old one away.
//
// So the offer below answers two questions — is there something to take away,
// and must the autosave stand still — and the page must not answer either of
// them in two places of its own. The second one decides whether the drawing
// on screen is being saved at all, and two answers to that question are two
// truths about the same drawing.
//
// # Why nothing is thrown away on the word of a download
//
// A file the browser was asked to download is not proof that the user has it.
// The browser may refuse the download, the user may dismiss the dialog that
// asks where to put it, and the application hears about none of it. So the
// bytes are only forgotten when the handoff says they are on the disk, and a
// handoff that says nothing else leaves them where they are.
//
// The other half of that rule is that the bytes are never *lost* by the
// refusal either: they move to the queue, which is a place of their own, so
// the drawing on screen can be saved again while the file is still waiting to
// be taken away. The queue is the first home of these bytes and the disk is
// the second.

import { clearStored, readStored, writeStored } from "./storage.mjs";

/**
 * The key the drawings we could not open live under.
 *
 * A version of its own, like the document's. The queue is a different shape
 * from the document, and a change to either one must not be handed to the
 * other as if it were the same thing.
 */
export const RECOVERY_KEY = "nextdraw.recovery.v1";

/**
 * Whether a queue entry is one this application can read.
 *
 * An entry is a drawing's bytes and the moment they were queued. A list that
 * holds anything else is a list this application cannot make sense of, and a
 * list it cannot make sense of is a list whose bytes must not be written over:
 * the part it cannot read may be somebody's drawing.
 *
 * @param {unknown} entry One entry of the list.
 * @returns {boolean}
 */
function isEntry(entry) {
    return (
        entry !== null &&
        typeof entry === "object" &&
        typeof entry.text === "string" &&
        typeof entry.at === "number" &&
        Number.isFinite(entry.at)
    );
}

/**
 * The queue, and whether it could be read at all.
 *
 * The second half of the answer matters as much as the first. A queue that is
 * not a list is not empty: it is bytes this application cannot make sense of,
 * and writing over it would destroy them — the very thing this module exists
 * to prevent.
 *
 * A list is read whole or not at all. One entry this application cannot
 * understand makes the whole list a list it cannot understand, because the
 * only way to write the list back is to write it without that entry, and that
 * would throw the entry away.
 *
 * @param {unknown} [storage] A storage to use instead of the browser's.
 * @returns {{entries: {at: number, text: string}[], readable: boolean}}
 */
function readQueue(storage) {
    const raw = readStored(RECOVERY_KEY, storage);
    if (raw === null) {
        return { entries: [], readable: true };
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (_) {
        return { entries: [], readable: false };
    }
    if (!Array.isArray(parsed)) {
        return { entries: [], readable: false };
    }
    if (!parsed.every(isEntry)) {
        return { entries: [], readable: false };
    }
    return { entries: parsed, readable: true };
}

/**
 * The drawings waiting to be recovered, oldest first.
 *
 * An empty list means there is nothing to recover. A queue that could not be
 * read also reads as an empty list — the user is not shown drawings that
 * cannot be produced — but it is not the same thing, and only the keeper of the
 * queue knows which one it was.
 *
 * @param {unknown} [storage] A storage to use instead of the browser's.
 * @returns {{at: number, text: string}[]}
 */
export function pendingRecoveries(storage) {
    return readQueue(storage).entries;
}

/**
 * Whether the queue of drawings waiting to be recovered could be read.
 *
 * The answer is false when there are bytes under the key that this version
 * does not understand. Those bytes are kept and are not deleted, but they
 * cannot be handed out either, and a user who is not told cannot tell the
 * difference between "there is nothing to recover" and "there is something I
 * cannot reach".
 *
 * @param {unknown} [storage] A storage to use instead of the browser's.
 * @returns {boolean}
 */
export function recoveryQueueReadable(storage) {
    return readQueue(storage).readable;
}

/**
 * Keep the bytes of a drawing that could not be opened.
 *
 * The same bytes are kept once, not twice. A drawing that is kept and then
 * found again — because the place it came from could not be emptied, or
 * because the page was reloaded before anything moved — is one drawing with
 * one copy, not two the user has to take out twice.
 *
 * The answer says whether the bytes are safe now. It is not always yes: a
 * store that refuses to be written to refuses this too, and then the caller
 * has to know that the only copy is still where it was.
 *
 * @param {string} text The bytes that could not be opened.
 * @param {{storage?: unknown, now?: () => number}} [options]
 * @returns {{kept: boolean}} Whether the bytes are safe now.
 */
export function keepUnreadable(text, { storage, now = Date.now } = {}) {
    const queue = readQueue(storage);
    if (!queue.readable) {
        return { kept: false };
    }
    if (queue.entries.some((entry) => entry.text === text)) {
        return { kept: true };
    }
    const entries = [...queue.entries, { at: now(), text }];
    return { kept: writeStored(RECOVERY_KEY, JSON.stringify(entries), storage) };
}

/**
 * The oldest drawing is gone: the user has it in a file.
 *
 * Nothing is removed before the user has it. The queue only loses a drawing
 * when the application is told the drawing was taken, because the queue is
 * the last place the bytes exist and a browser that blocks a download would
 * otherwise take them away for good.
 *
 * @param {unknown} [storage] A storage to use instead of the browser's.
 * @returns {{at: number, text: string} | null} The drawing that was removed.
 */
export function forgetOldestRecovery(storage) {
    const queue = readQueue(storage);
    if (!queue.readable || queue.entries.length === 0) {
        return null;
    }
    const [oldest, ...rest] = queue.entries;
    const stored =
        rest.length === 0
            ? clearStored(RECOVERY_KEY, storage)
            : writeStored(RECOVERY_KEY, JSON.stringify(rest), storage);
    return stored ? oldest : null;
}

/**
 * What the handoff answered, read in the way that cannot be wrong.
 *
 * Anything that is not an answer saying "the bytes are on the disk" is read
 * as "they are not". A handoff that answers with something unexpected, or
 * that says nothing at all, must not be read as a confirmation: the whole
 * point of asking is that the safe answer is the one that keeps the bytes.
 *
 * @param {unknown} answer What the handoff answered.
 * @returns {{confirmed: boolean, offered: boolean}}
 */
function readAnswer(answer) {
    return {
        confirmed: answer?.confirmed === true,
        offered: answer?.offered === true,
    };
}

/**
 * The offer the page makes to the user, and the answer it gives the autosave.
 *
 * The drawing that could not be opened is handed over as a file, and nothing
 * is removed before the user has that file. The file is written by the
 * application when the browser lets it, and the write is what says the bytes
 * are on the disk; a download that was merely started says nothing, and
 * nothing is removed on its word.
 *
 * The live one comes first, because it is the one holding the autosave: while
 * those bytes are the only copy, the drawing on screen is not saved.
 *
 * The download and the emptying of the live key are handed in rather than
 * reached for, because the file that owns the live key is not this file, and
 * the file that writes files to the disk is not this file either.
 *
 * @param {{
 *   storage?: unknown,
 *   download: (text: string) => Promise<{confirmed?: boolean, offered?: boolean}>,
 *   clearLive: () => boolean,
 * }} parts
 * @returns {object} The offer.
 */
export function createRecoveryOffer({ storage, download, clearLive }) {
    // The bytes still in the place the live drawing lives, if the copy could
    // not be made. At most one: there is one live key, and the autosave would
    // destroy whatever is in it.
    let held = null;

    return {
        /**
         * Note that a drawing that could not be opened is still in the live key.
         *
         * @param {string} text The bytes.
         */
        hold(text) {
            held = text;
        },

        /**
         * Whether the autosave has to stand still.
         *
         * @returns {boolean}
         */
        get held() {
            return held !== null;
        },

        /**
         * Whether the user has a drawing to take away.
         *
         * @returns {boolean}
         */
        waiting() {
            return held !== null || pendingRecoveries(storage).length > 0;
        },

        /**
         * Hand the oldest drawing to the user as a file.
         *
         * The answer says what is known afterwards:
         *
         * - `offered` — the browser was asked to take the bytes.
         * - `confirmed` — the bytes are on the disk.
         * - `released` — this application does not hold the only copy any more,
         *   so the drawing on screen may be saved again.
         * - `remaining` — how many drawings are still waiting.
         *
         * @returns {Promise<{offered: boolean, confirmed: boolean, released: boolean, remaining: number}>}
         */
        async take() {
            if (held !== null) {
                const answer = readAnswer(await download(held));
                if (answer.confirmed) {
                    // The bytes are in a file the user chose, so they exist
                    // somewhere outside this application and this one is no
                    // longer the only place they live. The place they were
                    // living is emptied on a best-effort basis, and the
                    // autosave resumes either way: what would be left there
                    // is a copy of a file the user already has.
                    clearLive();
                    held = null;
                    return {
                        offered: true,
                        confirmed: true,
                        released: true,
                        remaining: pendingRecoveries(storage).length,
                    };
                }
                // The file was not confirmed on the disk, so the bytes cannot
                // be thrown away. They are offered to the place they belong
                // before the offer is called a failure: when the queue takes
                // them, the live key can be written again and the autosave
                // resumes, and the file is then a copy for the user rather than
                // the only way out of here.
                const moved = keepUnreadable(held, { storage });
                if (moved.kept) {
                    // The bytes live in the queue now, so the live key no
                    // longer holds the only copy of them. The queue entry
                    // stays there to be taken away as a file whenever the user
                    // wants it, and the drawing on screen may be saved again.
                    clearLive();
                    held = null;
                }
                return {
                    offered: answer.offered,
                    confirmed: false,
                    released: moved.kept,
                    remaining: pendingRecoveries(storage).length,
                };
            }
            const queued = pendingRecoveries(storage);
            if (queued.length === 0) {
                return { offered: false, confirmed: false, released: false, remaining: 0 };
            }
            const answer = readAnswer(await download(queued[0].text));
            if (!answer.confirmed) {
                // The queue is the last place these bytes exist, and a file
                // that was merely offered is not proof that they arrived.
                return {
                    offered: answer.offered,
                    confirmed: false,
                    released: false,
                    remaining: queued.length,
                };
            }
            const removed = forgetOldestRecovery(storage);
            return {
                offered: true,
                confirmed: true,
                released: removed !== null,
                remaining: pendingRecoveries(storage).length,
            };
        },
    };
}
