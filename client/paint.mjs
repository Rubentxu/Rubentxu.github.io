// How a `DrawOp` becomes pixels.
//
// # Where the colours come from
//
// The op carries them, since H6.14: `strokeColor`, `backgroundColor` and `opacity` are
// fields of the element, the kernel hands them over with the shape, and this file paints
// what it is told.
//
// Before that the palette lived here and the kernel had no colour at all: one black for
// the whole drawing, and a document that said red was drawn in black with the red sitting
// in the file where nobody could see it. The pen in `pen.mjs` is now the **fallback** —
// what an op paints like when it arrives without colours — and not the rule.
//
// The division that is left is the one that was always right: the kernel says *what* the
// shape is and *with which ink*, and this file says *how* the ink is laid on the canvas.
// A colour is not a rendering decision; it is a fact about the element.
//
// # One routine, four fills
//
// Solid, hachure, cross-hatch and zigzag are one scanline pass with a different pen per
// row, not four algorithms. A scanline is a horizontal line; the interior of a polygon at
// that height is a set of x-spans found by crossing edges; and each style is what you do
// with those spans — nothing at all, one slanted stroke, two strokes in opposite
// directions, or a zigzag between them. Handling them separately would mean four places
// for the interior test to be wrong, and an ellipse arrives here already tessellated into
// 64 sides precisely because a polygon is the common case, not an exception.
//
// The scanline is horizontal even though a hachure is slanted, because the slant is a
// shear of the span's endpoints rather than a change of how the interior is found. One
// interior test, one slanting rule, four styles.

// The pen itself lives in `pen.mjs`, because the exported SVG needs the same numbers and
// this file is not the only place that draws. What stays here is the geometry: how a
// scanline becomes a hatch row, which is a canvas construction with no counterpart in the
// file. The *numbers* the pen holds are shared; the *colours* are the element's own and
// travel with the op.
import { GESTURES } from "./gesture.mjs";
import { LASER_COLOR, laserSizes } from "./laser.mjs";
import { peerColor } from "./presence.mjs";
import { DASH, ERASE_PENDING_OPACITY, ERASER_TRAIL, FILL, LINE_WIDTH, STROKE } from "./pen.mjs";
import { HANDLE_NAMES } from "./vocabulary.mjs";

/**
 * Paint the remote peers' pointers, over everything the scene drew.
 *
 * Presence is the laser's twin: upstream renders its collaborators' pointers
 * on the interactive canvas, above the drawing, in a colour derived from the
 * peer's own id (`getClientColor`, `packages/excalidraw/clients.ts` —
 * `hsl((hash % 37) * 10, 100%, 83%)`, the hue the room already knows from
 * the colour the module hands over). The pointer is a small filled triangle
 * with the peer's name beside it, which is the whole vocabulary of "someone
 * else is here": who, and where.
 *
 * The peers arrive already pruned — `client/presence.mjs` answers with the
 * alive ones — so an empty list draws nothing and the caller's decay loop
 * has stopped by the time the room empties.
 *
 * @param ctx A canvas 2D context.
 * @param {Array<{id: string, x: number, y: number, name?: string}>} peers The alive peers, in screen pixels.
 */
export function paintPresence(ctx, peers) {
    if (!peers || peers.length === 0) {
        return;
    }
    ctx.save();
    ctx.textBaseline = "alphabetic";
    for (const peer of peers) {
        const colour = peerColor(peer.id);
        // The pointer: a small triangle the way a cursor is drawn, tip at
        // the peer's position.
        ctx.fillStyle = colour;
        ctx.beginPath();
        ctx.moveTo(peer.x, peer.y);
        ctx.lineTo(peer.x + 11, peer.y + 4);
        ctx.lineTo(peer.x + 4, peer.y + 11);
        ctx.closePath();
        ctx.fill();
        const label = peer.name ?? peer.id;
        ctx.font = "12px Helvetica, sans-serif";
        ctx.fillText(label, peer.x + 14, peer.y + 14);
    }
    ctx.restore();
}

/** Paint remote selection outlines from the frame already read for this paint. */
export function paintRemoteSelections(ctx, frame, peers) {
    if (!Array.isArray(frame?.items) || !Array.isArray(peers) || peers.length === 0) {
        return;
    }
    for (const peer of peers) {
        const selected = new Set(Array.isArray(peer.selectedIds) ? peer.selectedIds : []);
        if (selected.size === 0) {
            continue;
        }
        for (const item of frame.items) {
            const mark = item.Mark;
            const text = item.Text;
            const id = mark ? markId(mark) : text?.id;
            if (id === null || id === undefined || !selected.has(id)) {
                continue;
            }
            const payload = mark
                ? Object.values(mark).find((value) => value && typeof value === "object" && value.id === id)
                : text;
            if (!payload) {
                continue;
            }
            ctx.save();
            ctx.strokeStyle = peerColor(peer.id);
            ctx.lineWidth = 2;
            ctx.setLineDash([5, 3]);
            if (Array.isArray(payload.points) && payload.points.length > 1) {
                const points = payload.points.map((point) => Array.isArray(point) ? point : [point.x, point.y]);
                ctx.beginPath();
                ctx.moveTo(points[0][0], points[0][1]);
                for (const point of points.slice(1)) {
                    ctx.lineTo(point[0], point[1]);
                }
                if (mark?.Outline) {
                    ctx.closePath();
                }
                ctx.stroke();
            } else if (
                Number.isFinite(payload.x) && Number.isFinite(payload.y) &&
                Number.isFinite(payload.width) && Number.isFinite(payload.height)
            ) {
                const angle = Number.isFinite(payload.angle) ? payload.angle : 0;
                const centreX = payload.x + payload.width / 2;
                const centreY = payload.y + payload.height / 2;
                ctx.translate(centreX, centreY);
                ctx.rotate(angle);
                ctx.strokeRect(-payload.width / 2, -payload.height / 2, payload.width, payload.height);
            }
            ctx.restore();
        }
    }
}

/**
 * Paint one op.
 *
 * `closed` is `true` for an outline and `false` for a polyline. It is passed rather than
 * derived from the field names because the op arrives as `{ Outline: {...} }` and its
 * fields are already unpacked by the caller, which is the only place in the client that
 * knows which variant it is holding.
 */
/**
 * Image cache, keyed by data URL.
 *
 * The browser's `Image` element is the only thing that knows how to decode a PNG/JPEG
 * data URL; we cannot `drawImage` straight from the string. We construct one per URL,
 * assign `src` once, and reuse it across frames. A frame that fires before the image has
 * decoded draws nothing — and the decode itself asks for the frame that picks it up,
 * through `setImageReady` below. That hook is the whole reason an image becomes
 * visible. Before H5.27 this comment said "the cache already returns the right answer
 * on the next tick", which was true of the cache and false of the page: nothing made a
 * next tick, so an imported image stayed invisible until the user happened to move the
 * mouse. The listener is attached once per data URL, not once per paint.
 */
const imageCache = new Map();

/** Element id → data URL, so a picture is asked for once and not once per frame.
 *
 * What makes this sound is not that ids are never reused — the kernel lets an id be
 * inserted again after a deletion, and this repo has already learned that the safe
 * assumption is the one the kernel actually enforces. It is that an entry here cannot
 * outlive its element: every deletion path calls `forgetImageFor`, and replacing the
 * whole session calls `forgetImages`. Remove either and the map is a claim about the
 * future that nothing holds.
 */
const imageTextById = new Map();

/**
 * Called once per data URL, when that URL finishes decoding. `index.js` registers the
 * frame scheduler's `request` here at boot, which is what turns a decode into a
 * repaint. It is a setter rather than a parameter because `paintImage` is called from
 * inside `paintOps`, which is called from inside the paint thunk — threading a callback
 * down that chain would put a scheduler argument in the renderer's signature to serve
 * one call site. `wiring.test.mjs` asserts the registration exists, because a hook
 * nobody calls is indistinguishable from a hook that does not work.
 */
let onImageReady = () => {};

/** Register the "a data URL just decoded, ask for a frame" callback. */
export function setImageReady(fn) {
    onImageReady = fn;
}

/**
 * How many decodes have landed, across the session.
 *
 * A decode makes a picture appear inside a frame that has not moved — the
 * kernel's revision knows nothing of the browser's decoder — so the static
 * layer's key reads this, and a landed decode repaints a glass that would
 * otherwise keep showing the hole where the picture will be. It moves only on
 * a decode: a paint that finds its image already decoded changes nothing the
 * key can see.
 */
let imageVersionCounter = 0;

/** The image version, for the static layer's key. */
export function imageVersion() {
    return imageVersionCounter;
}

/** The decoded image or terminal decode state for a data URL. */
function getImage(dataURL) {
    let entry = imageCache.get(dataURL);
    if (entry === undefined) {
        const img = new Image();
        entry = { img, state: "loading" };
        imageCache.set(dataURL, entry);
        img.onload = () => {
            if (imageCache.get(dataURL) !== entry || entry.state !== "loading") {
                return;
            }
            img.onload = null;
            img.onerror = null;
            entry.state = "ready";
            imageVersionCounter += 1;
            onImageReady();
        };
        img.onerror = () => {
            if (imageCache.get(dataURL) !== entry || entry.state !== "loading") {
                return;
            }
            // Keep the terminal state so a bad URL is not decoded on every frame,
            // but release the failed browser object while the owning element remains.
            img.onload = null;
            img.onerror = null;
            entry.state = "failed";
            entry.img = null;
            imageVersionCounter += 1;
            onImageReady();
        };
        // Assigning `src` last, after both handlers are attached: a real browser fires
        // asynchronously, while synchronous fakes exercise the same cache entry.
        img.src = dataURL;
    }
    return entry;
}

/**
 * Paint an image op.
 *
 * The op names the element; it does not carry the picture. H8.2 took the payload out
 * of `renderList` because a one-megabyte image cost more than four thirds of a megabyte
 * on **every frame** — the single largest cost the boundary had. So the data URL is
 * fetched by id, through `fetchText`, and only the first time that id is painted.
 *
 * A missing or empty URL means the cache misses, which paints nothing — the same
 * answer upstream's `<img src="">` would draw. Rotation is applied to the **centre**, so
 * the box the user placed stays the box on screen after the canvas's own `transform`
 * undoes the rotation. Translating the centre rather than the top-left means a future
 * `crop` op would draw the cropped region in the same place without any extra
 * arithmetic.
 *
 * @param fetchText `(id) => string | undefined`, called at most once per element.
 */
/**
 * The natural size of the bitmap an image element shows, as the decoder sees it.
 *
 * The crop's region is measured in the bitmap's own pixels, and the client is the
 * side that decodes the bitmap — so the mapping from a drag on the canvas to a
 * region in natural pixels needs this size from here. The cache answers for the
 * images the picture has already decoded; a bitmap nobody has drawn yet decodes
 * on demand, the same one decode the painter would pay.
 *
 * @param {string} id The image element's id.
 * @param {Function} fetchText `(id) => string | undefined`, the payload lookup.
 * @returns {{width: number, height: number} | null} The natural size, or `null`
 *   when the payload is missing or the bitmap has not decoded yet.
 */
