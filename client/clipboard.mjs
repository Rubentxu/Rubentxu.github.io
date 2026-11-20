// The system clipboard: the two directions of the same crossing.
//
// # What this module is
//
// Copying here writes to the operating system's clipboard, and pasting reads
// from it. The payload is the one the kernel produced, in the shape the family
// of applications this one belongs to writes, so what another application left
// in the clipboard is what this one puts on the canvas.
//
// # What it is not
//
// It does not know what a drawing is. The kernel does: the text on the wire is
// opaque here, and the kernel reads it back into elements or into a body of
// text. What is left in this module is the browser's half of the crossing and
// nothing else — write a text, read a text.
//
// # Why the refusal is quiet
//
// The system clipboard is reachable only when the page is focused and the
// browser allows it, and neither is under the application's control at the
// moment the user presses the key. A refusal therefore says "the system
// clipboard could not be reached", not "something went wrong": the
// application still holds the same payload in its own clipboard, and that is
// what a paste falls back to.
//
// # Why the write happens where it does
//
// A write to the clipboard is only allowed while the page has the user's
// attention, and the attention is given by the key press itself. So the write
// is made in the same turn as the press that asked for it, before anything
// else has had a chance to spend it.

/**
 * The clipboard of the system, or nothing when the browser has none.
 *
 * `null` rather than a throw: a browser without the interface is a browser
 * where the application simply keeps its own clipboard.
 */
export function systemClipboard(nav = globalThis.navigator) {
    return nav?.clipboard ?? null;
}

/**
 * Put a text in the system clipboard.
 *
 * Whether it worked is said by the answer, and nothing is thrown: a copy that
 * could not be shared is still a copy, and the application holds it either
 * way. The caller does not need to do anything about it, and a copy that is
 * shared later — at the next copy, at the next cut — starts working again on
 * its own.
 *
 * The write is started and not awaited by the caller: the attention the
 * browser asks for belongs to the key press that is still being handled.
 *
 * @returns {Promise<boolean>} Whether the text reached the system clipboard.
 */
export async function writeSystemClipboard(text, nav = globalThis.navigator, png = null) {
    const clipboard = systemClipboard(nav);
    if (!clipboard) {
        return false;
    }
    if (png === null && text === null) {
        return false;
    }
    try {
        // A picture is the copy when one was offered, and it travels alone:
        // an application that receives a clipboard carrying both a picture and
        // a drawing pastes BOTH — the reference's own paste does — and one
        // copy becoming two things on someone's canvas is not a copy. The
        // picture is what every other application pastes; this application's
        // re-paste of a copied picture goes through its picture door, which is
        // what pasting a picture is.
        if (png) {
            await clipboard.write([new ClipboardItem({ "image/png": png })]);
            return true;
        }
        await clipboard.writeText(text);
        return true;
    } catch (_) {
        return false;
    }
}

/**
 * Read what the system clipboard holds, in the types it offers.
 *
 * `readText` answers one question about one type; a clipboard can hold more
 * than text — a picture copied in another application is exactly what this
 * application's paste is for — and `read()` is the only door to it. The answer
 * is the browser's own items, untouched: the caller asks each what it carries.
 *
 * `null` when the clipboard could not be reached or the browser does not carry
 * the door — the same answer `readText` gives, and the same fallback applies.
 *
 * @returns {Promise<Array | null>} The clipboard's items, or `null`.
 */
export async function readSystemClipboardItems(nav = globalThis.navigator) {
    const clipboard = systemClipboard(nav);
    if (!clipboard || typeof clipboard.read !== "function") {
        return null;
    }
    try {
        return await clipboard.read();
    } catch (_) {
        return null;
    }
}

/**
 * A `Blob` as the data URL the document carries a picture in.
 *
 * The bytes come from the clipboard as a blob and travel in the document as a
 * data URL; the reader is the browser's own `FileReader`, the same one the
 * import picker uses, so the two doors spell the payload the same way.
 *
 * @param {Blob} blob
 * @returns {Promise<string>} The data URL.
 */
export function blobToDataURL(blob, Reader = globalThis.FileReader) {
    return new Promise((resolve, reject) => {
        const reader = new Reader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error ?? new Error("read_failed: FileReader failed"));
        reader.readAsDataURL(blob);
    });
}

/**
 * Read the text the system clipboard holds.
 *
 * `null` when the clipboard could not be reached, which is a different thing
 * from an empty clipboard: an empty clipboard holds nothing, and a clipboard
 * that could not be read holds an unknown. The caller tells them apart by
 * falling back to what it holds itself.
 *
 * @returns {Promise<string|null>} The text, or `null` when it could not be read.
 */
export async function readSystemClipboard(nav = globalThis.navigator) {
    const clipboard = systemClipboard(nav);
    if (!clipboard) {
        return null;
    }
    try {
        return await clipboard.readText();
    } catch (_) {
        return null;
    }
}

/**
 * The text a paste puts on the canvas.
 *
 * The system clipboard is what this machine shares with the other applications,
 * so it comes first. What this application holds is the fallback, and the
 * fallback is for exactly one case: the system clipboard could not be *read*
 * — `null`, which is what a browser says when the page does not have the
 * user's attention, or says no.
 *
 * An empty system clipboard is a different thing, and it is not a fallback.
 * The system saying it holds nothing is an answer, and answering it with what
 * this application copied earlier would put on the canvas something the user
 * did not ask for and cannot see — the very thing that happens when a
 * clipboard was emptied in another application and the paste here still
 * brings back the last copy made here.
 *
 * The application's own text is asked for through a function, so it is only
 * read when it is the one being used.
 *
 * @param {string|null} systemText What the system clipboard holds, or `null`.
 * @param {() => string} ownText A reader for what this application holds.
 * @returns {string} The text to paste.
 */
export function pasteText(systemText, ownText) {
    return systemText === null ? ownText() : systemText;
}
