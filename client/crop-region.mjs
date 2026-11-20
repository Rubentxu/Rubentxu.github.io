// The geometry a crop drag is decided by, in one pure place.
//
// A drag on the canvas means "this part of the picture", and turning that into
// a region is two questions that must answer with the same numbers: the
// rectangle the ghost draws while the pointer is down, and the region the
// commit writes when it lifts. One function answers both, so the preview and
// the edit cannot disagree — the ghost can never promise a rectangle the
// commit does not keep.
//
// Everything here is scene units in, document spelling out. The box is the one
// the kernel publishes for the element; the span is the region that box
// currently shows — the stored crop, or the whole bitmap when nothing is
// stored yet. No canvas, no kernel, no time: the suites run this and the page
// runs the same thing, which is the whole reason it is a module of its own.

/**
 * A drag rectangle clamped to a box, corners normalised.
 *
 * The pointer may start the drag off the picture, cross an edge, or lift
 * before it ever entered; the region it names is still a rectangle inside the
 * box, because an image shows a part of its bitmap and nothing outside it.
 *
 * @param {{left: number, top: number, right: number, bottom: number}} box
 * @param {{x: number, y: number}} a One drag corner.
 * @param {{x: number, y: number}} b The other drag corner.
 * @returns {{left: number, top: number, right: number, bottom: number}}
 */
export function clipToBox(box, a, b) {
    const clampX = (value) => Math.min(Math.max(value, box.left), box.right);
    const clampY = (value) => Math.min(Math.max(value, box.top), box.bottom);
    return {
        left: clampX(Math.min(a.x, b.x)),
        top: clampY(Math.min(a.y, b.y)),
        right: clampX(Math.max(a.x, b.x)),
        bottom: clampY(Math.max(a.y, b.y)),
    };
}

/**
 * The region a drag names, as the document spells a crop.
 *
 * The drag is read as a fraction of the image's box, and the box shows the
 * span the image already crops to — so the drag maps into *that* region, and
 * the first crop of a whole image is the case where the span is the bitmap
 * itself. Natural size rides through unchanged: the region is named in the
 * bitmap's own pixels, and the drag never changes how large that bitmap is.
 *
 * @param {{left: number, top: number, right: number, bottom: number}} box
 * @param {{x: number, y: number}} a One drag corner, in scene units.
 * @param {{x: number, y: number}} b The other drag corner, in scene units.
 * @param {{
 *   x: number, y: number, width: number, height: number,
 *   naturalWidth: number, naturalHeight: number,
 * }} span The region the box currently shows.
 * @returns {{
 *   clipped: {left: number, top: number, right: number, bottom: number},
 *   region: {
 *     x: number, y: number, width: number, height: number,
 *     naturalWidth: number, naturalHeight: number,
 *   },
 * }} The rectangle to preview and the region to write — the same drag, twice.
 */
export function cropFromDrag(box, a, b, span) {
    const clipped = clipToBox(box, a, b);
    const fx0 = (clipped.left - box.left) / (box.right - box.left);
    const fx1 = (clipped.right - box.left) / (box.right - box.left);
    const fy0 = (clipped.top - box.top) / (box.bottom - box.top);
    const fy1 = (clipped.bottom - box.top) / (box.bottom - box.top);
    return {
        clipped,
        region: {
            x: span.x + fx0 * span.width,
            y: span.y + fy0 * span.height,
            width: (fx1 - fx0) * span.width,
            height: (fy1 - fy0) * span.height,
            naturalWidth: span.naturalWidth,
            naturalHeight: span.naturalHeight,
        },
    };
}