export function imageNaturalSize(id, fetchText) {
    const dataURL = imageTextFor(id, fetchText);
    if (!dataURL) {
        return null;
    }
    const entry = getImage(dataURL);
    const img = entry.state === "ready" ? entry.img : null;
    if (img === null || !img.naturalWidth || !img.naturalHeight) {
        return null;
    }
    return { width: img.naturalWidth, height: img.naturalHeight };
}

export function paintImage(
    ctx,
    { x, y, width, height, angle, scale, id, opacity, crop },
    fetchText,
) {
    const dataURL = imageTextFor(id, fetchText);
    if (!dataURL) {
        return;
    }
    const entry = getImage(dataURL);
    if (entry.state === "failed") {
        ctx.save();
        if (opacity !== undefined && opacity < 100) {
            ctx.globalAlpha = (ctx.globalAlpha || 1) * (opacity / 100);
        }
        ctx.translate(x + width / 2, y + height / 2);
        ctx.rotate(angle);
        ctx.scale(scale === undefined ? 1 : scale[0], scale === undefined ? 1 : scale[1]);
        ctx.strokeStyle = "#a40000";
        ctx.fillStyle = "#a40000";
        ctx.lineWidth = 1;
        ctx.strokeRect(-width / 2, -height / 2, width, height);
        ctx.font = `${Math.max(6, Math.min(12, height / 2))}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("Image failed", 0, 0);
        ctx.restore();
        return;
    }
    if (entry.state !== "ready" || entry.img === null) {
        return;
    }
    const img = entry.img;
    const cx = x + width / 2;
    const cy = y + height / 2;
    ctx.save();
    // The image steps out of the theme's filter.
    //
    // The dark theme turns the drawing over — upstream puts every colour it paints
    // through `applyDarkModeFilter` (`packages/common/src/colors.ts:86`) — and an
    // imported picture is not a colour it paints: upstream draws the raster as it is.
    // The filter used to live on the page, where it reached the image too, and a
    // photograph imported into a dark drawing came out inverted. The filter belongs
    // to the canvas now, and this is the one thing on the canvas that is not a colour.
    ctx.filter = "none";
    // The element's opacity applies to the raster too: upstream sets the alpha for the
    // whole element before it draws it (`context.globalAlpha = renderState.opacity`,
    // `packages/element/src/renderElement.ts:1041`), and a picture under a
    // half-transparent element is drawn at half opacity there.
    if (opacity !== undefined && opacity < 100) {
        ctx.globalAlpha = (ctx.globalAlpha || 1) * (opacity / 100);
    }
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    // The element's own mirror rides after the rotation: a negative axis
    // flips the picture about its centre, which is how a bitmap is mirrored
    // without re-encoding a pixel of it
    // (`context.scale(element.scale[0], element.scale[1])`,
    // `packages/element/src/renderElement.ts:1041`). An image standing as it
    // was imported carries ones, and scaling by one draws as scaling by
    // nothing.
    ctx.scale(scale === undefined ? 1 : scale[0], scale === undefined ? 1 : scale[1]);
    if (crop) {
        // A cropped image shows one slice of its bitmap: the source rectangle is
        // the region in the bitmap's own pixels, and the destination is the
        // element's box. The natural size rides with the region so the slice is
        // placed without asking the bitmap for its size twice.
        ctx.drawImage(
            img,
            crop.x,
            crop.y,
            crop.width,
            crop.height,
            -width / 2,
            -height / 2,
            width,
            height,
        );
    } else {
        ctx.drawImage(img, -width / 2, -height / 2, width, height);
    }
    ctx.restore();
}

/**
 * Paint a frame element: its border and its title.
 *
 * A frame is not a sketch. Upstream draws its border with a plain stroke —
 * `FRAME_STYLE`, `packages/common/src/constants.ts:209-221` — and puts the title in a
 * box above the top border, `nameOffsetY` away from it
 * (`packages/excalidraw/components/App.tsx:2180-2300`).
 *
 * ## Why the name says "element"
 *
 * This file already uses "frame" for the *picture*: `paintFrame` paints the whole
 * viewport frame, the list of items the kernel handed over. An Excalidraw frame is
 * a different thing entirely — it is one element inside that picture, the border
 * a user drew around a group of shapes.
 *
 * The two were given the same name once, and the module stopped being a module:
 * two exports called `paintFrame` is a `SyntaxError` at parse time, so the whole
 * client suite could not even load. The name that says which of the two is
 * meant is the one worth keeping.
 *
 * ## The numbers arrive in the op
 *
 * The colour, the width, the corner radius and the title's size and gap are all in
 * `style`, and they are not here because the kernel carries the table and both
 * renderers read it out of the same op. A copy of the table in this file and another in
 * the exporter would be two truths about one drawing, and the only symptom would be a
 * frame that is grey in the file and not on the screen.
 *
 * ## Two differences from upstream, on purpose
 *
 * Upstream truncates the title to the frame's width with an ellipsis
 * (`textOverflow: "ellipsis"`), and it measures the text to do it. Nothing here measures
 * text — the kernel does not measure fonts either — so the title is drawn whole in both
 * renderers, and a long name runs past the frame's right edge in both. Truncating in one
 * place and not the other would be the worse answer: a file that shows a different label
 * than the screen.
 *
 * Upstream's border is rounded only when the browser has `roundRect`, and so is this
 * one; the fallback is `rect`, which is what `strokeRect` draws
 * (`packages/element/src/renderElement.ts:1044-1059`).
 *
 * @param ctx A canvas 2D context.
 * @param {object} frame The `Frame` op: `{ id, x, y, width, height, name, style, children }`.
 *   `children` is the list of ids the frame holds; this function draws the border and the
 *   title and ignores it, and the clip that uses it is applied by `paintFrame`.
 */
export function paintFrameElement(ctx, { x, y, width, height, name, style }) {
    // The border. Upstream does not fill it: the frame's own `backgroundColor` is
    // "transparent" and the canvas only strokes the path.
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") {
        ctx.roundRect(x, y, width, height, style.radius);
    } else {
        ctx.rect(x, y, width, height);
    }
    ctx.strokeStyle = style.stroke;
    ctx.lineWidth = style.strokeWidth;
    // The frame's border is solid, and the dash of the shape drawn before it must
    // not leak into it.
    ctx.setLineDash([]);
    ctx.stroke();

    // The title, above the top border and aligned to its left edge.
    //
    // The baseline is where the gap is measured to. Upstream positions the title's
    // *box* three pixels above the border and lets the font decide where the
    // baseline falls inside it; nothing here measures fonts, so the gap is read as
    // the gap to the baseline, and the canvas and the exported file read it the
    // same way.
    if (!name) {
        return;
    }
    ctx.font = `${style.titleFontSize}px Helvetica, sans-serif`;
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";
    ctx.fillStyle = style.titleColor;
    ctx.fillText(name, x, y - style.titleOffsetY);
}

/**
 * A sticky note: the shadow under the paper, the paper, and the shadow along the paper's
 * own edge.
 *
 * Upstream draws the three in that order
 * (`packages/element/src/renderElement.ts:399-470`): the shadow is a filled path at its own
 * opacity, the paper is a filled path in the note's colour, and the edge shadow is the
 * paper's own outline stroked **inside** the paper.
 *
 * The clip is what makes the last one a shadow *along the paper's edge* and not a stroke
 * around it: upstream strokes the whole outline at twice the shadow's width and lets the
 * clip keep only the half that falls inside the paper
 * (`strokeStickyNoteEdge`, `packages/element/src/renderElement.ts:433-447`).
 *
 * @param ctx A canvas 2D context.
 * @param {object} note The op's payload: the two outlines and the style.
 */
export function paintStickyNote(ctx, { face, shadow, style, footer }) {
    // The shadow under the paper: the colour the model carries, at the opacity the model
    // carries. The canvas says those two things in two words —a colour and an alpha— and
    // the alpha multiplies whatever the caller had already set, which is how the
    // reference's `rgba(0, 0, 0, 0.16)` over the element's own opacity works out.
    ctx.save();
    ctx.globalAlpha = (ctx.globalAlpha || 1) * style.shadowOpacity;
    ctx.fillStyle = style.shadowColor;
    ctx.beginPath();
    traceNotePath(ctx, shadow);
    ctx.fill();
    ctx.restore();

    // The paper.
    ctx.beginPath();
    traceNotePath(ctx, face);
    ctx.fillStyle = style.background;
    ctx.fill();

    // The shadow along the paper's own edge.
    ctx.save();
    ctx.beginPath();
    traceNotePath(ctx, face);
    ctx.clip();
    ctx.lineWidth = style.edgeShadowStrokeWidth;
    ctx.globalAlpha = (ctx.globalAlpha || 1) * style.edgeShadowOpacity;
    ctx.strokeStyle = style.shadowColor;
    ctx.beginPath();
    traceNotePath(ctx, face);
    ctx.stroke();
    ctx.restore();

    if (footer !== null && footer !== undefined) {
        ctx.save();
        ctx.font = "12px Helvetica, Arial, sans-serif";
        ctx.textAlign = "right";
        ctx.direction = "ltr";
        ctx.fillStyle = footer.color;
        if (footer.angle === 0 || footer.angle === undefined) {
            ctx.fillText(footer.text, footer.x, footer.y);
        } else {
            ctx.translate(footer.x, footer.y);
            ctx.rotate(footer.angle);
            ctx.fillText(footer.text, 0, 0);
        }
        ctx.restore();
    }
}

/**
 * The note's outline, one command at a time.
 *
 * The commands are the paper's own — the straight edges and the quadratics of the rounded
 * corners and of the fold — and the path is closed at the end, because the paper is a
 * closed shape.
 *
 * @param ctx A canvas 2D context.
 * @param {object[]} path The commands, in order.
 */
function traceNotePath(ctx, path) {
    for (const command of path) {
        // The command is named by its variant, the way everything else on the wire is.
        if (command.Move) {
            ctx.moveTo(command.Move.point[0], command.Move.point[1]);
        } else if (command.Line) {
            ctx.lineTo(command.Line.point[0], command.Line.point[1]);
        } else {
            const curve = command.Quadratic;
            ctx.quadraticCurveTo(
                curve.control[0],
                curve.control[1],
                curve.point[0],
                curve.point[1],
            );
        }
    }
    ctx.closePath();
}

/**
 * The data URL for an element id: from the cache, or from the boundary once.
 *
 * The result of a miss is cached too, and that is deliberate — including the
 * `undefined` for an element with no bytes. Caching only the hits would mean a frame
 * drawing an empty rectangle asks the kernel again for the same empty answer on every
 * single frame, which is the cost this whole change exists to remove.
 *
 * There is deliberately no "the client already has these bytes" shortcut. An import
 * holds the data URL in its hand and could hand it here directly, saving one crossing
 * per image for the whole life of the document — and in exchange the payload would
 * reach the renderer by two paths, one of which is a cache write somebody has to
 * remember. One crossing per image, once, is not worth a second writer.
 *
 * @param fetchText `(id) => string | undefined`, the boundary call behind `imageText`.
 */
function imageTextFor(id, fetchText) {
    // `has`, not a `get` that treats `undefined` as absent. The two are not the same
    // question: `has` asks whether this id has been answered, and `undefined` *is* an
    // answer — the one for an image element that carries no bytes. The `get` version
    // stored that answer and then could not see it, so an image with no data was asked
    // for again on every single frame: the exact cost this cache exists to remove,
    // paid by precisely the elements for which there is nothing to remove.
    if (imageTextById.has(id)) {
        return imageTextById.get(id);
    }
    const text = fetchText === undefined ? undefined : fetchText(id);
    imageTextById.set(id, text);
    return text;
}

/** Is some *other* id still holding this data URL? */
function urlStillInUse(dataURL) {
    for (const cached of imageTextById.values()) {
        if (cached === dataURL) {
            return true;
        }
    }
    return false;
}

/** Drop a URL's cached decoder, detaching callbacks that could outlive its owner. */
function discardImage(dataURL) {
    const entry = imageCache.get(dataURL);
    if (entry?.img !== null && entry?.img !== undefined) {
        entry.img.onload = null;
        entry.img.onerror = null;
        entry.img = null;
    }
    imageCache.delete(dataURL);
}

/** Drop what is remembered about one element id.
 *
 * Two problems, one call. The element is gone, so keeping its base64 string and its
 * decoded bitmap alive is memory for a picture nobody can see; and Rust lets the same id
 * be inserted again after a deletion, so a cache that outlived the element would paint
 * the *old* picture under the new one — silently, because nothing about the new
 * insertion is wrong. Releasing on deletion is what makes "an id's payload cannot
 * change under the cache" true by construction rather than by convention: the cache
 * entry cannot outlive the element whose id names it.
 *
 * The decoded image is keyed by data URL, not by id, so a second element holding the
 * same string still needs it. The loop that checks is over deletions, never over
 * frames: a deletion is a keystroke and a frame is sixty times a second, and the rule
 * that matters here — no stale bytes and no unbounded growth — is satisfied either way.
 * Skipping the check would be shorter and would cost a silent re-decode every time the
 * user deleted one copy of a duplicated picture.
 *
 * An undo brings the element back and the picture is fetched and decoded again. That is
 * a real cost, paid once per image per undo, and it is the price of not having to
 * reason about whether a restored element's bytes ever changed underneath us.
 *
 * @param id the element id that has just been deleted.
 */
export function forgetImageFor(id) {
    const dataURL = imageTextById.get(id);
    imageTextById.delete(id);
    if (dataURL === undefined || urlStillInUse(dataURL)) {
        return;
    }
    discardImage(dataURL);
}

/**
 * Release the pictures of the elements the scene no longer holds.
 *
 * The per-id release ([`forgetImageFor`]) is what a *deletion* owes: the
 * path that deleted the element knows the id it deleted. The history owes
 * something else — an undo swaps whole scenes, so no deletion happened and no
 * id was reported to anybody — and the answer to "which elements are still
 * here?" is the kernel's.
 *
 * So the client asks and compares: the ids the scene holds are the truth,
 * and every remembered picture whose id the scene does not name is released.
 * The comparison is the client's because the cache is the client's.
 *
 * @param {Iterable<string>} alive the ids the scene holds.
 */
export function releaseGonePictures(alive) {
    const keep = new Set(alive);
    // The keys are copied out first: the release deletes from the very map
    // being walked, and a walk that mutates the map it walks is a walk that
    // skips half of what it meant to see.
    for (const id of [...imageTextById.keys()]) {
        if (!keep.has(id)) {
            forgetImageFor(id);
        }
    }
}

/** Drop every remembered picture.
 *
 * Called when the session is replaced (`restore`), because ids are document-local: a
 * drawing loaded from disk can reuse an id the previous drawing used for a different
 * picture, and a cache that survived would paint the old one. Within one session the
 * per-id release is `forgetImageFor`, which every deletion path calls.
 */
export function forgetImages() {
    for (const dataURL of imageCache.keys()) {
        discardImage(dataURL);
    }
    imageTextById.clear();
}

/** What the picture caches hold right now, for instruments and tests.
 *
 * `urls` is the decode cache, keyed by data URL — duplicated pictures counted once,
 * which is the sharing the cache exists for. `ids` is the per-id map the deletion
 * paths release through; when it and `urls` disagree about a picture, some path
 * deleted an element without releasing it, and that is exactly the leak the AC
 * asked to make localizable. `chars` states the cached payloads' size in the
 * string's own currency — an upper bound, because the decoded bitmaps' true cost
 * belongs to the browser and no counter in this file can see it.
 */
export function imageCacheStats() {
    let chars = 0;
    for (const url of imageCache.keys()) {
        chars += url.length;
    }
    return { urls: imageCache.size, ids: imageTextById.size, chars };
}

/** Paint one text element view.
 *
 * The kernel ships the geometry, the row split and the row advance already
 * resolved (see `FrameItem::Text` in `draw_ops.rs`), so this function does no
 * I/O and no
 * arithmetic about type: it sets the font, translates the canvas to the
 * centre, applies the rotation, and calls `ctx.fillText` once per row.
 *
 * The rows come from the kernel rather than from `body.split("\n")` here,
 * and that is the whole point of the design. The canvas does not interpret
 * `\n` — `fillText` draws it as a control character or ignores it, depending
 * on the browser — so a client-side split is not a convenience, it is a
 * second implementation of a rule the kernel already applied when it
 * decided how tall this box is. Two copies of one rule drift; the box grows
 * to three lines and the paint draws two.
 *
 * An all-empty body is a label with no text. `ctx.fillText("")` is a no-op
 * on every browser, so the guard is about not even asking for the calls.
 *
 * The y offset honours `verticalAlign` by shifting the baseline. The
 * upstream `transformRoughjs` uses the same `top|middle|bottom` matrix
 * on the export side; this is the canvas twin of that, with `top` at the
 * stored y (no offset), `middle` half-way down the box, and `bottom` at
 * `y + height - fontSize`.
 */
export function paintText(
    ctx,
    {
        x,
        y,
        width,
        height,
        angle,
        fontSize,
        fontFamily,
        textAlign,
        verticalAlign,
        lineAdvance,
        lines,
    },
) {
    if (!lines.some((row) => row !== "")) {
        return;
    }
    // The stack of family names is **resolved by the kernel** and travels ready to use:
    // the element carries a number, and the rule that turns the number into faces is
    // the format's (`crates/nextdraw-core/src/font.rs`, upstream's `getFontFamilyString`).
    // So the painter asks for no table and holds none — it writes what it is given,
    // and the SVG exporter writes the same string.
    ctx.font = `${fontSize}px ${fontFamily}`;
    ctx.textBaseline = "top";
    ctx.fillStyle = "#1e1e1e";
    if (textAlign === "center") {
        ctx.textAlign = "center";
    } else if (textAlign === "right") {
        ctx.textAlign = "right";
    } else {
        ctx.textAlign = "left";
    }
    let yOffset = 0;
    if (verticalAlign === "middle") {
        yOffset = height / 2 - fontSize * 0.4;
    } else if (verticalAlign === "bottom") {
        yOffset = height - fontSize;
    }
    const cx = x + width / 2;
    const cy = y + height / 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    // After the rotate, the origin is the box centre. `fillText` writes
    // relative to the *current* origin, so the (x, y) used here is the
    // post-translate coordinate. The baseline (`textBaseline = "top"`)
    // is honoured against the **rotated** y, which is what makes a
    // rotated label readable end-to-end instead of leaning.
    const top = -height / 2 + yOffset;
    for (let row = 0; row < lines.length; row += 1) {
        if (lines[row] === "") {
            continue;
        }
        ctx.fillText(lines[row], -width / 2, top + row * lineAdvance);
    }
    ctx.restore();
}

/**
 * Paint the selection chrome for one element, given the record the kernel
 * produced. The record is the shape of the `chrome` half of
 * `Session::frame` for one id — the kernel computed the AABB, the eight
 * handle squares, and
 * the rotate handle so this function is only canvas calls.
 *
 * The ring is `record.polygon`, whatever the variant: the kernel sends the
 * four corners of the element's (or the set's) padded, turned outline, and a
 * polyline's frame is that same rectangle around its points — upstream draws
 * a rectangle for every selected element
 * (`renderSelectionBorder`, `packages/excalidraw/renderer/interactiveScene.ts:920-973`),
 * so there is one path here and no per-kind branch. An id with no geometry
 * arrives with an empty `polygon` and nothing is drawn.
 *
 * `record.box` is the AABB, and it is **not** what the ring traces. The
 * resize handles and the rotate affordance sit on the unpadded box, because
 * those belong to the gesture and the gesture is cover-based. Ring is the
 * padded outline; handles mark the frame the gesture moves.
 *
 * The style is upstream's: the theme's selection colour, a one-pixel stroke,
 * square corners and no dash for a lone selection; the set's common box is
 * dashed two-and-two (`:2030-2045`). The handles and the rotate dot are the
 * same colour, and the image's ring has no padding — both facts the kernel
 * and this file take from the reference rather than invent.
 *
 * Every number in the record is already in **CSS pixels**: the kernel
 * builds the chrome in screen space, so the ring, the handles and the
 * rotate dot sit where the drawing sits, at any zoom, and the client
 * draws them where they are told. The handle half and the rotate radius
 * are CSS constants for the same reason — a grab region that grew with
 * the zoom would let the user resize from further away than the handle
 * they can see.
 *
 * The optional `gesture` names the vertex or segment a drag is holding, so
 * the one under the hand is drawn filled. A move, a resize or a turn passes
 * nothing: its chrome is the kernel's chrome around the scene the release
 * keeps, already where the drag put it, and it is drawn whole — ring,
 * handles and rotate dot — the way the desktop draws a lone selection
 * while it is transformed.
 */
// Every record that carries handles carries the kernel's eight, and the
// desktop draws their four corners (`DEFAULT_OMIT_SIDES`,
// `packages/element/src/transformHandles.ts:57-63`). Which of the kernel's
// handles are corners is a fact about its naming scheme — a side handle is
// one compass letter, a corner is two — derived here rather than spelled, so
// a kernel that renamed a handle cannot leave the painter drawing a name the
// record no longer carries.
const CORNER_HANDLES = HANDLE_NAMES.filter((name) => name.length === 2);

/**
 * The selection chrome's colour, upstream's `--color-selection`.
 *
 * The theme declares it as `#6965db` in the light theme and `#b4b0ff` in the
 * dark one (`packages/excalidraw/css/theme.scss:82,227`), and the renderer
 * reads it from the editor's computed style (`getSelectionColor`,
 * `packages/excalidraw/renderer/helpers.ts:13-17`). This port paints the light
 * value and lets the canvas's dark-mode filter turn it over, the same way it
 * turns every other colour it paints over.
 *
 * The ring, the resize handles and the rotate dot are all this colour:
 * upstream strokes them with the one `renderConfig.selectionColor`
 * (`renderTransformHandles`, `renderer/interactiveScene.ts:1342-1343`;
 * `renderSelectionBorder`, `:953`).
 */
export const SELECTION_COLOR = "#6965db";

/** The selection outline's stroke, in CSS pixels: upstream's `lineWidth` of one. */
const SELECTION_OUTLINE_WIDTH = 1;

/**
 * The dash of the multi-selection's common box, in CSS pixels.
 *
 * Upstream sets `[2 / zoom]` on a context the zoom has already scaled, which is
 * a two-pixel dash and a two-pixel gap on the screen
 * (`packages/excalidraw/renderer/interactiveScene.ts:2030-2035`). A lone
 * element's ring is solid: the same function leaves `dashed` false for a local
 * selection (`:1929-1930`), and only a remote user or a locked element asks for
 * the eight-and-four dash.
 */
const SELECTION_BOX_DASH = [2, 2];

/**
 * The group being edited draws its own box in upstream's group colour and dash.
 *
 * The reference's `addSelectionForGroupId` strokes the members' common box black
 * (`getThemedColor("#000", theme)`, `renderer/interactiveScene.ts:1871,1954-1957`) with a
 * dash of eight and a gap of four (`lineWidth` and `spaceWidth`, `:940-947`), one CSS
 * pixel wide, whether the group is selected whole or is the group being edited from
 * the inside. The port paints the light value and lets the canvas's dark-mode filter
 * turn it over, as it does for every other colour.
 */
const GROUP_BOX_COLOR = "#000";
const GROUP_BOX_DASH = [8, 4];

export function paintChrome(ctx, record, gesture) {
    // The record kinds the builder emits are the kernel's own (`polygon`,
    // `selection`, published by the vocabulary): a record of another kind
    // never arrives, and an empty chrome is an empty list, so there is no
    // "nothing to draw" marker to test for here. The guard in
    // `wiring.test.mjs` keeps every branch in this file inside the published
    // family — this used to be where the hit answer's `none` was compared
    // against the record's kind, wearing a record's name, and nothing could
    // ever run that branch.
    const half = record.handleHalf ?? 4;
    // The group's box is the one record that is not the selection's colour: it is a
    // dashed black box around the group being edited, and the members' rings keep the
    // selection colour.
    const group = record.kind === "group";
    ctx.save();
    ctx.strokeStyle = group ? GROUP_BOX_COLOR : SELECTION_COLOR;
    ctx.fillStyle = "#ffffff";
    ctx.lineWidth = SELECTION_OUTLINE_WIDTH;
    // The ring, upstream's `renderSelectionBorder`: one path around the four
    // corners the kernel padded and turned, stroked solid for a lone
    // selection and dashed two-and-two for the common box of a set. The
    // padding is the kernel's ([`SELECTION_OUTLINE_PADDING_CSS`]) because it
    // is geometry and the painter does not know the zoom; the style is this
    // file's, because it is not.
    if (Array.isArray(record.polygon) && record.polygon.length > 0) {
        const pts = record.polygon;
        ctx.setLineDash(
            group ? GROUP_BOX_DASH : record.kind === "selection" ? SELECTION_BOX_DASH : [],
        );
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i += 1) {
            ctx.lineTo(pts[i][0], pts[i][1]);
        }
        ctx.closePath();
        ctx.stroke();
    }
    // Upstream draws each handle with a one-pixel line of the same selection
    // colour and, where the canvas has `roundRect`, with corners of two
    // pixels; without it, a plain square
    // (`renderTransformHandles`, `renderer/interactiveScene.ts:1328-1347`).
    // The ring's width is the same one, so there is nothing to reset here;
    // the dash is, and a handle must never inherit the common box's.
    if (record.handles || record.rotate) {
        ctx.setLineDash([]);
    }
    // The resize handles — present on the lone selection's record and on
    // the common box of a resizable selection, absent where the kernel says
    // the kind has none (a two-point line, an elbow, an image). The record
    // carries eight positions and the desktop draws the four **corners**:
    // the sides are omitted from the drawn set upstream
    // (`DEFAULT_OMIT_SIDES`, `packages/element/src/transformHandles.ts:57-63`)
    // and are grabbed along the borders instead.
    if (record.handles) {
        for (const name of CORNER_HANDLES) {
            const [hx, hy] = record.handles[name];
            if (typeof ctx.roundRect === "function") {
                ctx.beginPath();
                ctx.roundRect(hx - half, hy - half, half * 2, half * 2, 2);
                ctx.fill();
                ctx.stroke();
            } else {
                ctx.fillRect(hx - half, hy - half, half * 2, half * 2);
                ctx.strokeRect(hx - half, hy - half, half * 2, half * 2);
            }
        }
    }
    // The rotate handle: a white circle, filled and stroked, with nothing
    // joining it to the frame — upstream draws no stem. The kernel places it
    // above the turned frame, so it is drawn where it is told.
    if (record.rotate) {
        const { handle, radius } = record.rotate;
        // The radius is a CSS constant the kernel already applied (half of
        // the eight-pixel handle); the fallback is that same constant, not a
        // number of this file's own.
        const r = radius ?? 4;
        ctx.beginPath();
        ctx.arc(handle[0], handle[1], r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
    }
    // The points of a line or arrow that is edited, or selected alone. The
    // kernel ships them with the index that names each one and with the
    // radius upstream paints them at (ten while editing, five otherwise); the
    // grab radius is the kernel's own and is wider.
    //
    // They are drawn last because they are the most specific control on the
    // screen: a selected polyline keeps its box and its handles, and its
    // points are painted over them.
    if (record.vertices) {
        const {
            positions,
            midpoints,
            segments,
            pinned,
            radius,
            midpointRadius,
            selected,
        } = record.vertices;
        // The vertex the pointer is holding, if a drag is in flight. It is
        // filled with the accent instead of the white of the others, because
        // the drawing cannot say which of its vertices the hand is on.
        //
        // The kind matters: the number of a segment is not the number of a
        // vertex, and a drag of a segment must not paint a vertex as held.
        const held = gesture?.kind === GESTURES.VERTEX ? (gesture.index ?? null) : null;
        // The segment the pointer is holding, for the same reason.
        const heldSegment =
            gesture?.kind === GESTURES.SEGMENT ? (gesture.index ?? null) : null;
        ctx.setLineDash([]);
        // Every real point is ringed in upstream's violet, one pixel wide
        // (`renderSingleLinearPoint`, `renderer/interactiveScene.ts:219-253`).
        ctx.strokeStyle = "#5e5ad8";
        ctx.lineWidth = 1;
        // The midpoints come first, because a vertex is drawn over the
        // midpoint that shares its pixel — and the vertex wins the pointer
        // too, which is the rule the kernel's hit test follows.
        for (const [, position] of midpoints ?? []) {
            ctx.beginPath();
            ctx.arc(position[0], position[1], midpointRadius ?? 5, 0, Math.PI * 2);
            // The midpoint is the subordinate control: dragging it **adds** a
            // point, while dragging a vertex moves one. Upstream tells them
            // apart by colour —a "phantom point" is a light violet—
            // (`packages/excalidraw/renderer/interactiveScene.ts:239-244`), and
            // the size tells them apart too: the midpoint is half a vertex.
            ctx.fillStyle = "#b197fc";
            ctx.fill();
            // A phantom point has no ring: upstream strokes only the real
            // points (`renderSingleLinearPoint`, same file, `:219-253`).
            ctx.fillStyle = "#ffffff";
        }
        // The handles of the segments of a turning arrow. They sit where the
        // midpoints of a polyline sit —in the middle of the segment— and they
        // are another thing: the handle of a segment **pins** it.
        //
        // Upstream tells a pinned segment from an unpinned one by the **ring**:
        // the two handles are the same size and the two are filled, but the
        // pinned one is stroked and the unpinned one is not —it is a "phantom
        // point", filled with the violet of the midpoints and without a ring
        // (`packages/excalidraw/renderer/interactiveScene.ts:225-253`).
        for (const [index, position] of segments ?? []) {
            const isPinned = (pinned ?? []).includes(index);
            const size = midpointRadius ?? 5;
            ctx.beginPath();
            ctx.arc(position[0], position[1], size, 0, Math.PI * 2);
            if (index === heldSegment) {
                // The hand is on it: the strongest signal there is, and it wins
                // over the ring that tells a pinned segment from an unpinned
                // one.
                ctx.fillStyle = "#1971c2";
                ctx.fill();
                ctx.fillStyle = "#ffffff";
            } else if (isPinned) {
                ctx.fillStyle = "#ffffff";
                ctx.fill();
            } else {
                // The violet of the midpoints: the handle of a segment that is
                // not pinned is a phantom point, and upstream paints it so.
                ctx.fillStyle = "#b197fc";
                ctx.fill();
            }
            if (isPinned) {
                ctx.stroke();
            }
        }
        for (const [index, position] of positions) {
            ctx.beginPath();
            ctx.arc(position[0], position[1], radius, 0, Math.PI * 2);
            if (index === held) {
                // The hand is on it. This is the strongest signal there is, and
                // it wins over the selected colour: the point the pointer is
                // holding is the point the user is moving.
                ctx.fillStyle = "#1971c2";
                ctx.fill();
                ctx.fillStyle = "#ffffff";
            } else if (index === selected) {
                // The picked vertex, filled in the colour upstream fills a
                // selected point in
                // (`packages/excalidraw/renderer/interactiveScene.ts:239-244`):
                // a blue-violet that is neither the white of the rest nor the
                // accent of the hand. It is the vertex the `Supr` would take.
                ctx.fillStyle = "#8683e2";
                ctx.fill();
                ctx.fillStyle = "#ffffff";
            } else {
                ctx.fill();
            }
            ctx.stroke();
        }
        // The hover's own disk: the point the pointer last moved over, laid
        // as a translucent light **over** the rings — upstream renders the
        // handles first and the highlight after them
        // (`packages/excalidraw/renderer/interactiveScene.ts:1793,1818`), and
        // a light over a ring washes the ring the same way on both sides.
        //
        // A drag of a point or a midpoint holds the drawing's strongest signal
        // already, and upstream silences the highlight while
        // `selectedLinearElement.isDragging`
        // (`packages/excalidraw/renderer/interactiveScene.ts:1788`), so the
        // hand's colour alone says where the point is going.
        //
        // The colour is upstream's own light value
        // (`rgba(105, 101, 219, 0.4)`, `interactiveScene.ts:204`): the port
        // paints the light value and lets the canvas's dark-mode filter turn
        // it over, the way it turns every other colour it paints over.
        const hover = record.vertices.hover ?? null;
        const aDragHoldsThePoint =
            gesture?.kind === GESTURES.VERTEX || gesture?.kind === GESTURES.SEGMENT;
        if (hover !== null && !aDragHoldsThePoint) {
            const underTheDisk = positions.find(([index]) => index === hover);
            if (underTheDisk !== undefined) {
                ctx.beginPath();
                ctx.arc(underTheDisk[1][0], underTheDisk[1][1], radius, 0, Math.PI * 2);
                ctx.fillStyle = "rgba(105, 101, 219, 0.4)";
                ctx.fill();
            }
        }
    }
    ctx.restore();
}

export function paintCropMode(ctx, imageBox, region) {
    const { left, top, right, bottom } = imageBox;
    ctx.save();
    ctx.fillStyle = "rgba(0, 0, 0, 0.48)";
    ctx.fillRect(left, top, right - left, region.top - top);
    ctx.fillRect(left, region.bottom, right - left, bottom - region.bottom);
    ctx.fillRect(left, region.top, region.left - left, region.bottom - region.top);
    ctx.fillRect(region.right, region.top, right - region.right, region.bottom - region.top);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([]);
    ctx.strokeRect(region.left, region.top, region.right - region.left, region.bottom - region.top);
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#1971c2";
    const cx = (region.left + region.right) / 2;
    const cy = (region.top + region.bottom) / 2;
    for (const [x, y] of [
        [region.left, region.top], [cx, region.top], [region.right, region.top],
        [region.right, cy], [region.right, region.bottom], [cx, region.bottom],
        [region.left, region.bottom], [region.left, cy],
    ]) {
        ctx.fillRect(x - 4, y - 4, 8, 8);
        ctx.strokeRect(x - 4, y - 4, 8, 8);
    }
    ctx.restore();
}

/**
 * Paint the region a crop gesture is choosing, over the image it belongs to.
 *
 * The rectangle is the drag's own extent in screen pixels, drawn as an outline
 * over the image's box — the picture underneath shows what the image shows now,
 * and the outline says what it would show if the drag landed here.
 *
 * @param ctx A canvas 2D context.
 * @param {{x: number, y: number, width: number, height: number}} dragScreen The
 *   drag's extent, in screen pixels.
 */
export function paintCropGhost(ctx, dragScreen) {
    ctx.save();
    ctx.strokeStyle = "#1971c2";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(
        dragScreen.x,
        dragScreen.y,
        dragScreen.width,
        dragScreen.height,
    );
    ctx.restore();
}

/**
 * Paint the line a click-by-click drawing is carrying.
 *
 * The growing drawing is a client affair — the document is written once,
 * when the drawing ends — so the ink the user aims with is painted here
 * rather than read out of the kernel: the path the clicks have fixed plus
 * the rubber band that follows the pointer, which is the last point of
 * the same list. The pen is the one the element will be drawn with when
 * it is written — a fresh shape carries the kernel's own defaults, and
 * these are they — because a rubber band that promised a different
 * line than the one that appears would be an affordance that lies.
 *
 * @param ctx A canvas 2D context.
 * @param {object} state The mode's state: the origin in scene coordinates
 *   and the path relative to it.
 * @param {object} session The session, for the scene-to-screen transform.
 */
export function paintMultipointGhost(ctx, state, session) {
    ctx.save();
    ctx.strokeStyle = "#1e1e1e";
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    for (const [index, [x, y]] of state.points.entries()) {
        const screen = session.sceneToScreen(state.origin.x + x, state.origin.y + y);
        if (index === 0) {
            ctx.moveTo(screen[0], screen[1]);
        } else {
            ctx.lineTo(screen[0], screen[1]);
        }
    }
    ctx.stroke();
    ctx.restore();
}

/**
 * Paint one op: the arm for each variant of the kernel's `DrawOp`.
 *
 * This is the client's half of "an export is not a second renderer": `to_svg`
 * consumes the same `DrawOp` list, so a variant with no arm here is a shape the
 * kernel produces and the screen never shows. It lives in this module rather
 * than in `index.js` because that is what makes it testable — the arm for a
 * variant is a claim about *which pen* reaches the canvas, and a claim about a
 * pen cannot be made without a context to watch.
 *
 * It is one op rather than a list because a frame is no longer a list of marks:
 * the frame is a list of *items*, each of which is a mark or a text, and the
 * order between them is the picture's z-order. A mark arrives here one at a
 * time because that is the only way to paint in the frame's order.
 *
 * @param ctx A canvas 2D context.
 * @param {object} op One `DrawOp`: `{ Outline: {…} }`, `{ Polyline: {…} }`,
 *   `{ Arrowhead: {…} }`, `{ Image: {…} }`, `{ Frame: {…} }`, `{ FreeDraw: {…} }`,
 *   `{ StickyNote: {…} }` or `{ Hatch: {…} }`.
 * @param {Function} [fetchText] `(id) => string | undefined`, the boundary call behind
 *   `Session::imageText`. Omitted only by callers that hold no images.
 */
export function paintOp(ctx, op, fetchText) {
    if (op.Outline) {
        paintShape(ctx, op.Outline, true);
    } else if (op.Polyline) {
        paintShape(ctx, op.Polyline, false);
    } else if (op.Arrowhead) {
        // A head is two strokes and not a wedge: the reference draws one line to
        // each barb and leaves the paper between them, and a filled triangle is a
        // different shape with a different ink — a solid mark where the reference
        // has none. It is stroked like any other stroke, with no interior to fill.
        paintShape(ctx, op.Arrowhead, false);
    } else if (op.Image) {
        paintImage(ctx, op.Image, fetchText);
    } else if (op.Frame) {
        paintFrameElement(ctx, op.Frame);
    } else if (op.FreeDraw) {
        paintFreeDraw(ctx, op.FreeDraw);
    } else if (op.StickyNote) {
        paintStickyNote(ctx, op.StickyNote);
    } else if (op.Hatch) {
        paintHatch(ctx, op.Hatch);
    }
}

/**
 * Paint a list of ops, in the order they are given.
 *
 * The frame no longer arrives as a list of ops — it arrives as a list of items
 * and the painter walks that — but this walk survives for the callers that
 * genuinely have a list of marks and nothing else, and for the benchmark that
 * measures the pen cost of a mark without the frame around it.
 *
 * @param ctx A canvas 2D context.
 * @param {object[]} ops The ops to paint, in order.
 * @param {Function} [fetchText] `(id) => string | undefined`, the boundary call behind
 *   `Session::imageText`. Omitted only by callers that hold no images.
 */
export function paintOps(ctx, ops, fetchText) {
    for (const op of ops) {
        paintOp(ctx, op, fetchText);
    }
}

/**
 * Paint a whole frame, in the one order the picture has.
 *
 * ## Why there is one walk and not two
 *
 * The kernel used to hand the client two lists: `ops`, which is every tesselated
 * mark (shapes, polylines, arrowheads, images) and `textViews`, which is the
 * elements whose payload is a string the op pipeline does not carry. A text
 * element is measured by the kernel but not tesselated, and the rows arrive
 * already split.
 *
 * Two lists cannot say which of a mark and a label is on top. The relative order
 * was decided by which array each of them happened to land in, which is a data
 * structure leaking into the picture: the scene knows which element is above
 * which, and the order was thrown away on the way out. So the frame now carries
 * **one** list of items, each of which is a mark or a text, and the order of the
 * list is the scene's order.
 *
 * The order is the scene's own: the order the elements are stored in, which is
 * the order upstream's Z index defines and the order upstream's own renderers
 * paint in. `staticScene.ts` walks the visible elements and renders one at a
 * time; `staticSvgScene.ts` walks the elements and renders one at a time.
 * Neither groups the text on top of the strokes. The grouping that used to be
 * here came from a reading of upstream that the upstream source does not
 * support, and it had a visible consequence: a rectangle inserted over a label
 * left the label showing on top of it.
 *
 * @param ctx A canvas 2D context.
 * @param {{items: object[]}} frame The `frame()` answer, whole.
 * @param {Function} [fetchText] `(id) => string | undefined`, the boundary call behind
 *   `Session::imageText`. Omitted only by callers that hold no images.
 * @param {Set<string>} [dimmedIds] The elements the eraser has marked for deletion. They are
 *   drawn faded, because upstream draws them faded
 *   (`ELEMENT_READY_TO_ERASE_OPACITY`, `packages/element/src/renderElement.ts`) and an eraser
 *   that shows no sign of what it is about to remove is an eraser the user cannot aim.
 */
export function paintFrame(ctx, frame, fetchText, dimmedIds) {
    // The clips, gathered **before** anything is painted.
    //
    // A frame's border is one item among many, and it can come after the children it
    // holds: the order of the items is the scene's order, and a frame drawn around an
    // existing drawing is above what it encloses. So the clip cannot be learned when the
    // frame's own item is reached — by then a child may already have been painted
    // unclipped.
    //
    // The list of what to clip comes from the frame's own op, which carries it
    // (`children`): the kernel says which elements the frame holds, and the client only
    // says *where* to cut them. The box the clip is made with is the same op's box.
    const clips = new Map();
    for (const item of frame.items) {
        const op = item.Mark && item.Mark.Frame;
        if (!op) {
            continue;
        }
        // The exempt children ride in the same op (`unclipped`): the arrows and
        // the labels bound to arrows are never clipped by the frame they live
        // in, because an arrow is a *connection* — it ties what it ties even
        // when the frame's border runs between them, and a connection whose far
        // half vanishes at the border is a picture that lies. Upstream's
        // `isFrameClippable` (`packages/element/src/frame.ts`, PR #12516); the
        // kernel resolves the relationship and names the ids here.
        const unclipped = new Set(op.unclipped ?? []);
        for (const childId of op.children ?? []) {
            if (unclipped.has(childId)) {
                continue;
            }
            clips.set(childId, op);
        }
    }
    for (const item of frame.items) {
        const id = item.Mark ? markId(item.Mark) : item.Text ? item.Text.id : null;
        const clip = id === null ? undefined : clips.get(id);
        if (clip) {
            ctx.save();
            ctx.beginPath();
            // The clip is the frame's own shape, with the same rounded corners the
            // border has: upstream's `frameClip`
            // (`packages/excalidraw/renderer/staticScene.ts:189-213`) makes the
            // clip with a `roundRect` of the frame's radius and falls back to a
            // `rect` when the browser has no `roundRect`, which is exactly what
            // `paintFrameElement` does with the border it draws. A clip with
            // square corners and a border with round ones would cut a corner
            // that the frame itself does not cover.
            if (typeof ctx.roundRect === "function") {
                ctx.roundRect(
                    clip.x,
                    clip.y,
                    clip.width,
                    clip.height,
                    clip.style.radius,
                );
            } else {
                ctx.rect(clip.x, clip.y, clip.width, clip.height);
            }
            ctx.clip();
        }
        if (item.Mark) {
            paintMark(ctx, item.Mark, fetchText, dimmedIds);
        } else if (item.Text) {
            paintText(ctx, item.Text);
        }
        if (clip) {
            ctx.restore();
        }
    }
}

/**
 * Paint one mark, faded when the eraser has marked it.
 *
 * The fading is a *multiplication*, and that is the whole reason this is a function and not
 * a flag on `paintOp`: upstream multiplies the element's own opacity by the pending-erasure
 * factor (`opacity *= ELEMENT_READY_TO_ERASE_OPACITY / 100`), so a shape that was already
 * half transparent is one tenth transparent while it waits to be erased. A flag that turned
 * the alpha *off* at 0.2 would be brighter than the element it replaced, and an element that
 * brightens when the eraser touches it is the opposite of what the eraser does.
 *
 * @param ctx A canvas 2D context.
 * @param {object} mark One `DrawOp`.
 * @param {Function} [fetchText] The image payload's boundary call.
 * @param {Set<string>} [dimmedIds] The elements the eraser has marked.
 */
function paintMark(ctx, mark, fetchText, dimmedIds) {
    const id = markId(mark);
    if (dimmedIds === undefined || id === null || !dimmedIds.has(id)) {
        paintOp(ctx, mark, fetchText);
        return;
    }
    ctx.save();
    ctx.globalAlpha = (ctx.globalAlpha || 1) * ERASE_PENDING_OPACITY;
    paintOp(ctx, mark, fetchText);
    ctx.restore();
}

/**
 * The element a mark belongs to, or `null` when the mark names none.
 *
 * Every variant of the kernel's `DrawOp` carries its element's id, and the variant is what
 * wraps it: the mark arrives as `{ Outline: { id, … } }`. The id is read out of the variant
 * rather than out of a fixed field name, because a mark that grew a new variant would
 * otherwise have to grow a second place to be looked up in — and the place that forgets is
 * the place that silently stops fading.
 *
 * @param {object} mark One `DrawOp`.
 * @returns {string | null}
 */
function markId(mark) {
    for (const variant of Object.values(mark)) {
        if (variant !== null && typeof variant === "object" && typeof variant.id === "string") {
            return variant.id;
        }
    }
    return null;
}

/**
 * Paint the ink of a freehand stroke.
 *
 * A freehand stroke is not a shape with an outline. Upstream's ink is the *contour* of
 * the stroke, and it is painted by **filling** that contour with the stroke colour —
 * `context.fillStyle = element.strokeColor; context.fill(createPath(shape))`
 * (`packages/element/src/renderElement.ts`). It is never stroked, because stroking the
 * contour would draw a second, wrong edge around the ink.
 *
 * The contour is closed with the same quadratic rule upstream uses for the exported
 * file: `M p0 Q p0 med01 p1 med12 … pLast medLast0 L p0 Z` (`getSvgPathFromStroke`,
 * `packages/element/src/shape.ts`). That rule is not a choice — upstream builds one SVG
 * path and hands it to `Path2D` for the canvas (`getCreatePath`,
 * `packages/excalidraw/renderer/renderEnvironment.ts`), so the screen and the file are
 * literally the same path. The exporter in `crates/nextdraw-core/src/svg.rs` writes the
 * same rule for the same reason, and `client/wiring.test.mjs` guards that the two agree.
 *
 * A `Q` command takes a control point and an endpoint, and SVG's shorthand would repeat
 * the previous endpoint as the next control. Upstream writes both halves explicitly and
 * so does this: the control is the point itself and the endpoint is the midpoint of that
 * point and the next one. The path therefore runs through the midpoints of the contour's
 * own points rather than through the points, which is upstream's behaviour and not a
 * defect of this port.
 *
 * @param ctx A canvas 2D context.
 * @param {{points: number[][]}} op The `FreeDraw` op's payload.
 */
export function paintFreeDraw(ctx, { points, strokeColor, opacity }) {
    if (!points || points.length === 0) {
        return;
    }
    // The ink is the element's own colour — upstream paints the freehand contour with
    // `element.strokeColor` (`context.fillStyle = element.strokeColor`,
    // `packages/element/src/renderElement.ts:532`) — and the opacity is the element's,
    // multiplied into whatever the caller had for the same reason the shapes' is.
    const faded = opacity !== undefined && opacity < 100;
    // The same buffer the shapes compose into when they are translucent: upstream's
    // freehand rides the per-element canvas like every other mark
    // (`renderElement.ts:1132`), and a translucent contour composed directly
    // differs from the reference by the same channel PAINT-008 measured.
    if (faded && scratchPool !== null) {
        paintElementBuffer(ctx, opacity, (target) => {
            traceStrokePath(target, points);
            target.fillStyle = strokeColor ?? STROKE;
            target.fill();
        }, points, 2);
        return;
    }
    if (faded) {
        ctx.save();
        ctx.globalAlpha = (ctx.globalAlpha || 1) * (opacity / 100);
    }
    traceStrokePath(ctx, points);
    ctx.fillStyle = strokeColor ?? STROKE;
    ctx.fill();
    if (faded) {
        ctx.restore();
    }
}

/**
 * Trace the closed path of a stroke's contour.
 *
 * The rule is upstream's `getSvgPathFromStroke(points, true)`: `M p0 Q p0 med01 p1 med12 …`
 * — the path runs through the *midpoints* of the contour's own points rather than through
 * the points, and closes on the first one. It is written down here once because two
 * things need it: the ink of a freehand stroke and the ink of the eraser's trail. Both are
 * the contour of a stroke, both are filled rather than stroked, and both are the same path
 * upstream builds (`packages/element/src/shape.ts` and `packages/excalidraw/animatedTrail.ts`).
 *
 * A `Q` command takes a control point and an endpoint, and SVG's shorthand would repeat the
 * previous endpoint as the next control. Upstream writes both halves explicitly and so does
 * this: the control is the point itself and the endpoint is the midpoint of that point and
 * the next one.
 *
 * @param ctx A canvas 2D context.
 * @param {number[][]} points The contour, in the space the context is in.
 */
function traceStrokePath(ctx, points) {
    const max = points.length - 1;
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (let i = 0; i <= max; i += 1) {
        const next = points[i + 1] ?? points[0];
        const midX = (points[i][0] + next[0]) / 2;
        const midY = (points[i][1] + next[1]) / 2;
        ctx.quadraticCurveTo(points[i][0], points[i][1], midX, midY);
    }
    ctx.lineTo(points[0][0], points[0][1]);
    ctx.closePath();
}

/**
 * Paint the ink of the eraser's trail.
 *
 * The trail is the *contour* of the eraser's stroke, exactly as a freehand stroke's ink is
 * the contour of its stroke, and it is painted the same way: the closed path is **filled**,
 * never stroked. Upstream builds one SVG path and hands it to the browser, so the trail and
 * the freehand ink are literally the same path (`getSvgPathFromStroke`, `curve: true`).
 *
 * The colour is upstream's own: a translucent wash of the theme's colour, so the trail
 * reads as a shadow travelling over the drawing rather than as another stroke of it.
 *
 * @param ctx A canvas 2D context.
 * @param {number[][]} trail The contour, in screen coordinates.
 */
/** The white upstream seeds the fillStyle with, in case the paper cannot parse. */
const COLOR_WHITE = "#ffffff";

/** The opaque hexes upstream skips the clear for (`bootstrapCanvas`, `helpers.ts`). */
const OPAQUE_HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * Paint the document's paper, the way upstream's `bootstrapCanvas` does
 * (`renderer/helpers.ts:73`).
 *
 * The paper is **document state** — the frame's `background`, which is the
 * envelope's `appState.viewBackgroundColor` riding the frame —
 * which is the envelope's `appState.viewBackgroundColor` — and it goes into
 * the canvas before anything else draws on it. The reason is a difference a
 * pixel instrument can measure: a translucent fill composed over an opaque
 * paper *inside* the canvas rounds once, while the same fill drawn on a
 * transparent canvas and composed later rounds three times (premultiplied,
 * un-premultiplied, composed), and the third rounding is a channel the
 * reference does not have. That was the divergence PAINT-008 carried, and
 * painting the paper is the door that closes it.
 *
 * The branch is upstream's own, verbatim in shape: an opaque hex repaints
 * every pixel so the clear would be redundant and is skipped; anything else
 * is cleared first so the previous frame cannot bleed through; and
 * `"transparent"` clears and fills nothing. The fillStyle is seeded with
 * white before the paper so a value the canvas cannot parse paints white —
 * the canvas silently keeps a fillStyle it rejects, and a stale colour from
 * a previous frame is not a paper.
 *
 * The theme's filter, if one is set on the context, covers the paper like it
 * covers everything else the frame draws: white inverted by the dark filter
 * is `#121212`, which is exactly the value the stylesheet used to carry —
 * the page's paper is the same paper, derived from the same inversion.
 *
 * @param ctx A canvas 2D context.
 * @param {string} paper The document's paper, as the frame carries it.
 * @param {number} width The canvas width, in CSS pixels.
 * @param {number} height The canvas height, in CSS pixels.
 */
/**
 * Whether the paper is an opaque hex, as `paintPaper` decides it.
 *
 * The static layer must not hold a translucent paper on a glass it copies
 * afterwards (PAINT-008: the copy composes a second time), so the paint path
 * asks this to step aside — and it asks the SAME rule `paintPaper` applies,
 * exported rather than restated, because a second spelling of opacity is the
 * kind of drift the copy exists to prevent.
 *
 * @param {string} paper the frame's background.
 * @returns {boolean} whether `paintPaper` will fill opaquely.
 */
export function isOpaquePaper(paper) {
    return paper !== "transparent" && OPAQUE_HEX.test(paper);
}

export function paintPaper(ctx, paper, width, height) {
    if (paper !== "transparent") {
        ctx.fillStyle = COLOR_WHITE;
        ctx.fillStyle = paper;
    }
    if (paper !== "transparent" && OPAQUE_HEX.test(paper)) {
        ctx.fillRect(0, 0, width, height);
        return;
    }
    ctx.clearRect(0, 0, width, height);
    if (paper !== "transparent") {
        ctx.fillRect(0, 0, width, height);
    }
}

/**
 * Cut the paper away where a web embed's page shows.
 *
 * The embeddable layer is a DOM layer **under** the canvas, and an opaque
 * paper would hide every page it hosts: upstream stacks its iframe layer
 * above the static canvas and below the interactive one, and the port's
 * answer is the same picture with one canvas — the paper is cut away inside
 * the frame's box, the page shows through the hole, and the ink drawn after
 * it stays above the page. The boxes are the kernel's own overlay answer for
 * this frame, in the same pixels the layer is positioned with, so the hole
 * and the page cannot disagree about where the frame is.
 *
 * A turned frame punches a straight hole, and its page sits straight in it —
 * the layer positions boxes, not rotations, so hole and page still agree.
 *
 * @param ctx A canvas 2D context.
 * @param {Array<{x: number, y: number, width: number, height: number}>} boxes The embeddable overlays.
 */
export function punchEmbeddableHoles(ctx, boxes) {
    for (const box of boxes) {
        ctx.clearRect(box.x, box.y, box.width, box.height);
    }
}

/** The grid reads as furniture, not as ink: one faint stroke, no dash. */
const GRID_COLOR = "rgba(0, 0, 0, 0.15)";

/** The guide colour answers "you are aligned now", so it is loud on purpose. */
const SNAP_GUIDE_COLOR = "#e268fa";

/**
 * The binding hint's own two colours, upstream's light-theme values
 * (`BINDING_HIGHLIGHT_RGB`, `BINDING_MIDPOINT_COLOR`, `interactiveScene.ts:123-132`).
 */
export const BINDING_HIGHLIGHT_COLOR = "rgb(106, 189, 252)";
export const BINDING_MIDPOINT_DOT_COLOR = "rgba(65, 65, 65, 0.5)";

/**
 * Stroke the kernel's grid lines, straight across the canvas.
 *
 * `lines` is the `gridLines()` answer — `[x1, y1, x2, y2]` screen-pixel
 * segments whose step, pitch floor and viewport conversion were all decided
 * on the Rust side. This strokes what it is given and answers nothing: a
 * client that recomputed the pitch or the multiple would be the second
 * place precision lives (ADR-007), and the kernel already answers empty for
 * the three "no grid" cases — off, no area, an unpaintable pitch — so an
 * empty list here is silence, not a defect.
 *
 * @param ctx A canvas 2D context.
 * @param {Array<number[]>} lines The kernel's `gridLines()` answer.
 */
export function paintGridLines(ctx, lines) {
    if (!Array.isArray(lines) || lines.length === 0) {
        return;
    }
    ctx.save();
    ctx.strokeStyle = GRID_COLOR;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const [x1, y1, x2, y2] of lines) {
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
    }
    ctx.stroke();
    ctx.restore();
}

