// Image import — one click on a button → `FileReader` reads the file as a data URL →
import { freshSeed } from "./tools.mjs";
// the `StampedElement` literal crosses the frontier by the same `Session::insert` the
// other five elements use. Same shape as the style rows of `client/style-toolbar.mjs` and the other
// toolbars of the trilogy (H4.18/H4.19/H4.20): a pure module that returns
// `{ /* nothing — import is one-shot, not a toggle */ }`, with `paintFn`, `measure`
// and `onError` injected by the client's boot so the wiring in `index.js` stays
// three lines.
//
// The dataURL is taken as it comes from the `FileReader.readAsDataURL` because the
// kernel already treats it as an opaque bag: it lives in `StampedElement::unmodelled`
// (H4.14), and the round-trip's discriminant — the `toJson` of the H5.1 smoke —
// asserts that it survives without the kernel having to understand the image. That is
// why `onError` only fires if `readAsDataURL` fails or `session.insert` rejects the
// literal: the `data:image/` prefix check lives here so no noise reaches the kernel,
// and the mutant in `image-import.test.mjs` verifies it.
//
// Where the picture goes is NOT opaque kernel data: it is four numbers the kernel
// computes and the client spends, so they cross the frontier the way everything else
// does — as a JSON document the client parses. That is what `readPlacement` does, and
// what the frontier's smoke exercises with the real WASM: a client with a fake can
// agree with another fake and not with the real frontier.
//
// The size that goes into that box may come from outside the kernel. The kernel
// reads it from a header it understands — PNG, JPEG, GIF, WebP — and honestly
// reports that it cannot read the rest. A browser decoded the picture, so a browser
// knows its size for every format there is: an SVG, a BMP, an AVIF.
// `measureInBrowser` is that question and `readPlacementFor` is the kernel's answer
// to it — the same centring, the same cap, the same refusal. The browser
// contributes one number and nothing else, so the geometry keeps exactly one owner.

export const DATA_URL_PREFIX = "data:image/";

/**
 * Where the kernel says the picture goes.
 *
 * The frontier answers in documents: every call it takes returns a JSON
 * *string* that the client parses — `stylesOf`, `chromeRecords`, `frame` and
 * `imagePlacement` all speak that language. Reading this one as an object
 * gives `undefined` for every number, and a literal without an `x` is what
 * the codec rejects with `missing field 'x'`: the import dies with a message
 * about a field nobody asked about, and no picture appears.
 *
 * @param session the WASM `Session` instance.
 * @param dataURL the picture's data URL.
 * @returns the box `{x, y, width, height}`, or `null` when the kernel has no
 *   place for this picture.
 */
export function readPlacement(session, dataURL) {
    const answer = session.imagePlacement(dataURL);
    return answer ? JSON.parse(answer) : null;
}

/**
 * Where a picture of `width`×`height` pixels belongs.
 *
 * The same reader as {@link readPlacement}, for a size the caller already
 * knows. The frontier answers in documents in both cases and the client parses
 * documents in both cases: the two methods differ in where the size came from,
 * not in the language the answer speaks.
 *
 * @param session the WASM `Session` instance.
 * @param width the picture's width in pixels.
 * @param height the picture's height in pixels.
 * @returns the box `{x, y, width, height}`, or `null` when the kernel has no
 *   place for a picture of that size.
 */
export function readPlacementFor(session, width, height) {
    const answer = session.imagePlacementFor(width, height);
    return answer ? JSON.parse(answer) : null;
}

/**
 * Measure a picture in the browser.
 *
 * The kernel reads a picture's size out of a header, and there are formats
 * whose size is not in a header: an SVG carries it in the markup, and a
 * browser decodes it anyway. Upstream asks the browser for the size, because
 * the browser is what decoded the picture. This is that question, and it is
 * the only thing this module asks the browser.
 *
 * It measures and it does not place. The box still comes from the kernel
 * through {@link readPlacementFor}, so the geometry that decides what is on
 * screen has exactly one owner and this answer cannot become a second one.
 *
 * @param dataURL the picture's data URL.
 * @param createImage builds the image element to measure with. A browser
 *   passes nothing; a test passes a fake.
 * @returns a promise of `{width, height}` in pixels, rejected when the
 *   browser cannot decode the picture at all.
 */
export function measureInBrowser(dataURL, createImage = () => new Image()) {
    return new Promise((resolve, reject) => {
        const img = createImage();
        img.onload = () => {
            const width = img.naturalWidth;
            const height = img.naturalHeight;
            if (!(width > 0) || !(height > 0)) {
                reject(new Error("the browser measured a picture with no size"));
                return;
            }
            resolve({ width, height });
        };
        img.onerror = () => {
            reject(new Error("the browser could not decode this picture"));
        };
        // `src` last, after the handlers are attached: a real browser fires them
        // asynchronously, and a fake that fires them on the same tick would find
        // no handler to call.
        img.src = dataURL;
    });
}

/**
 * Bind a hidden file input to a click handler. The button click opens the file
 * picker; the file's `readAsDataURL` result becomes the `dataURL` field of the
 * `StampedElement` literal that `Session::insert` accepts.
 *
 * The element id is a fresh UUID — there is no `getElementById` race to worry
 * about, and the same id is used for both `StampedElement.id` and the `fileId`
 * of the element, which is what an `ExcalidrawImageElement` carries on the wire.
 *
 * @param root the toolbar fragment that contains `button[data-import]` and the
 *   hidden `input[type=file][data-import-file]`.
 * @param session the WASM `Session` instance, already created.
 * @param paintFn called after a successful insert so the canvas re-renders.
 * @param measure asked for a picture's size when the kernel cannot read its
 *   header. It resolves to `{width, height}` in pixels; the box still comes
 *   from the kernel. A caller with no way to measure leaves it out, and a
 *   picture the kernel cannot read is refused as it was before.
 * @param onError called on any failure: bad data URL prefix, `FileReader` error,
 *   a picture nothing can measure, or the `insert` throwing.
 * @param signal when it aborts, the button and the file input stop listening.
 */
