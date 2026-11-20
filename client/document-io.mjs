// The drawing as a file: opening one and saving one.
//
// # What this module is
//
// The two directions of the same crossing — bytes on disk into a live session, and a
// live session out to bytes on disk — for the `.excalidraw` envelope upstream writes.
//
// # What it is not
//
// It does not know what a document is. The kernel does: `Session.loadJsonWithReport`
// parses and validates, and tells what it had to do to open the file;
// `Session.toJson` writes the envelope. Everything here is the browser's half of
// that — the file picker, the Blob, the anchor, and the sentence the user reads.
//
// # Why the validity rule is not repeated here
//
// Upstream checks the file in the browser before it restores anything
// (`isValidExcalidrawData`, `packages/excalidraw/data/json.ts`). That rule is about
// the *format*, and the format is the kernel's. A second copy of it on this side
// would be a second truth about the same bytes, and the two would disagree the first
// time the format changed — and they would disagree quietly, because a file that one
// side accepts and the other rejects still opens, just with different contents. So
// the text goes to the kernel and the kernel's verdict is what gets reported.
//
// # Why the save is not the autosave
//
// `client/persist.mjs` stores the drawing in `localStorage` under our own key; this
// is the file the user takes away. They are different destinations with different
// lifecycles, and one of them survives the tab and the other does not.

import { downloadText } from "./export.mjs";
import { extractPngScene } from "./png-scene.mjs";
import { handOverText } from "./handoff.mjs";

/**
 * What an `.excalidraw` download declares itself as.
 *
 * Upstream's `MIME_TYPES.excalidraw` (`packages/common/src/constants.ts`). The same
 * string, because the file has to open in Excalidraw as well as in NextDraw, and the
 * type is what the operating system's file manager reads to decide that.
 */
export const EXCALIDRAW_MIME = "application/vnd.excalidraw+json";

/**
 * The filename an `.excalidraw` download is offered under.
 *
 * Not a per-document name: the document does not know its own name — upstream keeps
 * that in the browser, not in the file — and inventing one here would be a claim the
 * kernel cannot make. A user who wants a name renames the file after the download,
 * which is what every other drawing application makes them do.
 */
export const EXCALIDRAW_NAME = "nextdraw.excalidraw";

/**
 * The document text the session would save.
 *
 * The kernel's `toJson`, unwrapped. Split out so a test can assert that what is
 * written is exactly what the kernel said, with no client-side reformatting in
 * between: a client that pretty-printed the JSON would still round-trip, but it
 * would no longer be writing the file the kernel describes.
 */
export function documentTextFor(session) {
    return session.toJson();
}

/**
 * Offer the session's document as a download.
 *
 * The failure this can have is the kernel's — a document that cannot be serialised —
 * and it is raised, not swallowed: a download that produces nothing is worse than
 * one that says why it did not happen.
 */
export function saveDocumentFile(
    session,
    {
        name = EXCALIDRAW_NAME,
        doc = globalThis.document,
        url = globalThis.URL,
        mark = null,
    } = {},
) {
    const text = documentTextFor(session);
    const offered = downloadText(text, name, doc, url, EXCALIDRAW_MIME);
    // Only after the download was offered: a save that threw has put nothing in a file.
    mark?.markSaved(session);
    return offered;
}

/**
 * Read a picked file and hand its text to the kernel.
 *
 * The kernel replaces the session's document only if the text parses; a file that
 * does not open leaves the drawing on screen untouched, which is the whole point of
 * asking the kernel rather than checking the bytes here. The error is raised for the
 * caller to report, because the caller is the only one who can tell the user.
 *
 * `file.text()` decodes as UTF-8, which is what an `.excalidraw` file is: JSON, in
 * UTF-8. A file that is not — a picture renamed to `.excalidraw` — decodes into
 * nonsense, and the kernel refuses it.
 *
 * The size of the file is asked about before any of that: a file that is too long
 * to be a document is refused by the kernel's fence while it is still a file, and
 * the browser never has to hold its text. The refusal is raised like any other,
 * because the caller is the only one who can tell the user.
 *
 * The kernel's answer comes back with the file's text: the report says what the
 * reader had to do to open the document, and the caller decides what to tell the
 * user about it. See [`describeOpen`].
 */
export async function openDocumentFile(
    file,
    session,
    insertLibrary = null,
    confirmReplace = null,
) {
    // The size of a file is known before its text is read: the browser asks the
    // file system, not the file. The fence that says how long a document may be
    // is the kernel's, and the kernel is the one that applies it — so the size is
    // measured here and the answer is asked for here. A file that is too long is
    // refused while it is still a file: nothing has to carry its bytes, and the
    // user hears the reason before the browser runs out of memory.
    //
    // The kernel applies the same fence to the text it parses, so a document that
    // arrived by another road — the clipboard, the library — is still caught.
    session.checkDocumentBytes(file.size);
    const isPng = file.type === "image/png" || file.name?.toLowerCase().endsWith(".png");
    const text = isPng
        ? await extractPngScene(file, { checkDocumentBytes: (bytes) => session.checkDocumentBytes(bytes) })
        : await file.text();
    if (isPng && text === null) {
        throw new Error("PNG file does not contain an embedded Excalidraw scene");
    }
    // A library file is not a drawing, and loading it as one would replace the
    // user's drawing with an envelope their drawing cannot be. The type word
    // the envelope carries is what tells the two apart — one JSON read, the
    // client's own, because which door a file takes is the client's question
    // and the pieces' reading is the kernel's.
    let envelope = null;
    try {
        envelope = JSON.parse(text);
    } catch {
        envelope = null;
    }
    if (envelope && envelope.type === "excalidrawlib") {
        if (insertLibrary === null) {
            return { text, report: null, library: true };
        }
        const pieces = await insertLibrary(envelope);
        return { text, report: null, library: true, pieces };
    }
    // Opening replaces the drawing and empties its history, so this is the last
    // moment the person can say no. It is asked here, after the library branch and
    // before the kernel loads, because only a drawing file replaces anything and the
    // answer must come before the replacement, not after it.
    if (confirmReplace !== null && !(await confirmReplace())) {
        return { text, report: null, cancelled: true };
    }
    const report = loadWithReport(session, text);
    return { text, report };
}

