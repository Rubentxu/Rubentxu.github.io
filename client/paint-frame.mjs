// The frame: pull what the kernel drew, paint it, and paint what the gesture in flight shows.
//
// What this file is:
// - The paint itself. `createPaintFrame(deps)` returns `paintNow(session, ctx)`, which
//   reads one frame from the cache, paints the paper, the grid, the drawing, the chrome
//   and what the gesture in flight shows, refreshes the toolbars from one read of the
//   selection, and asks for the next frame or the save when something needs it.
// - Not the door. The page keeps `paint` (which asks for a frame) and `paintOrRecover`
//   (which survives a panic while painting); both reach this function by name.
//
// What it does not own: the kernel (it asks the session it is handed), the gesture in
// flight (the pipeline owns it and answers `pendingGesture()`), the status line, the
// frame cache, the save, and the toolbars it refreshes. All of them come in by name.
// The ones the page reassigns after boot (`themeFilterValue`, the `sync*` functions,
// the presence room) come in as functions that read the page's current value, so the
// paint never holds a copy that went stale.

import { GESTURES } from "./gesture.mjs";
import { draftFrame } from "./draft.mjs";
import { syncEmbeddableLayer } from "./embeddable-overlay.mjs";
import * as marqueeGesture from "./gestures/marquee.mjs";
import * as cropGesture from "./gestures/crop.mjs";
import * as cropModeGeometry from "./crop-mode.mjs";
import * as eraserGesture from "./gestures/eraser.mjs";
import * as vertexGesture from "./gestures/vertex.mjs";
import * as segmentGesture from "./gestures/segment.mjs";
import * as midpointGesture from "./gestures/midpoint.mjs";
import { paintFrame, paintChrome, paintEraserTrail, paintLaserTrail, paintMultipointGhost, paintCropGhost, paintPaper, paintOp, punchEmbeddableHoles, paintGridLines, paintSnapGuides, paintBindingMidpoints, paintBindingSuggestion, paintPresence, paintRemoteSelections, paintCropMode, isOpaquePaper, imageVersion } from "./paint.mjs";
import { bindingSuggestion } from "./binding-hint.mjs";
import { createStaticLayer } from "./static-layer.mjs";