/**
 * Paint the alignment guides a gesture in flight has locked onto.
 *
 * `guides` is the guide half of the `snapPreview()` answer: `{axis, at}`
 * pairs whose `at` is already a screen pixel. A vertical guide spans the
 * canvas height at `at` and a horizontal one its width — the kernel names
 * the line, the canvas names its extent. They are furniture of the gesture:
 * the commit paints none of its own, so nothing here outlives pointerup.
 *
 * @param ctx A canvas 2D context.
 * @param {Array<{axis: string, at: number}>} guides The kernel's guides.
 * @param {number} width The canvas width, in CSS pixels.
 * @param {number} height The canvas height, in CSS pixels.
 */
export function paintSnapGuides(ctx, guides, width, height) {
    if (!Array.isArray(guides) || guides.length === 0) {
        return;
    }
    ctx.save();
    ctx.strokeStyle = SNAP_GUIDE_COLOR;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const guide of guides) {
        if (guide.axis === "vertical") {
            ctx.moveTo(guide.at, 0);
            ctx.lineTo(guide.at, height);
        } else if (guide.axis === "horizontal") {
            ctx.moveTo(0, guide.at);
            ctx.lineTo(width, guide.at);
        }
    }
    ctx.stroke();
    ctx.restore();
}

/**
 * Paint the shape the kernel says a held arrow end would tie to: its ideal outline
 * (no roughness — the reference strokes the deconstructed ideal, not the drawn path)
 * in upstream's highlight colour, and the midpoint dots the same painter lays under
 * the pointer's reach. Every number is already a screen pixel — the coordinates, the
 * pen's width and the dots' radius alike: the kernel's viewport did the conversion
 * and its own sizing, the same crossing the chrome rides in on (ADR-007), so the
 * painter draws what it is given and holds no second opinion about any of it.
 *
 * @param ctx A canvas 2D context.
 * @param {object | null} hint The kernel's `{width, dotRadius, lines, curves, ellipse, midpoints}`
 *   for the suggested shape, or nothing.
 */
