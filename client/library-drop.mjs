// A library piece dragged from the panel and dropped on the canvas.
//
// The panel hands the piece over under a type of its own, so this drop and the file
// drop (`client/drop-files.mjs`) never answer the same drag: each looks for its own
// type and leaves the other's events alone. Where the piece lands is the kernel's
// to say; this module only reads the payload and passes the pointer's point on.

/** The `dataTransfer` type a dragged piece travels under. */
export const LIBRARY_MIME = "application/x-nextdraw-library-piece";

const carriesPiece = (event) => Array.from(event.dataTransfer?.types ?? []).includes(LIBRARY_MIME);

/**
 * The piece in a drop, or `null` when the payload is not one.
 *
 * Another page can put anything under any type, so the payload is checked for the
 * one thing the insertion needs: a non-empty list of elements.
 *
 * @param {{getData?: (type: string) => string}} dataTransfer
 * @returns {{id?: string, name?: string, elements: object[]} | null}
 */
export function readPiece(dataTransfer) {
    try {
        const piece = JSON.parse(dataTransfer.getData(LIBRARY_MIME));
        return Array.isArray(piece?.elements) && piece.elements.length > 0 ? piece : null;
    } catch {
        return null;
    }
}

/**
 * Bind the drop of a piece on `target`.
 *
 * `dragover` is answered only for a drag that carries a piece, because answering it
 * is what lets the browser allow the drop. A view-only page consumes the drop and
 * says why through `onRefuse`; it inserts nothing.
 *
 * @param {object} options
 * @param {EventTarget} options.target the canvas.
 * @param {(piece: object, drop: {clientX: number, clientY: number}) => void} options.onPiece
 * @param {() => void} [options.onRefuse] the page refuses edits.
 * @param {() => boolean} [options.isViewOnly]
 * @param {AbortSignal} [options.signal] its abort takes both listeners off the target.
 */
export function bindLibraryDrop({ target, onPiece, onRefuse = () => {}, isViewOnly = () => false, signal }) {
    target.addEventListener("dragover", (event) => {
        if (!carriesPiece(event)) {
            return;
        }
        event.preventDefault();
        if (event.dataTransfer) {
            event.dataTransfer.dropEffect = "copy";
        }
    }, { signal });
    target.addEventListener("drop", (event) => {
        if (!carriesPiece(event)) {
            return;
        }
        event.preventDefault();
        if (isViewOnly()) {
            onRefuse();
            return;
        }
        const piece = readPiece(event.dataTransfer);
        if (piece !== null) {
            onPiece(piece, { clientX: event.clientX, clientY: event.clientY });
        }
    }, { signal });
}