export function createPaintFrame(deps) {
    const {
        canvas, window, frames, statusLine, renderStatus, embeddableLayer, persistScheduler, paint,
        pendingGesture, pendingCrop, liveMultipoint, laserPoints, transformPictureAt, eraserTrailAt, nowMs,
        localPeerId = () => null,
        themeFilterValue, peersAt, syncStyleControls, syncStrokeColour, syncBackgroundColour,
        syncTextStyle, syncArrowStyle, syncHistoryButtons, syncZoomButtons, syncWelcome,
        staticLayer: heldLayer, staticLayerOff,
    } = deps;

    // The static layer, and what a missing factory means.
    //
    // A paint that finds no factory — a test that did not pass one, a page
    // that never wires the layer — is not an error: the layer it builds here
    // stands itself down on the first take and every paint after that lands
    // on the caller's own canvas, which is the picture the direct path has
    // always painted. One branch at the factory, none in the paint.
    const staticLayer = heldLayer ?? createStaticLayer({
        createCanvas: () => {
            throw new Error("no canvas factory for the static layer");
        },
    });

    /**
     * What a move, a resize or a turn in flight shows, or `null` when the committed frame
     * is the picture.
     *
     * The elements are the kernel's answer for the release: the preview door is handed
     * the arguments the commit door will be, so what the hand sees is what the release
     * keeps — the snap, the floor of a box, the arrows that follow a moved shape and the
     * pivot of a turn included. The answer is three layers: the committed marks under
     * the change, the band that changed, and the committed marks over it.
     *
     * A refusal is reported in the status line and the committed frame paints. The
     * release would be refused with the same words, so the picture and the document
     * agree, and the next frame asks again.
     *
     * @param {Session} session
     * @param {object} frame The committed frame.
     * @param {object | null} gesture The gesture in flight.
     * @returns {{ shown: { items: object[], chrome: object[] }, under: object, over: object } | null}
     */
    function transformPicture(session, frame, gesture) {
        try {
            return transformPictureAt(session, frame, gesture);
        } catch (error) {
            statusLine.setProblem(`preview failed: ${error.message ?? error}`);
            renderStatus();
            return null;
        }
    }

    /**
     * Pull the render list, walk it, paint it. A move, a resize or a turn in flight is
     * painted as the kernel says the release will leave it: the elements at their new
     * place, and the selection's chrome around them.
     */
    function paintNow(session, ctx) {
        // The gesture in flight, read through the pipeline's seam: the layers below
        // show what the pointer is doing, and the pointer pipeline owns what that is.
        const gesture = pendingGesture();
        deps.syncContextHint?.();
        deps.syncShapeSwitch?.(session, ctx);
        const cropMode = pendingCrop?.(session) ?? null;
        // One crossing for the whole frame — and only when it changed.
        //
        // It used to be three: `renderList()`, `textViews()` and
        // `selectionOutlines()`, each serialised separately and each parsed
        // separately. Two of the three walked the whole scene on the Rust side to
        // produce their half, so a drawing with no text paid for a full scene walk
        // and then threw the result away. `frame()` walks once and ships
        // `{items, chrome}`, and this function still reads two arrays — the
        // client's knowledge of what a mark, a text record and a chrome record
        // look like is unchanged, which is the point of splitting the *transport*
        // from the *shape*.
        //
        // The items are one list and not two, and that is the other half of the
        // same change: two lists cannot say which of a mark and a label is on top,
        // so the order of the items is the scene's order and the export walks the
        // same list in the same order.
        //
        // `frames.take()` is the second half: the coalesced scheduler above answers
        // *how many* paints there are, and this answers *how many of them need a new
        // frame*. A drag asks on every pointermove and commits once, so sixty paints
        // of one drag ask for the same frame sixty times and get one read.
        const frame = frames.take(session);
        // The embeddable overlays ride the frame (TASK-85) and are used twice:
        // the paper is punched where their pages show, and the layer is
        // reconciled with the same rows after the frame draws. An empty list
        // punches nothing and clears the layer, which is the honest answer for
        // a frame whose document holds no embeddable.
        const embeddables = frame.embeddables;
        const w = canvas.width / (window.devicePixelRatio || 1);
        const h = canvas.height / (window.devicePixelRatio || 1);
        // The elements the eraser has marked are drawn faded, because upstream
        // draws them faded (`ELEMENT_READY_TO_ERASE_OPACITY`) and an eraser that
        // shows no sign of what it is about to remove is an eraser the user
        // cannot aim. Outside an erasing gesture there is nothing to fade, and
        // the set is `undefined` rather than empty so the painter's fast path
        // is the one that runs. It is read before the layer decides, because a
        // paint with a faded set is a paint about the gesture, not the frame,
        // and the layer steps aside for it.
        const dimmed = eraserGesture.preview(gesture);
        // A transform in flight paints the scene its release would keep, in three
        // layers: the committed marks under the change, the band that changed, and the
        // committed marks over it. The layer under the change is what goes on the
        // glass — it holds still for the whole drag, so the drag blits it and paints
        // only the band and what is above it.
        const picture = transformPicture(session, frame, gesture);
        // The picture the document already decided goes onto a glass the layer
        // holds, and every paint after the first carries that glass over with
        // one blit instead of painting it again. The key is the frame's static
        // section: selection deltas create a new composed frame but preserve
        // this payload's identity. During a transform it is the layer under the
        // change, which keeps its identity from one move to the next. The rest of
        // the key is outside it: the canvas's size and pixel ratio, the theme's
        // filter, the embeddable rows whose holes are cut into the paper, and the
        // image version, because a decode makes a picture appear inside a frame
        // that has not moved.
        //
        // Three situations take the direct path instead, none of them thrown:
        // a paper that composes (PAINT-008 — the copy would compose twice), a
        // paint that fades elements for the eraser (a fact about the gesture),
        // and the measurement door `?static=0`. The same painters run on both
        // paths either way — the literals in `paintStatic` are the wiring
        // guards', and they are the direct path's own lines, unchanged.
        const surface = staticLayer.begin(
            picture?.under ?? frame.staticSection ?? frame,
            {
                w,
                h,
                dpr: window.devicePixelRatio || 1,
                theme: themeFilterValue(),
                embeddables,
                imageVersion: imageVersion(),
                bypass: staticLayerOff || !isOpaquePaper(frame.background) || dimmed !== undefined,
            },
            ctx,
        );
        const paintStatic = (ctx, frame) => {
            // The theme's filter goes on the context **before** the paper, so the
            // paper is under it like everything else the frame draws — the drawing and
            // the chrome alike, which is what turning the page over did before. The
            // image import takes itself out of it in `client/paint.mjs`. On the
            // glass the filter is painted INTO the pixels; the blit carries the
            // glass over unfiltered, so a dark page does not filter twice.
            ctx.filter = themeFilterValue();
            // The document's paper, painted before anything draws on it. This is the
            // door PAINT-008 asked for: a translucent fill composed over an opaque
            // paper rounds once, and the same fill drawn on transparent glass and
            // composed later rounds three times — the third rounding was the channel
            // the reference does not have. The paper is the document's own answer,
            // asked once per paint like the selection.
            //
            // The pages a web embed shows are the one thing the paper must not cover:
            // they live in a DOM layer **under** this canvas, so the paper is cut away
            // inside every embeddable's box and the page shows through the hole.
            paintPaper(ctx, frame.background, w, h);
            // The grid is furniture, not ink, and it rides on the paper's side of
            // the punch: the kernel names every line — the step, the pitch a screen
            // cannot separate, the viewport conversion — and this strokes the
            // answer *before* the embeddable holes are cut, so a web embed's page
            // shows clean through its hole. The lines ride the frame as data since
            // TASK-85: an empty list is the honest "no grid" (off, a view with no
            // area, a pitch too fine to paint), so nothing here decides what should
            // be visible; a client that recomputed the pitch or the multiple would
            // be the second place precision lives (ADR-007). There is no refusal
            // left to catch: the frame either carries the lines or carries none.
            paintGridLines(ctx, frame.grid);
            punchEmbeddableHoles(ctx, embeddables);
            // The frame is one list of items, and the walk over it is `paintFrame`'s
            // business and not this function's. The order of the items is the z-order,
            // and the z-order is also what `to_svg` has to produce for the export to
            // be the same picture. A caller that walked the list itself could get one
            // of them right and the other wrong, with nothing in either file noticing.
            paintFrame(ctx, frame, (id) => session.imageText(id), dimmed);
        };
        if (surface.repaint) {
            paintStatic(surface.ctx, picture?.under ?? frame);
        }
        if (surface.offscreen) {
            if (!staticLayer.blit(ctx, w, h)) {
                // The glass did not land: the picture paints on the page's own
                // canvas, the same painters, and the layer stands itself down.
                paintStatic(ctx, picture?.under ?? frame);
            }
            // The blit ran unfiltered, so the furniture below paints under the
            // filter the page shows, as it always has.
            ctx.filter = themeFilterValue();
        }
        // The band and the committed marks over it, on the page's own canvas and
        // under the theme's filter, in stacking order: what moved paints under
        // what it was under, the way the release will leave it.
        if (picture !== null) {
            paintFrame(ctx, picture.shown, (id) => session.imageText(id), dimmed);
            paintFrame(ctx, picture.over, (id) => session.imageText(id), dimmed);
        }
        // The selection and its aggregate style ride the frame (TASK-85): one
        // crossing answered which ids are selected and what their common style
        // is, in one walk of the kernel's own state, and the toolbars are told
        // what the frame said rather than asking the kernel again — a second
        // crossing could disagree with the picture it rode in with, and its
        // per-id lookups used to be quadratic with everything selected.
        //
        // There is no cache and no "is it dirty" flag behind this, and there
        // must not be: the frame is the cache, and its criterion is the
        // kernel's revision. A selection change bumps it, so the next frame
        // carries the next answer, and nothing here has to remember why.
        const styles = frame.styles;
        syncStyleControls(styles);
        syncStrokeColour(styles);
        syncBackgroundColour(styles);
        syncTextStyle(styles);
        syncArrowStyle(styles);
        // These two answer from the frame's own tail rather than from the
        // selection, and the frame is where the kernel said it: the same
        // crossing the canvas's truth rode in on.
        syncHistoryButtons({ canUndo: frame.canUndo, canRedo: frame.canRedo });
        syncZoomButtons({ zoom: frame.zoom });
        // The welcome screen is a fact about the document and the armed tool,
        // and the frame carries the scene it was composed from: an empty list
        // is the empty canvas upstream welcomes, and a list with a mark is the
        // drawing that removes the welcome. The tool is the caller's answer.
        syncWelcome?.(session, frame);
        // The guides a translate drag has locked onto, asked once per paint and
        // only while some snapping is live — the grid and the object guides are
        // independent in the kernel's plan, so the gate is "either of them on",
        // not one flag. When neither is on there is nothing to lock onto.
        //
        // Where the moved elements land is not asked here: the preview door
        // applies the same plan to the same travel, so the picture above is
        // already snapped. The travel goes over in screen pixels, and the guides'
        // `at` is already a screen pixel: the kernel's own viewport did that
        // conversion (ADR-007), and a client converting again would be the
        // second transform that drifts.
        let snap = null;
        if (
            gesture?.kind === GESTURES.TRANSLATE &&
            gesture.targets.size > 0 &&
            (session.gridStep() !== undefined || session.snapGuides())
        ) {
            const dxScreen = gesture.currentScreen.x - gesture.startScreen.x;
            const dyScreen = gesture.currentScreen.y - gesture.startScreen.y;
            try {
                const preview = JSON.parse(
                    session.snapPreview([...gesture.targets], dxScreen, dyScreen),
                );
                snap = { guides: Array.isArray(preview.guides) ? preview.guides : [] };
            } catch (error) {
                // A refusal reports and the frame still paints, without guides,
                // and the next frame re-asks.
                statusLine.setProblem(
                    `snapPreview failed: ${error.message ?? error}`,
                );
                renderStatus();
            }
        }
        // The guides ride over the drawing and under the chrome: they name the
        // line a move has locked onto, and they are furniture of the gesture —
        // the commit paints none of its own, so nothing here outlives pointerup.
        paintSnapGuides(ctx, snap?.guides, w, h);
        // The target coordinates come from bind_drop's shape geometry through
        // the session boundary; this overlay is view-only and never feeds the
        // translation snap plan.
        if (session.midpointSnapping()) {
            paintBindingMidpoints(ctx, JSON.parse(session.bindingMidpoints()));
        }
        // The pages a web embed shows are a DOM layer under this canvas, and the
        // boxes they sit in are the kernel's answer for THIS frame — the same
        // answer the paper above was punched with, read once and used twice, so
        // the page inside a frame cannot drift from the outline drawn around it
        // or from the hole it shows through.
        if (embeddableLayer) {
            syncEmbeddableLayer(embeddableLayer, embeddables);
        }
        // The click-by-click drawing is the one line on the glass that the
        // document does not hold yet: it lives here until the drawing ends,
        // and it rides under the chrome like every other drawing does.
        const multipoint = liveMultipoint();
        if (multipoint !== null) {
            paintMultipointGhost(ctx, multipoint, session);
        }
        // The shape being drawn is the other drawing on the glass that the
        // document does not hold yet, and it is not a ghost of one: the items
        // are the kernel's answer for the commit's own element, painted by the
        // op painter the frame itself paints with, so the wobble the user
        // watches grow is the wobble that lands (TASK-132). It rides under the
        // chrome like every drawing does. A refusal reports and the frame
        // still paints, the way a transform's preview does: the next frame re-asks.
        if (gesture?.kind === GESTURES.DRAW || gesture?.kind === GESTURES.FREEDRAW) {
            try {
                const draft = draftFrame(session, gesture);
                if (draft !== null) {
                    for (const item of draft) {
                        // A drawing tool builds marks and nothing else — no text,
                        // no image — so the mark arm is the only one a draft can
                        // carry, and an item of another kind is a door that lied.
                        if (item.Mark) {
                            paintOp(ctx, item.Mark);
                        }
                    }
                }
            } catch (error) {
                statusLine.setProblem(`preview failed: ${error.message ?? error}`);
                renderStatus();
            }
        }
        // The shape a held arrow end would tie to, asked of the kernel the way
        // the drop asks it, painted over the drawing and under the chrome — the
        // reference paints the highlight in its interactive pass, over the
        // elements and under the transform handles. The key that silences the
        // tie silences the hint: the gesture carries it, so no event reading
        // lives in the paint. `null` names no suggestion and paints nothing.
        const suggestion = bindingSuggestion(session, gesture);
        if (suggestion !== null) {
            paintBindingSuggestion(ctx, suggestion);
        }
        // The kernel hands us the chrome in screen pixels, the same space the
        // drawing is painted in, so the client draws it where it is told. It
        // rides in the same answer rather than its own crossing, which is why
        // "nothing selected" needs no guard here: an empty selection is an
        // empty array and the loop below does not run. During a transform the
        // chrome is the preview's, drawn around the scene the release keeps, so
        // the rings and the handles travel with the elements they belong to.
        const chrome = picture?.shown.chrome ?? frame.chrome;

        for (const record of chrome) {
            if (gesture?.kind === GESTURES.ROTATE && gesture.id === undefined && record.kind === "selection") {
                // A multi-selection's turn hides the common box and its handles
                // while it lasts, and keeps every member's ring: the box would be
                // an axis-aligned outline of a group that is turning inside it.
                // Upstream draws it only when `!appState.isRotating`.
                continue;
            }
            if (gesture?.kind === GESTURES.VERTEX && record.id === gesture.id) {
                // The vertex being dragged. The drawing itself already follows the
                // pointer — the kernel moves the vertex in the document — so what
                // this adds is the one thing the drawing cannot say: which of its
                // vertices the hand is on. The index is the vertex's own, so the
                // held one is the right one even when the elbow arrow shows only
                // its first and last point.
                paintChrome(ctx, record, vertexGesture.preview(gesture, record));
            } else if (gesture?.kind === GESTURES.SEGMENT && record.id === gesture.id) {
                // The segment being pinned. The elbow itself already follows the
                // pointer — the kernel pins the segment in the document — so what
                // this adds is the one thing the drawing cannot say: which of the
                // handles the hand is on.
                paintChrome(ctx, record, segmentGesture.preview(gesture, record));
            } else if (gesture?.kind === GESTURES.MIDPOINT && record.id === gesture.id) {
                // The vertex being added. It is on the screen only once the pointer
                // has travelled far enough to be a drag, and it is the same vertex
                // the drag then carries — so the hand is shown on it from the
                // moment it exists.
                paintChrome(ctx, record, midpointGesture.preview(gesture, record));
            } else {
                paintChrome(ctx, record);
            }
        }
        // A marquee in progress is a dashed rectangle from the start to
        // the current cursor position, with a faint fill so the
        // enclosed area reads as "the things that will become selected".
        // Painted on top of the selection outlines so the user sees the
        // new box even when the existing selection is inside it.
        if (gesture?.kind === GESTURES.MARQUEE) {
            const marquee = marqueeGesture.preview(gesture);
            ctx.save();
            ctx.strokeStyle = "#1971c2";
            ctx.lineWidth = 1.5;
            ctx.setLineDash([6, 4]);
            ctx.strokeRect(marquee.left, marquee.top, marquee.right - marquee.left, marquee.bottom - marquee.top);
            ctx.fillStyle = "rgba(25, 113, 194, 0.06)";
            ctx.fillRect(marquee.left, marquee.top, marquee.right - marquee.left, marquee.bottom - marquee.top);
            ctx.restore();
        }
        // The eraser's ink is the last thing on the screen, because upstream draws
        // it in a layer *above* the canvas (`SVGLayer`, `App.tsx:2505`) and not in
        // it.
        //
        // It is asked of the kernel rather than kept from the last pointer move
        // because the ink **decays**: upstream's `sizeMapping` fades the trail
        // behind the pointer (`packages/excalidraw/eraser/index.ts`), so the
        // contour of this instant is not the contour of the last move. Asking is
        // cheap — the trail is a short polyline and it touches no element, which
        // is why it has its own boundary method (`session.eraserTrail`) rather
        // than riding on the one that runs the erase test.
        // The crop mode is a persistent overlay: the image is shaded outside the
        // selected region and the eight handles remain visible between drags. The
        // older direct crop gesture keeps its dashed ghost only when it has no mode
        // interaction payload.
        if (cropMode !== null) {
            const bounds = session.boundsOf(cropMode.id);
            const topLeft = session.sceneToScreen(bounds[0], bounds[1]);
            const bottomRight = session.sceneToScreen(bounds[2], bounds[3]);
            const imageBox = { left: topLeft[0], top: topLeft[1], right: bottomRight[0], bottom: bottomRight[1] };
            paintCropMode(ctx, imageBox, cropModeGeometry.preview(imageBox, cropMode));
        } else if (gesture?.kind === GESTURES.CROP && gesture.modeInteraction === undefined) {
            paintCropGhost(ctx, cropGesture.preview(session, gesture));
        }
        if (gesture?.kind === GESTURES.ERASER) {
            paintEraserTrail(ctx, eraserTrailAt(session));
            // The decay needs a frame to show itself, so the loop is the paint
            // asking for the next one. Upstream runs the same loop for the same
            // reason (`AnimatedTrail.onFrame`,
            // `packages/excalidraw/animatedTrail.ts`).
            //
            // It stops by itself: the condition is the gesture, so the frame after
            // the pointer is released paints no ink and asks for nothing. There is
            // no timer to cancel and no handle to leak, which is the whole reason
            // the loop is written this way rather than as a `setInterval`.
            //
            // The ask goes through `paint`, not through the frame: inside this
            // function `frame` is the *cached* frame the drag reuses, and a cached
            // frame has no `request` to give. `paint` is the module's own door to
            // the scheduler, and it is what every other caller uses.
            paint(session, ctx);
        }
        // The laser's trail is the one thing on the glass that neither the
        // document holds nor the gesture bounds: it outlives its pointer by up
        // to a second, so the condition is the trail being alive rather than the
        // gesture being in flight. The ask for the next frame is what keeps the
        // comet fading after the hand lifts — the same self-stopping loop the
        // eraser's ink runs, with the trail's emptiness where the gesture's end
        // is the eraser's condition. A trail with nothing alive asks for nothing,
        // so the loop ends on the first frame past the fade and never spins.
        //
        // The points are asked at this instant and never kept: they decay with
        // the clock, so a copy held between frames would draw a moment that has
        // already gone.
        const laser = laserPoints(nowMs());
        if (laser.length > 0 || gesture?.kind === GESTURES.LASER) {
            paintLaserTrail(ctx, laser, nowMs(), localPeerId());
            paint(session, ctx);
        }
        // The remote peers' pointers, above the scene like the laser's ink. The
        // room's answer is re-read every paint through the client's own presence
        // room — the clock prunes what the relay has not heard from, and the
        // loop is the same self-stopping one: an empty room costs one prune and
        // asks for nothing.
        const peers = peersAt(nowMs());
        if (peers.length > 0) {
            paintRemoteSelections(ctx, frame, peers);
            paintPresence(ctx, peers);
            paint(session, ctx);
        }
        // The save is asked for here and run later, by the browser, when it has
        // room. The frame the user is waiting for should not be the frame that
        // serialises the whole drawing: the serialisation is the part that grows
        // with the drawing, and it is the one cost a paint cannot afford.
        persistScheduler.request(session);
    }

    return { paintNow };
}