export function bindImageImport({
    root,
    session,
    paintFn,
    measure,
    onError = (error) => {
        throw error;
    },
    signal,
}) {
    const button = root.querySelector("button[data-import]");
    const input = root.querySelector("input[type=file][data-import-file]");
    if (!button) {
        throw new Error("import_image: missing button[data-import] in root");
    }
    if (!input) {
        throw new Error("import_image: missing input[type=file][data-import-file] in root");
    }
    button.addEventListener("click", () => {
        input.click();
    }, { signal });
    input.addEventListener("change", () => {
        const file = input.files && input.files[0];
        if (!file) {
            return;
        }
        const reader = new FileReader();
        reader.onload = async () => {
            const dataURL = String(reader.result);
            if (!dataURL.startsWith(DATA_URL_PREFIX)) {
                onError(new Error("bad_image: not a data URL"));
                return;
            }
            await insertImageFromDataURL({ session, dataURL, paintFn, measure, onError });
        };
        reader.onerror = () => {
            onError(reader.error ?? new Error("read_failed: FileReader failed"));
        };
        reader.readAsDataURL(file);
    }, { signal });
}

/**
 * Put one picture into the drawing, wherever the kernel says it belongs.
 *
 * The door the picker opens and the door a paste from the system opens are
 * the same door: the payload is a data URL either way, the box is the
 * kernel's answer either way, and the element carries its own file either
 * way. What differs between an import and a paste is only how the bytes
 * arrived, and that is the caller's business.
 *
 * @param {object} door The door's arguments.
 * @param {Session} door.session The WASM session, already created.
 * @param {string} door.dataURL The picture, as the document carries it.
 * @param {Function} door.paintFn Called after the insert so the canvas repaints.
 * @param {Function} [door.measure] Asked for a picture's size when the kernel
 *   cannot read its header.
 * @param {Function} [door.onError] Called on any failure.
 * @param {[number, number]} [door.at] A scene point to centre the picture on, as
 *   a drop gives one. The size is still the kernel's answer; only the position
 *   moves. Left out, the picture goes where the kernel placed it.
 * @returns {Promise<string | null>} The new element's id, or `null` when the
 *   picture found no place.
 */
export async function insertImageFromDataURL({
    session,
    dataURL,
    paintFn,
    measure,
    at,
    onError = (error) => {
        throw error;
    },
}) {
        // Where the picture goes is the kernel's answer, not this file's: the
        // box is what the canvas draws into and what the exported viewBox is
        // measured from, and deciding it needs the viewport transform that
        // `renderList` already applies. Computing it here would be a second
        // copy of that arithmetic, and the two copies would disagree about
        // where the canvas centre is. One call, four numbers, no decoding.
        let box;
        try {
            box = readPlacement(session, dataURL);
        } catch (error) {
            // A document the client cannot read is a broken contract. The
            // user is told so, because the alternative is a `FileReader`
            // callback that throws into nothing and a canvas that never
            // changes.
            onError(
                new Error(`bad_image: unreadable placement (${error.message ?? error})`),
            );
            return null;
        }
        if (!box) {
            // The kernel cannot read this header. The browser can: it decoded
            // the picture, so it knows the size of every format there is —
            // an SVG, a BMP, an AVIF. Ask it for the size and hand the size
            // back to the kernel, which still owns the box.
            //
            // The order matters and is the whole point: the browser is asked
            // only when the kernel already said no. A picture the kernel can
            // measure is never decoded twice, and a format this build reads
            // keeps the answer the header gave it.
            if (!measure) {
                onError(new Error("bad_image: no place for this image"));
                return null;
            }
            let size;
            try {
                size = await measure(dataURL);
            } catch (error) {
                onError(new Error(`bad_image: ${error.message ?? error}`));
                return null;
            }
            try {
                box = readPlacementFor(session, size.width, size.height);
            } catch (error) {
                onError(
                    new Error(`bad_image: unreadable placement (${error.message ?? error})`),
                );
                return null;
            }
            if (!box) {
                // Measured, and still no place for it. A picture with no area
                // is a hole, and a hole is harder to diagnose than a refusal.
                onError(new Error("bad_image: no place for this image"));
                return null;
            }
        }
        if (at) {
            box = { ...box, x: at[0] - box.width / 2, y: at[1] - box.height / 2 };
        }
        const id = crypto.randomUUID();
        // The wire shape that crosses the frontier: the kernel's `StampedElement`
        // flattens its `Element` (the enum is `#[serde(tag = "type")]`), so `type`
        // sits at the top level of the literal — not nested under `element`. The
        // smoke gate is the single source of truth: a literal shaped the other way
        // gets a `missing field 'type'` from the codec, not a `duplicate_id` from
        // the session.
        const stamped = {
            id,
            seed: freshSeed(),
            version: 1,
            type: "image",
            x: box.x,
            y: box.y,
            width: box.width,
            height: box.height,
            angle: 0,
            fileId: id,
            status: "saved",
            scale: [1, 1],
            dataURL,
        };
        try {
            session.insert(JSON.stringify(stamped));
        } catch (error) {
            onError(error);
            return null;
        }
        paintFn();
    return id;
}

