// Getting the drawing out of the browser.
//
// # Why the download lives here and not in `index.js`
//
// `index.js` is the loader and the renderer; it decides *when* something happens and asks
// the kernel what it means. What a browser does with a string — making a Blob, wiring an
// anchor, revoking an object URL — is neither of those, and it is the part that can be
// tested without a canvas. So it lives here and takes its one DOM dependency as an
// argument, which is what lets the tests run in Node at all.
//
// # Why the pen is not an argument here
//
// This module's job is "the drawing, as a file". The pen that file is drawn with has
// exactly one owner, `pen.mjs`, and threading it through would be a way for a caller to
// pass a pen the canvas never saw — which is the second-truth problem the file exists to
// prevent.

import { writeSystemClipboard } from "./clipboard.mjs";
import { penJson } from "./pen.mjs";
import { embedFonts } from "./svg-fonts.mjs";
import { getStickyNoteFooter, placeStickyNoteFooter } from "./sticky-note-footer.mjs";
import { embedPngScene } from "./png-scene.mjs";

/** What a `.svg` download declares itself as. */
const SVG_MIME = "image/svg+xml";

/** What a `.png` download declares itself as. */
const PNG_MIME = "image/png";

/** The filename every SVG export is offered under. */
const SVG_NAME = "nextdraw.svg";

/** The filename every PNG export is offered under. */
const PNG_NAME = "nextdraw.png";

/**
 * The session as an SVG document.
 *
 * The only thing here that knows about the kernel's surface. Split out so that a test can
 * pass a stub session and see exactly what the boundary was asked — including that the pen
 * crossed as the JSON `Pen` deserialises, with no field invented on the way.
 */
/**
 * The drawing as an SVG document, over what was asked for.
 *
 * `ids` names the elements the file holds — the selection's export — and
 * `background` paints the file's paper with a colour; both default to the
 * whole drawing and no paint, which is what the file has always been. The
 * kernel sizes the file by the ink of whatever elements it was handed, so a
 * selection is the same export asked over fewer elements and not a second
 * path that could measure differently.
 *
 * @param {Session} session
 * @param {{ids?: string[] | null, background?: string | null, padding?: number,
 *   scale?: number, darkFilter?: string | null, embedScene?: string | null,
 *   footerContext?: {nowMs: number, timeZone: string}} [options]
 * @returns {string} The SVG document.
 */