export function paintBindingSuggestion(ctx, hint) {
    if (!hint || typeof hint !== "object") {
        return;
    }
    ctx.save();
    ctx.lineWidth = hint.width;
    ctx.strokeStyle = BINDING_HIGHLIGHT_COLOR;
    for (const line of hint.lines ?? []) {
        if (!Array.isArray(line) || line.length !== 4 || !line.every(Number.isFinite)) {
            continue;
        }
        ctx.beginPath();
        ctx.moveTo(line[0], line[1]);
        ctx.lineTo(line[2], line[3]);
        ctx.stroke();
    }
    for (const curve of hint.curves ?? []) {
        if (!Array.isArray(curve) || curve.length !== 8 || !curve.every(Number.isFinite)) {
            continue;
        }
        ctx.beginPath();
        ctx.moveTo(curve[0], curve[1]);
        ctx.bezierCurveTo(curve[2], curve[3], curve[4], curve[5], curve[6], curve[7]);
        ctx.stroke();
    }
    const ellipse = hint.ellipse;
    if (Array.isArray(ellipse) && ellipse.length === 4 && ellipse.every(Number.isFinite)) {
        ctx.beginPath();
        ctx.ellipse(ellipse[0], ellipse[1], ellipse[2], ellipse[3], 0, 0, Math.PI * 2);
        ctx.stroke();
    }
    // The dots ride after the outline, the way the reference lays them: one
    // reachable midpoint for a simple arrow, none once the pointer is inside.
    ctx.fillStyle = BINDING_MIDPOINT_DOT_COLOR;
    for (const midpoint of hint.midpoints ?? []) {
        if (
            !Array.isArray(midpoint) ||
            midpoint.length !== 2 ||
            !midpoint.every(Number.isFinite)
        ) {
            continue;
        }
        ctx.beginPath();
        ctx.arc(midpoint[0], midpoint[1], hint.dotRadius, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();
}

/** Paint the scene-space binding targets already projected into screen pixels. */
export function paintBindingMidpoints(ctx, points) {
    if (!Array.isArray(points) || points.length === 0) {
        return;
    }
    ctx.save();
    ctx.fillStyle = "#b197fc";
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5;
    for (const point of points) {
        if (!Array.isArray(point) || point.length !== 2 || !point.every(Number.isFinite)) {
            continue;
        }
        ctx.beginPath();
        ctx.arc(point[0], point[1], 4, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();
    }
    ctx.restore();
}

export function paintEraserTrail(ctx, trail) {
    if (!trail || trail.length < 2) {
        return;
    }
    traceStrokePath(ctx, trail);
    ctx.fillStyle = ERASER_TRAIL;
    ctx.fill();
}

/** The trail's width at full brightness, in CSS pixels — this port's own number. */
const LASER_WIDTH = 6;

/**
 * Paint the laser pointer's trail: a red comet that fades as it goes.
 *
 * The brightness of every point is the trail module's answer — the smaller of
 * the point's remaining time and its distance from the head, eased
 * (`client/laser.mjs`) — and this function only renders it. It is drawn as a
 * **tapered stroke**, segment by segment, rather than as upstream's filled
 * variable-width path (`laserTrails.ts` builds one SVG path per trail): the
 * comet is the same shape either way at a pointer's scale, and a stroke is
 * what this canvas already speaks. The divergence is recorded in
 * `docs/PARITY.md` beside the laser row.
 *
 * The width is this port's own number — upstream's width lives inside its
 * `laser-pointer` package's path rendering — and it is declared here rather
 * than dressed up as a fact borrowed from the reference.
 *
 * An empty trail draws nothing: the decay loop asks one frame past the last
 * living point, and that frame costs one size computation and no strokes.
 *
 * @param ctx A canvas 2D context.
 * @param {Array<{x: number, y: number, at: number}>} points The alive trail, oldest first, in screen pixels.
 * @param {number} now The clock, in milliseconds — the instant the trail is being drawn at.
 * @param {string | null} [peerId] The room identity; outside a room the trail remains red.
 */
export function paintLaserTrail(ctx, points, now, peerId = null) {
    if (!points || points.length === 0) {
        return;
    }
    const sizes = laserSizes(points, now);
    ctx.save();
    ctx.strokeStyle = peerId === null ? LASER_COLOR : peerColor(peerId);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    // Each segment takes the *dimmer* of its two ends, so a segment that
    // reaches back into the dark tail never paints brighter than the point
    // it is leaving behind.
    for (let i = 1; i < points.length; i += 1) {
        const size = Math.min(sizes[i], sizes[i - 1]);
        if (size <= 0) {
            continue;
        }
        ctx.beginPath();
        ctx.globalAlpha = size;
        ctx.lineWidth = LASER_WIDTH * size;
        ctx.moveTo(points[i - 1].x, points[i - 1].y);
        ctx.lineTo(points[i].x, points[i].y);
        ctx.stroke();
    }
    ctx.restore();
}

/** Paint one op.
 *
 * `closed` is `true` for an outline and `false` for a polyline. It is passed rather than
 * derived from the field names because the op arrives as `{ Outline: {...} }` and its
 * fields are already unpacked by the caller, which is the only place in the client that
 * knows which variant it is holding.
 *
 */
export function paintShape(
    ctx,
    {
        points,
        strokes,
        fillStyle,
        strokeStyle,
        strokeWidth,
        strokeColor,
        backgroundColor,
        opacity,
    },
    closed,
) {
    if (points.length < 2) {
        return;
    }
    // The stroke width is the third member of the per-element style trilogy
    // (H4.18 fill, H4.19 stroke, H4.20 width), and it is a **number** — the
    // same number the model stores and the same number the SVG exporter
    // writes. It used to arrive as a token that this file turned into pixels
    // through a table of its own, which meant two tables saying what `medium`
    // was: one in the kernel and one here, free to disagree. The width now
    // crosses as the number it is, so the canvas strokes at exactly what the
    // file says and there is nothing left to translate.
    //
    // The fallback is the pen's width, which is the model's own default, so an
    // op that omits the field paints like a new element rather than like
    // something from a vocabulary that no longer exists.
    const width = strokeWidth ?? LINE_WIDTH;
    // The colours are the **element's own**, since H6.14: the op carries them and the
    // canvas paints what it is told. Before that the ink was the pen's — one black for
    // the whole drawing — and a document that said red was drawn in black, with the red
    // sitting in the file where nobody could see it.
    //
    // The fallback is the pen's colour, so an op that arrives without them paints like a
    // new element rather than like nothing at all.
    const ink = strokeColor ?? STROKE;
    const paper = backgroundColor ?? FILL;
    // The element's own opacity, multiplied into whatever alpha the caller had.
    //
    // Multiplied and not assigned, because the caller may be painting an element the
    // eraser has marked, and upstream multiplies its pending-erasure factor into the
    // element's own opacity (`opacity *= ELEMENT_READY_TO_ERASE_OPACITY / 100`,
    // `packages/element/src/renderElement.ts:197`). Assigning would throw the fade away
    // and an element would brighten when the eraser touched it.
    const faded = opacity !== undefined && opacity < 100;
    // A translucent shape composes in its own buffer, the way upstream's static
    // canvas renders every element (`renderElement.ts:1245`): the marks go down
    // at full alpha in a buffer of their own, and the buffer lands on the scene
    // at the element's alpha. The direct draw below is the fallback the pure
    // suite records — the browser entry binds the buffer factory at boot.
    if (faded && scratchPool !== null) {
        paintElementBuffer(ctx, opacity, (target) => {
            if (closed) {
                paintInterior(target, points, fillStyle, paper, width);
            }
            paintOutline(target, points, strokes, strokeStyle, width, closed, ink);
        }, points, width);
        return;
    }
    if (faded) {
        ctx.save();
        ctx.globalAlpha = (ctx.globalAlpha || 1) * (opacity / 100);
    }
    if (closed) {
        paintInterior(ctx, points, fillStyle, paper, width);
    }
    paintOutline(ctx, points, strokes, strokeStyle, width, closed, ink);
    if (faded) {
        ctx.restore();
    }
}

// The browser's canvas builder, bound once at boot like the image-decode hook
// above. The faded-element buffer needs a real canvas to compose into, and the
// renderer has no document of its own — the browser entry binds the factory,
// and until something binds one the faded path falls back to drawing directly,
// which is what the pure suite records.
let scratchPool = null;

/** How many idle canvases the pool keeps; the rest are left to the collector. */
export const SCRATCH_POOL_LIMIT = 8;

/**
 * A pool of scratch canvases, so a frame full of translucent elements reuses
 * the canvases of the frame before instead of building one per element.
 *
 * `acquire` hands out a canvas of the asked size that holds no pixels: a
 * resize clears it, and a canvas that already has the size is cleared
 * explicitly, so nothing of the previous use shows through. `release` takes it
 * back, and only once the caller is done with it. The pool never grows past
 * the number of canvases in use at once, and keeps at most `limit` idle.
 *
 * @param {() => any} factory
 * @param {number} [limit]
 */
export function createScratchPool(factory, limit = SCRATCH_POOL_LIMIT) {
    const idle = [];
    return {
        acquire(width, height) {
            const canvas = idle.pop() ?? factory();
            if (canvas.width !== width || canvas.height !== height) {
                canvas.width = width;
                canvas.height = height;
            } else {
                const context = canvas.getContext("2d");
                context.setTransform(1, 0, 0, 1, 0, 0);
                context.clearRect(0, 0, width, height);
            }
            return canvas;
        },
        release(canvas) {
            if (idle.length < limit) {
                idle.push(canvas);
            }
        },
        idleCount: () => idle.length,
    };
}

/**
 * Bind the canvas factory the faded-element buffer composes with.
 *
 * Binding replaces the pool: canvases built by an earlier factory are not
 * reused.
 *
 * @param {(() => HTMLCanvasElement) | null} factory The builder, or `null` to unbind.
 * @returns {void}
 */
export function bindScratchCanvas(factory) {
    scratchPool = factory === null ? null : createScratchPool(factory);
}

/**
 * Compose a translucent element in its own buffer and blit it.
 *
 * This is upstream's rendering for every element on the static canvas: the
 * element is drawn into a canvas of its own at **full** alpha, and the buffer
 * is drawn onto the scene at the element's alpha
 * (`generateElementWithCanvas` → `drawElementFromCanvas`,
 * `packages/element/src/renderElement.ts:1245`). Drawing a translucent shape
 * *directly* composites its fill against the paper while the pen moves; the
 * buffer composites the shape against nothing first and the buffer against
 * the paper once — and the two differ by a channel at the edge of an
 * eight-bit step. That difference is exactly what PAINT-008 measured: a fill
 * at 85 % over white landed one channel apart from the reference, because
 * upstream's blit blends in integers that truncate and a direct fill rounds.
 *
 * The buffer is the element's own box plus a margin for the pen's width and
 * the anti-aliased edge, sized in **device** pixels — the context's transform
 * carries the device ratio, and a CSS-sized buffer would be resampled on the
 * way in and come out soft. The margin is what keeps the buffer's own edge
 * anti-aliasing off the shape's.
 *
 * The drawImage runs under whatever clip and filter the caller had, exactly
 * as a direct draw would: the scene's clip still cuts the element, and the
 * theme's filter still turns its colours over.
 *
 * @param ctx A canvas 2D context.
 * @param {number} opacity The element's own opacity, 0 to 100.
 * @param {(target: CanvasRenderingContext2D) => void} draw The element's marks, drawn at full alpha.
 * @param {number[][]} points The shape's points, in the context's space.
 * @param {number} strokeWidth The pen's width, for the margin.
 */
function paintElementBuffer(ctx, opacity, draw, points, strokeWidth) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const point of points) {
        const [x, y] = point;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
    }
    const pad = Math.ceil(strokeWidth / 2) + 2;
    const left = Math.floor(minX - pad);
    const top = Math.floor(minY - pad);
    const width = Math.ceil(maxX + pad) - left;
    const height = Math.ceil(maxY + pad) - top;
    // The ratio rides the context's own transform: the caller paints in CSS
    // pixels with the device ratio already set, and a buffer sized in CSS
    // pixels would be upsampled on the way in and land soft on a Retina panel.
    const ratio = ctx.getTransform?.()?.a ?? 1;
    const buffer = scratchPool.acquire(
        Math.max(1, Math.round(width * ratio)),
        Math.max(1, Math.round(height * ratio)),
    );
    try {
        const target = buffer.getContext("2d");
        target.setTransform(ratio, 0, 0, ratio, 0, 0);
        target.translate(-left, -top);
        draw(target);
        ctx.save();
        ctx.globalAlpha = (ctx.globalAlpha || 1) * (opacity / 100);
        ctx.drawImage(buffer, left, top, width, height);
        ctx.restore();
    } finally {
        // Back to the pool only after the blit, and also when `draw` throws.
        scratchPool.release(buffer);
    }
}

/**
 * The interior, if the style asks for one. A solid fill is a path; the rest are rows.
 *
 * The interior is painted with the element's **background colour**, and that is not a
 * detail of this file: upstream hands roughjs the background colour as the fill
 * (`options.fill = element.backgroundColor`, `packages/element/src/shape.ts:238`) and
 * roughjs strokes the hachure rows with it (`fillSketch`: `strokeStyle = options.fill`).
 * So a hachure is drawn in the background colour and the outline in the stroke colour,
 * and a shape with a transparent background has no interior at all — which is what the
 * `fill="transparent"` below draws, and what upstream draws by not drawing the fill.
 */
function paintInterior(ctx, points, fillStyle, paper) {
    // The only interior this file computes is the solid one: a filled path, painted
    // with the background colour of the element — and the background of a new element
    // is transparent, so the inside of a solid shape is left as the page. The
    // reference draws it that way, and the exported file says the same thing with the
    // same colour. Every other interior is the kernel's geometry now: the frame
    // carries the rows as `Hatch` ops and the painter strokes what it is given, so a
    // token the kernel hatches arrives already computed and this file branches on no
    // fill token but this one.
    if (fillStyle !== "solid") {
        return;
    }
    tracePath(ctx, points, true);
    ctx.fillStyle = paper;
    ctx.fill();
}

/**
 * The interior's rows, as the frame carries them.
 *
 * The rows stroke with the element's own background colour at half its width —
 * upstream's `fillWeight` (`fillWeight: element.strokeWidth / 2`,
 * `packages/element/src/shape.ts:214`) — and with no dash of the outline's: the rows
 * are short strokes of their own. One path for the whole interior and one `stroke()`
 * at the end of it, every run its own subpath — the count is what this buys, and
 * `stroke()` is the call that costs the browser. The geometry is the kernel's; this
 * file holds no table of patterns and finds no interior of its own.
 *
 * @param ctx A canvas 2D context.
 * @param {object} hatch the `Hatch` op: the id, the runs, and the flat style.
 */
function paintHatch(ctx, { polylines, backgroundColor, strokeWidth, opacity }) {
    if (!polylines || polylines.length === 0) {
        return;
    }
    // The element's own opacity, multiplied into whatever alpha the caller had — the
    // same rule the outline paints with, so a faded shape fades whole.
    if (opacity !== undefined && opacity < 100) {
        ctx.save();
        ctx.globalAlpha = (ctx.globalAlpha || 1) * (opacity / 100);
    }
    ctx.strokeStyle = backgroundColor;
    ctx.lineWidth = strokeWidth / 2;
    // The fill rows ride upstream's round pen too: roughjs strokes them inside
    // the same round context the outline drew with
    // (`packages/element/src/renderElement.ts:502-515`), so a row reaches half
    // a stroke past its end the way the outline does. The defaults go back
    // after the stroke, the hand-back the outline does.
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.setLineDash([]);
    ctx.beginPath();
    for (const run of polylines) {
        for (let i = 0; i < run.length; i += 1) {
            if (i === 0) {
                ctx.moveTo(run[i][0], run[i][1]);
            } else {
                ctx.lineTo(run[i][0], run[i][1]);
            }
        }
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineCap = "butt";
    ctx.lineJoin = "miter";
    if (opacity !== undefined && opacity < 100) {
        ctx.restore();
    }
}

/**
 * The outline, dashed according to the shape's own stroke style.
 *
 * The dash is cleared afterwards, and that is not tidiness. `paintShape` is called in a
 * loop, and the next shape is very often `solid` — a dotted line that leaked its dash into
 * its successor would turn every solid outline after it into a dotted one, and the only
 * symptom would be that drawings look wrong in a way nobody can name.
 */
function paintOutline(ctx, points, strokes, strokeStyle, lineWidth, closed, ink) {
    const dash = DASH[strokeStyle];
    if (dash === undefined) {
        return;
    }
    // The pencil goes over a solid stroke twice, and the two passes are two different
    // lines: the band of ink between them is what a hand-drawn stroke looks like. They
    // are one path with two subpaths and one `stroke()`, which is what the reference
    // draws — a second `stroke()` would restart the dashes, and the second pass of a
    // dashed stroke does not exist anyway.
    ctx.beginPath();
    traceSubpath(ctx, points, closed);
    for (const stroke of strokes ?? []) {
        traceSubpath(ctx, stroke, false);
    }
    ctx.strokeStyle = ink;
    ctx.lineWidth = lineWidth;
    // The pen's end and corner are upstream's own: the reference fixes
    // `lineJoin = "round"` and `lineCap = "round"` on the context before
    // drawing every shape, line and arrow
    // (`packages/element/src/renderElement.ts:502-515`), so a stroke bulges
    // half a stroke past its endpoint and a corner turns instead of mitring.
    // The freehand is the one family upstream leaves square, which is why the
    // pen is picked up here — the stroke arms — and not in `traceStrokePath`.
    // After the stroke the canvas gets its own defaults back, the same
    // hand-back `setLineDash([])` gives the dash, so no later arm inherits the
    // roundness.
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.setLineDash(dash);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineCap = "butt";
    ctx.lineJoin = "miter";
}

/** The shape's path, as the canvas sees it: a chain of `lineTo`, closed when asked. */
function tracePath(ctx, points, closed) {
    ctx.beginPath();
    traceSubpath(ctx, points, closed);
}

/** One stroke of the path, as a subpath of the path being built. */
function traceSubpath(ctx, points, closed) {
    ctx.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i += 1) {
        ctx.lineTo(points[i][0], points[i][1]);
    }
    if (closed) {
        ctx.closePath();
    }
}
