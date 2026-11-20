// Autosave: one drawing, one storage key.
//
// # What this is
//
// The drawing that survives the tab. A reload finds it here and opens it, so
// closing the browser does not mean losing the work.
//
// # What it is not
//
// It is not the file the user takes away. `client/document-io.mjs` writes that
// one; the difference is the destination and the lifecycle, not the bytes: both
// crossings carry the kernel's own `toJson`, so what is stored here and what is
// downloaded are the same document.
//
// # Why the bytes are the kernel's
//
// The client has no opinion about the document format, and this file has none
// either: it stores a string it was given and hands the string back. What the
// string means is `Session.fromJson`'s business, and the format itself belongs
// to the kernel — the same kernel that writes the `.excalidraw` envelope the
// file download carries.
//
// Three questions exist about a stored drawing. Two of them live here and
// nowhere else: *is there a stored document?* and *can this one be stored?*
// The third — whether the kernel can open what we stored — is asked through
// `openStoredDocument` below, because the answer is the kernel's and the
// consequence of a "no" belongs next to the bytes it is about.
//
// The store itself, and the two ways it can refuse, live in
// `client/storage.mjs`: the theme keeps something in the same browser's
// storage, and a refusal has to be answered the same way in both places.
//
// # When a write happens
//
// The caller decides, and it asks the kernel's `documentRevision()` to decide:
// the document itself says whether it changed. This file never compares
// versions, depths or counters of its own, because a second copy of "has the
// document changed?" is a second truth about the same document.
//
// # When a write does not happen
//
// A drawing the kernel could not open is kept somewhere else, and the key it
// came from is emptied so the live drawing can be saved again. There is one
// exception: when the store refuses to keep that copy, those bytes exist
// nowhere else, and a write there would destroy them. Nothing is written
// then — and the caller is told, because the drawing on screen is not being
// saved while that is true.
//
// # When the write runs
//
// That is a different question from whether it runs, and it belongs to the
// scheduler at the bottom of this file. Writing a document means serialising
// it, and the serialisation is the part that grows with the drawing: about
// ten milliseconds for a thousand elements and about sixty for five thousand.
// The frame that shows an edit is the frame the user is waiting for, so the
// write is not spent there. The scheduler is what moves it, and it is at the
// bottom of this file because the rule above and the moment the rule is
// consulted are the same concern.

import { readStored, writeStored, clearStored } from "./storage.mjs";
import { keepUnreadable } from "./recovery.mjs";

/**
 * The storage key.
 *
 * The `.v1` suffix is not decoration. A future change to the document shape
 * should write a new key rather than hand an old-format string to `fromJson`,
 * where it would fail on every boot with the user unable to tell why.
 */
export const STORAGE_KEY = "nextdraw.document.v1";

/**
 * Store `document`, reporting whether it stuck.
 *
 * The boolean is not decoration. A full quota or a blocked storage throws, and
 * the caller is in the middle of a paint. Swallowing that silently means the
 * user finds out their drawing is unsaved when they reload and it is gone —
 * so the caller gets to say so once, instead of losing the work quietly.
 */
export function saveDocument(document, storage) {
    return writeStored(STORAGE_KEY, document, storage);
}

/**
 * The stored document text, or `null` when there is none.
 *
 * Text rather than a parsed object, on purpose: the store already holds a
 * string and the only consumer is `Session.fromJson`, which takes one. Parsing
 * here would add a failure mode the caller cannot act on and the kernel can
 * detect on its own.
 *
 * An empty string counts as absent. It is never a real document — an empty
 * scene serialises to a non-empty JSON object — so it is what a store emptied
 * by hand looks like, and `fromJson("")` is an error the user cannot fix.
 */
export function loadDocument(storage) {
    return readStored(STORAGE_KEY, storage);
}

/**
 * Empty the place the live drawing lives.
 *
 * Not decoration: a drawing the kernel could not open is *moved* out of this
 * key rather than copied and left behind, and a key that still holds bytes
 * nobody can open is a key the autosave is not allowed to write.
 *
 * @param {unknown} [storage] A storage to use instead of the browser's.
 * @returns {boolean} Whether the key is empty afterwards.
 */
export function clearDocument(storage) {
    return clearStored(STORAGE_KEY, storage);
}

/**
 * The stored drawing, opened by the kernel — or the bytes that could not be
 * opened, put aside so the next save cannot destroy them.
 *
 * The verdict is the kernel's and the kernel's alone: this file asks the
 * session class it is given to open the text, and a refusal means exactly
 * what it means everywhere else in the client — the bytes are not a drawing
 * this build can show. It does not decide that here, because a rule about the
 * format written twice is a rule that changes once and disagrees quietly.
 *
 * What this file does own is the consequence. A drawing the kernel refused is
 * the user's work and it is still there, so it is kept under the key that
 * holds the drawings waiting to be recovered, and the key the autosave writes
 * is emptied so the live drawing can be saved again.
 *
 * When the store refuses to keep that copy, the bytes stay where they are and
 * the answer says so: the caller then holds the key, because a drawing that
 * exists nowhere else may not be overwritten.
 *
 * @param {{fromJson: (text: string) => unknown}} sessionClass The session class.
 * @param {{storage?: unknown, now?: () => number, prepare?: (text: string) => string}} [options]
 *   `prepare` completes the stored text before it is opened.
 * @returns {{outcome: "empty"|"opened"|"kept"|"held", session: unknown|null, stored: string|null}}
 */