export function svgTextFor(session, options) {
    const ids = options?.ids ?? null;
    // The four asks of the export dialog ride the same crossing as the ids
    // and the paper: the kernel is already walking the scene, and a second
    // crossing for a margin or a filter would pay for the walk twice. A JSON
    // body with nothing to say is `null`, which is what the whole-drawing,
    // plain export has always been.
    const asks = {};
    if (options?.padding !== undefined) {
        asks.padding = options.padding;
    }
    if (options?.scale !== undefined) {
        asks.scale = options.scale;
    }
    if (options?.darkFilter != null) {
        asks.darkFilter = options.darkFilter;
    }
    if (options?.embedScene != null) {
        asks.embedScene = options.embedScene;
    }
    const footerContext = options?.footerContext ?? {
        nowMs: Date.now(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
    const elements = typeof session.toJson === "function"
        ? JSON.parse(session.toJson()).elements ?? []
        : [];
    const stickyNoteFooters = {};
    for (const element of elements) {
        if (element.type !== "stickynote") continue;
        const localFooter = getStickyNoteFooter(element, footerContext);
        if (localFooter !== null) {
            stickyNoteFooters[element.id] = {
                ...placeStickyNoteFooter(element, localFooter),
                color: element.strokeColor ?? "#1e1e1e",
            };
        }
    }
    if (Object.keys(stickyNoteFooters).length > 0) {
        asks.stickyNoteFooters = stickyNoteFooters;
    }
    const hasAsks = Object.keys(asks).length > 0;
    return session.exportSvg(
        penJson(),
        ids === null ? null : JSON.stringify(ids),
        options?.background ?? null,
        hasAsks ? JSON.stringify(asks) : null,
    );
}

/**
 * The intrinsic size a finished SVG document declares, in scene units.
 *
 * The document is the truth about how big the drawing is — its `width` and
 * `height` ride on the root element — and a rasteriser that reads them scales
 * the same source the file declares instead of a second measurement of it. A
 * document that says nothing (or says something unreadable) answers `null`,
 * and the caller keeps its own idea.
 *
 * @param {string} svg The finished SVG document.
 * @returns {{width: number, height: number} | null}
 */
export function svgSizeOf(svg) {
    const match = /<svg[^>]*\swidth="([^"]+)"[^>]*\sheight="([^"]+)"/.exec(svg);
    if (match === null) {
        return null;
    }
    const width = Number(match[1]);
    const height = Number(match[2]);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        return null;
    }
    return { width: Math.ceil(width), height: Math.ceil(height) };
}

/**
 * Rasterize an SVG document to a PNG `Blob` at the requested size.
 *
 * The browser already knows how to turn an SVG into pixels — that is what `<img src=…>`
 * does. The pipeline here is exactly that: load the SVG as an image, paint it into a
 * canvas, ask the canvas for a PNG blob. No decoder ships in this module; the three
 * collaborators (`Image`, `OffscreenCanvas`, `convertToBlob`) are passed in so the tests
 * can hand stubs and assert on the shape of the call.
 *
 * `width` and `height` are the output pixel size. The caller decides them (viewport
 * times DPI is the common choice); the SVG is scaled to fit, because the SVG's own
 * `viewBox` is the source of truth for the drawing's aspect ratio.
 */
export async function pngBlobFor(
    svg,
    width,
    height,
    newImage,
    newCanvas,
    url = globalThis.URL,
) {
    const href = url.createObjectURL(new Blob([svg], { type: SVG_MIME }));
    try {
        const image = newImage();
        // The two listeners are how an `Image` in a worker signals completion: there is
        // no Promise to await, only the event. Either path resolves the same promise.
        const loaded = new Promise((resolve, reject) => {
            image.addEventListener("load", () => resolve(image));
            image.addEventListener("error", () => reject(new Error("image failed to decode svg")));
        });
        image.src = href;
        const drawn = await loaded;

        const canvas = newCanvas(width, height);
        const ctx = canvas.getContext("2d");
        // Clear so a transparent SVG is exported as a transparent PNG, not as the
        // canvas's initial state on whatever the browser happens to default to.
        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(drawn, 0, 0, width, height);
        return await canvas.convertToBlob({ type: PNG_MIME });
    } finally {
        // The image is now a pixel buffer; the URL was only a transport.
        url.revokeObjectURL(href);
    }
}

/**
 * Hand `text` to the browser as a file called `name`.
 *
 * `doc` is a parameter rather than a global read so the tests can hand in a stand-in and
 * assert what the anchor was told, which is the only part of this a browser can get
 * wrong.
 *
 * `mime` is the last parameter and defaults to the SVG one, because this module is
 * about images and the document download — which is not an image — is the other thing
 * that needs a Blob and an anchor. It lives here rather than in a second module
 * because the browser mechanics are the same three lines either way, and two copies
 * of them is two places for the "revoke too early and the download produces nothing"
 * bug to hide in.
 */
export function downloadText(
    text,
    name,
    doc = globalThis.document,
    url = globalThis.URL,
    mime = SVG_MIME,
) {
    const href = url.createObjectURL(new Blob([text], { type: mime }));
    const anchor = doc.createElement("a");
    anchor.href = href;
    anchor.download = name;
    // The click is not dispatched and waited on, so the browser takes the reference when
    // it gets round to it. Revoking in the same turn throws that away first — a download
    // that silently produces nothing is the worst possible failure here, so the revocation
    // waits for the turn after.
    anchor.click();
    globalThis.setTimeout(() => url.revokeObjectURL(href), 0);
    return { name, href };
}

/**
 * The drawing as a downloaded `.svg` that carries the faces its text uses.
 *
 * `fonts` is where the faces come from (see `embedFonts`). An export whose faces cannot be
 * read still has to produce a file, so the unembedded document is offered instead and the
 * reason is returned for the caller to say.
 *
 * @returns {Promise<{name: string, href: string, fontError?: unknown}>}
 */
export async function exportSvgWithFonts(session, doc, url, options, fonts) {
    const plain = svgTextFor(session, options);
    try {
        return downloadText(await embedFonts(plain, fonts), SVG_NAME, doc, url);
    } catch (fontError) {
        return { ...downloadText(plain, SVG_NAME, doc, url), fontError };
    }
}

/**
 * The drawing as a downloaded `.svg`. What the toolbar button calls.
 *
 * `options` carries the export's two asks — the elements and the paper — and
 * both default to the file the button has always downloaded.
 */
export function exportSvg(session, doc, url, options) {
    return downloadText(svgTextFor(session, options), SVG_NAME, doc, url);
}

/**
 * Rasterize the session through the same path used by PNG downloads.
 *
 * This is used by the live export preview: returning the PNG Blob instead of
 * offering a download keeps preview and export aligned on rendering and options.
 * An optional `maxRasterDimension` bounds preview memory without changing the
 * chosen export resolution or the downloadable PNG dimensions.
 *
 * @param {Session} session The session whose SVG is rasterized.
 * @param {number} width The base canvas pixel width.
 * @param {number} height The base canvas pixel height.
 * @param {typeof URL} [url] The object-URL provider used for the temporary SVG.
 * @param {() => HTMLImageElement} [newImage] The SVG image decoder.
 * @param {(width: number, height: number) => OffscreenCanvas} [newCanvas] The raster target.
 * @param {{ids?: string[] | null, resolution?: number, maxRasterDimension?: number,
 *   background?: string | null, padding?: number, darkFilter?: string | null,
 *   embedScene?: string | null}} [options] The export asks and optional preview bound.
 * @param {object | null} [fonts] Optional source for embedded font faces.
 * @returns {Promise<Blob>} The rasterized PNG, optionally carrying the scene metadata.
 */
export function pngBlobForSession(
    session,
    width,
    height,
    url = globalThis.URL,
    newImage = () => new globalThis.Image(),
    newCanvas = (w, h) => new globalThis.OffscreenCanvas(w, h),
    options,
    fonts = null,
) {
    return rasterOf(session, width, height, url, newImage, newCanvas, options, fonts);
}

/**
 * The session as a downloaded `.png`. What the second toolbar button calls.
 *
 * Width and height are the output pixel size; the SVG is rasterised to fit. Returns a
 * promise because the rasterisation is two awaits deep (image load + blob convert) and
 * the caller wants to know when the download has been offered.
 */
export async function exportPng(
    session,
    width,
    height,
    doc = globalThis.document,
    url = globalThis.URL,
    newImage = () => new globalThis.Image(),
    newCanvas = (w, h) => new globalThis.OffscreenCanvas(w, h),
    options,
    fonts = null,
) {
    const blob = await pngBlobForSession(session, width, height, url, newImage, newCanvas, options, fonts);
    const href = url.createObjectURL(blob);
    const anchor = doc.createElement("a");
    anchor.href = href;
    anchor.download = PNG_NAME;
    anchor.click();
    globalThis.setTimeout(() => url.revokeObjectURL(href), 0);
    return { name: PNG_NAME, href };
}

/**
 * The drawing as a PNG `Blob`: the one rasterisation the download and the copy share.
 *
 * Two doors with their own copy of this would be two files that could differ in size or
 * in faces, and a picture pasted somewhere would not be the picture the button saves.
 */
async function rasterOf(session, width, height, url, newImage, newCanvas, options, fonts) {
    let svg = svgTextFor(session, options);
    if (fonts !== null) {
        // A raster drawn without the faces would be drawn in the fallback; if they
        // cannot be read the PNG is still better than nothing.
        svg = await embedFonts(svg, fonts).catch(() => svg);
    }
    // A selection's file is sized by its own ink, so its raster reads the size
    // the document declares. A whole-scene export retains the canvas dimensions,
    // enlarged by the chosen pixel resolution.
    const resolution = [1, 2, 3].includes(options?.resolution) ? options.resolution : 1;
    let size = options?.ids
        ? (svgSizeOf(svg) ?? { width, height })
        : { width: Math.ceil(width * resolution), height: Math.ceil(height * resolution) };
    const maxRasterDimension = options?.maxRasterDimension;
    if (Number.isFinite(maxRasterDimension) && maxRasterDimension > 0) {
        const ratio = Math.min(1, maxRasterDimension / Math.max(size.width, size.height));
        if (ratio < 1) {
            size = {
                width: Math.max(1, Math.ceil(size.width * ratio)),
                height: Math.max(1, Math.ceil(size.height * ratio)),
            };
        }
    }
    let blob = await pngBlobFor(svg, size.width, size.height, newImage, newCanvas, url);
    if (options?.embedScene != null) {
        blob = await embedPngScene(blob, options.embedScene);
    }
    return blob;
}

/**
 * The drawing as a picture on the system clipboard.
 *
 * A picture travels alone (see `writeSystemClipboard`): another application pastes it as
 * the image it is. Whether it arrived is the answer; a browser that refuses the write is
 * a refusal to report, not an exception to throw.
 *
 * @returns {Promise<boolean>} Whether the picture reached the clipboard.
 */
export async function copyAsPng(
    session,
    width,
    height,
    options,
    fonts = null,
    nav = globalThis.navigator,
    url = globalThis.URL,
    newImage = () => new globalThis.Image(),
    newCanvas = (w, h) => new globalThis.OffscreenCanvas(w, h),
) {
    const blob = await rasterOf(session, width, height, url, newImage, newCanvas, options, fonts);
    return writeSystemClipboard(null, nav, blob);
}

/**
 * The drawing as SVG text on the system clipboard, carrying the faces its text uses when
 * they can be read (the file the download offers, byte for byte).
 *
 * @returns {Promise<{copied: boolean, fontError?: unknown}>}
 */
export async function copyAsSvg(session, options, fonts, nav = globalThis.navigator) {
    const plain = svgTextFor(session, options);
    if (fonts === null) {
        return { copied: await writeSystemClipboard(plain, nav) };
    }
    try {
        return { copied: await writeSystemClipboard(await embedFonts(plain, fonts), nav) };
    } catch (fontError) {
        return { copied: await writeSystemClipboard(plain, nav), fontError };
    }
}
