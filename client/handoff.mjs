// Handing bytes to the user as a file, and what is known afterwards.
//
// # The question this module answers
//
// A browser can be asked to take a file in two ways, and only one of them
// answers back.
//
// - The browser's own file picker. The application asks where the file goes,
//   writes it, and the write resolves. When it resolves, the bytes are on the
//   disk and the application knows it.
// - A download. The application hands the bytes over and never hears whether
//   they arrived.
//
// The difference is not a detail. A download the browser refuses, or that the
// user dismisses, leaves the application with no way to tell, and an
// application that reads "the download was started" as "the user has the file"
// is claiming something it cannot know. The claim such an application usually
// goes on to make is "so I can throw my copy away", and that is how a drawing
// somebody spent an afternoon on disappears.
//
// # Why the file picker is the one that answers
//
// It is also how the reference application saves its own document: the user
// chooses the place, the application writes the file, and the promise
// resolves when the bytes have landed. The same mechanism gives the same
// guarantee, and a file the application wrote itself is a file it can vouch
// for.
//
// # What it does not do
//
// It does not decide what the bytes mean, and it does not keep a copy of
// them. Whether the bytes are worth handing over, and what happens to the
// copy the application still holds, are questions for the caller.

import { downloadText } from "./export.mjs";

/**
 * The name of the exception a cancelled file picker throws.
 *
 * The browser aborts the pick when the user closes the dialog. That is not a
 * failure of the machine: nothing was written and nothing was broken. It is
 * answered with "nothing was confirmed", and it is *not* answered with a
 * download — the user said no, and offering the file anyway would be doing
 * the thing they declined.
 */
const CANCELLED = "AbortError";

/**
 * The extension a file name ends with, or an empty string when it has none.
 *
 * The picker uses it to fill the file type filter, and a filter that offers
 * every type is a filter that offers nothing.
 *
 * @param {string} name The file name.
 * @returns {string}
 */
function extensionOf(name) {
    const dot = name.lastIndexOf(".");
    return dot > 0 ? name.slice(dot) : "";
}

/**
 * Write `text` to the place the user chose.
 *
 * The three steps are the browser's: a handle to the chosen file, a stream
 * open on it, and the bytes written into it. The last one is the one that
 * matters — until it resolves, the file may be empty.
 *
 * The options are the ones the browser's own picker takes: the name the file
 * is offered under, and the kinds of file the picker may offer. The second is
 * a pair of a label and the types it stands for, and the extensions carry the
 * leading dot the browser insists on.
 *
 * @param {string} text The bytes.
 * @param {string} name The name the file is offered under.
 * @param {string} mime What the file declares itself as.
 * @param {string} description The label the picker shows for this kind of file.
 * @param {Function} picker The browser's file picker.
 * @returns {Promise<void>}
 */
async function writeToChosenFile(text, name, mime, description, picker) {
    const handle = await picker({
        suggestedName: name,
        types: [{ description, accept: { [mime]: [extensionOf(name)] } }],
    });
    const writable = await handle.createWritable();
    await writable.write(text);
    await writable.close();
}

/**
 * Hand `text` to the user as a file called `name`.
 *
 * The answer is what is known afterwards, not what was attempted:
 *
 * - `confirmed` — the bytes are on the disk. The application wrote them and
 *   the write resolved.
 * - `offered` — the browser was asked to take the bytes. A file that was
 *   written is offered, and so is a download that was started.
 *
 * A picker the user closes is neither: nothing was written and nothing was
 * offered. A picker that fails for a reason of its own falls back to the
 * download, which can be offered but never confirmed — the bytes still have
 * to reach the user, and a browser that will not open a picker is not a
 * browser that will not download.
 *
 * The caller decides what an unconfirmed handoff means. The usual answer is
 * that the copy the application still holds is worth more than the file it
 * cannot vouch for.
 *
 * @param {string} text The bytes.
 * @param {string} name The name the file is offered under.
 * @param {{mime?: string, description?: string, doc?: unknown, url?: unknown, picker?: unknown}} [options]
 * @returns {Promise<{confirmed: boolean, offered: boolean}>}
 */
export async function handOverText(
    text,
    name,
    {
        mime = "text/plain",
        description = "Files",
        doc,
        url,
        picker = globalThis.showSaveFilePicker,
    } = {},
) {
    if (typeof picker === "function") {
        try {
            await writeToChosenFile(text, name, mime, description, picker);
            return { confirmed: true, offered: true };
        } catch (error) {
            if (error?.name === CANCELLED) {
                return { confirmed: false, offered: false };
            }
            // The picker is there and it did not work — a browser that refuses
            // to open it, a disk that will not take the file. The bytes still
            // have to reach the user, so the offer falls back to the download.
            // Nothing about that fallback confirms anything.
        }
    }
    downloadText(text, name, doc, url, mime);
    return { confirmed: false, offered: true };
}