export function openStoredDocument(sessionClass, { storage, now, prepare } = {}) {
    const loaded = loadDocument(storage);
    if (loaded === null) {
        return { outcome: "empty", session: null, stored: null };
    }
    // The text the kernel opens may be completed first (the pictures that live
    // elsewhere are put back), and the same completed text is what is kept when
    // the kernel refuses it, so a recovered file is a file that stands alone.
    const stored = typeof prepare === "function" ? prepare(loaded) : loaded;
    try {
        return { outcome: "opened", session: sessionClass.fromJson(stored), stored };
    } catch (_) {
        const outcome = keepUnreadable(stored, { storage, now });
        if (outcome.kept) {
            // The copy is safe, so the place the live drawing lives can be
            // emptied. If the store refuses to empty it, nothing is lost
            // anyway: the copy is what matters, and the next autosave will
            // write over those bytes as it should.
            clearDocument(storage);
            return { outcome: "kept", session: null, stored };
        }
        return { outcome: "held", session: null, stored };
    }
}

/**
 * Write the document to storage when the document itself has moved.
 *
 * # The rule
 *
 * One question — *has the document changed?* — and the kernel answers it. The
 * answer is `session.documentRevision()`, which counts the document and
 * nothing else. The client does not keep a second opinion: it does not count
 * edits, does not watch the undo stack, and does not compare frame numbers.
 *
 * # Why the two counters it could have used are wrong
 *
 * The undo depth is bounded by the kernel's `HISTORY_DEPTH`, so from the
 * hundred-and-first edit it stops moving and the drawing silently stops being
 * saved. The frame's own revision moves for the selection and the viewport
 * too, so a client that stored on it would serialize the whole drawing on
 * every click — one megabyte of JSON at five thousand elements, for a
 * selection the user did not even change.
 *
 * # What it returns
 *
 * `{ written, failed, revision }`. `written` says the store now holds this
 * document; `failed` says the store refused it, which is a different thing the
 * user needs to be told about; `revision` is the revision that is persisted
 * after the call, so the caller can keep it without asking again.
 *
 * The caller owns the message. This module stores bytes; whether a failed
 * write becomes a red line at the bottom of the screen is the page's business.
 *
 * # When nothing is written
 *
 * A `held` key says the store still holds a drawing the kernel could not open
 * and that nobody has taken a copy of yet. Writing over it would destroy
 * bytes that exist nowhere else, so nothing is written — and nothing is
 * reported as failed either, because the store did not refuse: the write was
 * not made on purpose, and the user is told about that separately.
 *
 * `revision` and `text` are the snapshot the caller took earlier, for a caller that had to wait
 * between looking at the document and writing it: what is written is then what was looked at,
 * and not whatever the document has become since. Without them the document is read now.
 *
 * @param {{ documentRevision: () => number, toJson: () => string }} session
 * @param {{ storage?: unknown, persistedRevision?: number | null, held?: boolean, revision?: number, text?: string }} [options]
 * @returns {{ written: boolean, failed: boolean, revision: number | null }}
 */
export function persistIfChanged(session, options = {}) {
    const { storage = undefined, persistedRevision = null, held = false } = options;
    if (held) {
        return { written: false, failed: false, revision: persistedRevision };
    }
    const revision = options.revision ?? session.documentRevision();
    if (revision === persistedRevision) {
        return { written: false, failed: false, revision: persistedRevision };
    }
    if (!saveDocument(options.text ?? session.toJson(), storage)) {
        return { written: false, failed: true, revision: persistedRevision };
    }
    return { written: true, failed: false, revision };
}