/**
 * Remembers which state of the drawing is in a file, to tell whether opening another
 * one would lose work.
 *
 * "In a file" means saved to disk or read from one: the autosave in browser storage does
 * not count, because it is the copy that opening is about to overwrite. The state is the
 * kernel's `documentRevision()`, so an edit that is later undone back to the saved shape
 * still counts as a change, and an empty drawing never asks: there is nothing to lose.
 *
 * @returns {{markSaved: (session: unknown) => void, isUnsaved: (session: unknown) => boolean}}
 */
export function createSavedMark() {
    let saved = null;
    return {
        markSaved(session) {
            saved = session.documentRevision();
        },
        isUnsaved(session) {
            return !session.isEmpty() && session.documentRevision() !== saved;
        },
    };
}

/**
 * Hand the text to the kernel and read back the account of the open.
 *
 * The account is the kernel's: it is the one that read the elements and the one that
 * knows which of them it had to repair, to carry or to leave out. The client does not
 * count elements or look at the document to find out what happened — a second opinion
 * about the same bytes is a second truth, and the two would disagree quietly.
 *
 * `null` when the account could not be read. The document is open by then, and a
 * document that opened must not be reported as one that did not: the user would be
 * told their file did not open while their drawing had already changed under them.
 */
function loadWithReport(session, text) {
    const raw = session.loadJsonWithReport(text);
    if (typeof raw !== "string") {
        return null;
    }
    try {
        return JSON.parse(raw);
    } catch (_) {
        return null;
    }
}

/**
 * Say what the reader had to do, in one sentence, or say nothing.
 *
 * `null` when the document opened exactly as it was written, because a notice about
 * every file that opens is a notice nobody reads. Otherwise the sentence names the
 * three things that can have happened, in the order that matters to the user: what
 * was repaired, what was kept but not drawn, and what was left out.
 *
 * The words are this side's. The account is the kernel's; the sentence is the
 * browser's, because the browser is what the user is looking at.
 */
export function describeOpen(report, plural = null) {
    if (!report || !Array.isArray(report.outcomes) || report.outcomes.length === 0) {
        return null;
    }
    const counts = { repaired: 0, carried: 0, dropped: 0 };
    for (const outcome of report.outcomes) {
        if (outcome?.outcome === "repaired") {
            counts.repaired += 1;
        } else if (outcome?.outcome === "carried") {
            counts.carried += 1;
        } else if (outcome?.outcome === "dropped") {
            counts.dropped += 1;
        }
    }
    // The sentence is counted, so it is the locale's plural rule that says
    // which form it takes; without a rule (the source language) the English
    // forms below are the sentence, and they already agree with the count.
    const counted = (key, count, sources) =>
        plural === null
            ? sources[count === 1 ? "one" : "other"].replace("{count}", String(count))
            : plural(key, count, sources);
    const parts = [];
    if (counts.repaired > 0) {
        parts.push(counted("open.repaired", counts.repaired, {
            one: "{count} element repaired",
            other: "{count} elements repaired",
        }));
    }
    if (counts.carried > 0) {
        parts.push(counted("open.carried", counts.carried, {
            one: "{count} element kept but not drawn",
            other: "{count} elements kept but not drawn",
        }));
    }
    if (counts.dropped > 0) {
        parts.push(counted("open.dropped", counts.dropped, {
            one: "{count} element left out",
            other: "{count} elements left out",
        }));
    }
    if (parts.length === 0) {
        return null;
    }
    return `${parts.join(", ")}.`;
}

/**
 * The filename a drawing we could not open is offered under.
 *
 * Not the document's own name: nobody knows what that drawing was called,
 * because nobody could open it. The name says where it came from, and it is
 * not the document's own download name, so a file the user recovered is never
 * mistaken for the drawing on the screen.
 */
export const RECOVERED_NAME = "nextdraw-recovered.excalidraw";

/**
 * Hand a drawing we could not open to the user as a file.
 *
 * The bytes are handed over as they are. Nobody re-serialises them and nobody
 * asks the kernel to read them: the kernel already said it cannot, and a
 * round trip through it would only lose what it does not model. The user gets
 * the same text that was in the browser's storage, which is what they need to
 * take the drawing somewhere that can open it.
 *
 * The answer says whether the file is on the disk, because the caller has to
 * know that before it lets go of the copy it still holds. The name is not the
 * document's own name — nobody knows what that drawing was called — and it is
 * not the document's download name either, so a recovered file is never
 * mistaken for the drawing on the screen.
 *
 * @param {string} text The bytes of the drawing.
 * @param {{name?: string, picker?: unknown, doc?: unknown, url?: unknown}} [options]
 * @returns {Promise<{confirmed: boolean, offered: boolean}>}
 */
export async function handOverRecoveredDocument(
    text,
    { name = RECOVERED_NAME, picker, doc = globalThis.document, url = globalThis.URL } = {},
) {
    return handOverText(text, name, {
        mime: EXCALIDRAW_MIME,
        description: "Excalidraw drawing",
        doc,
        url,
        picker,
    });
}
