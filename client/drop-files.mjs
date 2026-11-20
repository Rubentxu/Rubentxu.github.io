// Files dropped on the canvas.
//
// A drop carries files, and what a file means is decided by what it is: a picture
// is laid down where it fell, a drawing or a library is opened the way the Open
// button opens it. This module only classifies and routes; the two doors it calls
// are the ones the picker and the Open button already use, so a dropped file and a
// chosen file cannot be treated differently.

/** The extensions of a file the editor opens as a document. */
export const DOCUMENT_EXTENSIONS = Object.freeze([".excalidraw", ".excalidrawlib", ".json"]);

/** The scene distance between pictures dropped together, so they do not hide each other. */
export const DROP_STEP = 24;

/**
 * What a dropped file is.
 *
 * @param {{name?: string, type?: string}} file
 * @returns {"image" | "document" | null} `null` for a file the editor cannot use.
 */
export function classifyFile(file) {
    if (typeof file.type === "string" && file.type.startsWith("image/")) {
        return "image";
    }
    const name = String(file.name ?? "").toLowerCase();
    return DOCUMENT_EXTENSIONS.some((extension) => name.endsWith(extension)) ? "document" : null;
}

const carriesFiles = (event) => Array.from(event.dataTransfer?.types ?? []).includes("Files");

/**
 * Bind the drop on `target`.
 *
 * `dragover` is answered only for a drag that carries files, because answering it
 * is what makes the browser allow the drop; a drag of text must keep its default.
 * A drop holding a document opens its first one and leaves the rest: opening
 * replaces the drawing, so pictures dropped with it would be inserted into a
 * drawing that is about to disappear. A drop with no document lays down each
 * picture, `DROP_STEP` apart.
 *
 * @param {object} options
 * @param {EventTarget} options.target the canvas.
 * @param {(file: File, drop: {clientX: number, clientY: number, index: number}) => void} options.onImage
 * @param {(file: File) => void} options.onDocument
 * @param {(file: File) => void} [options.onRefuse] a file that is neither.
 * @param {AbortSignal} [options.signal] its abort takes both listeners off the target.
 */
export function bindFileDrop({ target, onImage, onDocument, onRefuse = () => {}, isViewOnly = () => false, signal }) {
    target.addEventListener("dragover", (event) => {
        if (!carriesFiles(event)) {
            return;
        }
        event.preventDefault();
        if (event.dataTransfer) {
            event.dataTransfer.dropEffect = "copy";
        }
    }, { signal });
    target.addEventListener("drop", (event) => {
        if (!carriesFiles(event)) {
            return;
        }
        event.preventDefault();
        // The drop is consumed either way, or the browser would navigate to the
        // file; a view-only page then does nothing with it.
        if (isViewOnly()) {
            return;
        }
        const files = Array.from(event.dataTransfer.files ?? []);
        const kinds = files.map(classifyFile);
        const toOpen = files[kinds.indexOf("document")];
        if (toOpen) {
            onDocument(toOpen);
            return;
        }
        let index = 0;
        files.forEach((file, at) => {
            if (kinds[at] === "image") {
                onImage(file, { clientX: event.clientX, clientY: event.clientY, index });
                index += 1;
            } else {
                onRefuse(file);
            }
        });
    }, { signal });
}