/**
 * When the document is written, on the browser's clock rather than the frame's.
 *
 * # What this is
 *
 * `persistIfChanged` above decides *whether* a write happens: the kernel's
 * revision answers it, and nothing else gets a vote. This decides *when* the
 * write runs, and the two are separate questions because they are paid at
 * separate moments.
 *
 * Writing a document means serialising it, and the serialisation is the part
 * that grows with the drawing. It used to be spent inside the frame that
 * showed the edit — the one frame the user is waiting for — which is what a
 * drawing of five thousand elements made visible: the stroke appeared, and
 * then the page stood still for a moment, long enough to be noticed.
 *
 * So the write leaves the frame. A paint asks for a save and returns; the
 * browser runs the save later, when it has nothing better to do. Two things
 * keep that honest:
 *
 * - **The rule still decides.** The scheduler does not know what a document
 *   is. It knows that something asked for a save, and it asks the rule once
 *   per wake-up. A paint that changed nothing costs one counter read and
 *   writes nothing.
 *
 * - **The last edit is not left waiting.** A page that is closing or being
 *   hidden flushes what it owes before it goes, so the window in which an
 *   edit lives only in memory is the time between the edit and the next idle
 *   moment, not the time until the user closes the tab.
 *
 * # What it is not
 *
 * It is not a debounce that a busy page can starve, and it is not a timer
 * that fires on its own. It never decides to save; it only decides when to
 * ask the rule. A drawing that must not be written — one whose only copy is
 * still in the live key — is still not written, because the rule says so.
 *
 * # The clock is injected
 *
 * The page hands it the browser's idle moment and the tests hand it a
 * function they can call by hand. That is what makes the arrangement
 * decidable without a browser, which is the only place it can be decided
 * cheaply enough to keep.
 *
 * # A gesture in progress
 *
 * `busy()` says whether the user is in the middle of a gesture. While it does,
 * a wake-up saves nothing and does not spend what is owed: the save would
 * serialise the whole drawing for a state that is about to change again.
 * Nothing is scheduled either, so a drag does not poll. The debt waits, and
 * `resume()` — called when the gesture ends — asks for the one save it
 * amounts to. A paint after the gesture asks as usual and finds the same debt.
 * `flush()` ignores `busy()`: a page that is going away saves what it can.
 * A `busy` that throws counts as not busy, because a question that cannot be
 * answered must not hold a write back.
 *
 * @param {{ schedule: (run: () => void) => void, save: (session: unknown) => void, busy?: () => boolean }} options
 * @returns {{ request: (session: unknown) => void, pause: () => void, unpause: () => void, resume: () => void, flush: () => boolean, pending: boolean }}
 */
export function createPersistScheduler({ schedule, save, busy = () => false }) {
    function isBusy() {
        try {
            return Boolean(busy());
        } catch {
            return false;
        }
    }

    // Whether a write may be owed. It is deliberately coarse: the exact
    // question — has the document changed? — belongs to the rule, and a second
    // opinion here would be a second truth about the same document.
    let owed = false;
    // Whether a wake-up is on its way. A paint that changed nothing must not
    // cost a serialisation, and a burst of edits must not cost a write per
    // edit, so the asks share one wake-up.
    let scheduled = false;
    // The session that was on screen when the save was last asked for. The
    // save runs later, so it writes what the user is looking at now.
    let session = null;
    let paused = false;

    function scheduleOwed() {
        if (!owed || scheduled || paused || isBusy()) {
            return;
        }
        scheduled = true;
        schedule(run);
    }

    function run() {
        scheduled = false;
        if (!owed || paused || isBusy()) {
            return false;
        }
        owed = false;
        save(session);
        return true;
    }

    return {
        /**
         * Ask for the document to be saved.
         *
         * Cheap on purpose: this is what a paint calls, and a paint that
         * changed nothing must not cost a serialisation. Many asks before the
         * browser answers share one wake-up, so a burst of edits costs one
         * write and not one write per edit.
         *
         * @param {unknown} current The session on screen.
         */
        request(current) {
            session = current;
            owed = true;
            scheduleOwed();
        },

        /**
         * Hold writes while the user resolves a cross-tab document conflict.
         * Existing wake-ups may still arrive, so `run` checks this state too.
         */
        pause() {
            paused = true;
        },

        /** Release a conflict pause and schedule the latest owed session. */
        unpause() {
            paused = false;
            scheduleOwed();
        },

        /**
         * The gesture ended: ask for the save it held back, if there is one.
         *
         * Cheap and safe to call when nothing is owed, when a wake-up is
         * already on its way or when a gesture is still running.
         */
        resume() {
            scheduleOwed();
        },

        /**
         * Save now, without waiting for the browser's next idle moment.
         *
         * This is what a page that is going away calls. It does not cancel the
         * wake-up that was already on its way: that wake-up arrives later,
         * finds nothing owed and does nothing, which is cheaper than a
         * cancellation the browser may ignore.
         *
         * @returns {boolean} Whether a save was run.
         */
        flush() {
            if (!owed || paused) {
                return false;
            }
            owed = false;
            // The flag is cleared even though a wake-up may still be on its
            // way. A page that is going away may never get another one, so the
            // next ask has to schedule a wake-up of its own rather than trust
            // one that may never come; the wake-up that is already out there
            // arrives, finds nothing owed and does nothing.
            scheduled = false;
            save(session);
            return true;
        },

        /**
         * Whether a save may be owed.
         *
         * @returns {boolean}
         */
        get pending() {
            return owed;
        },
    };
}
