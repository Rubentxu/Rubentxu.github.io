// How gestures run: the pointer pipeline between the DOM events and the kernel.
//
// This is the use case TASK-26 extracted from the boot coordinator, chosen by
// measurement: of everything `client/create-app.mjs` owned, the pointer
// pipeline (`onPointerDown`, `onPointerMove`, `onPointerUp`, `onPointerCancel`
// and the helpers they share) is the single most-changed code in the file. The
// code moved here verbatim; what changed is only who owns the state it needs.
//
// The pipeline owns the live gesture, the touch bookkeeping, the crop and
// multipoint ghosts, the space key and the tool handle — everything that
// exists only between a pointer going down and its gesture being committed.
// The page owns the bindings: which DOM events call in, and what a committed
// document is followed by (paint, persist, status). The kernel contract is
// untouched: every call the pipeline makes is the same `session.*` call it
// made when it lived in the coordinator.
//
// The seam is one factory and its answer. `createGesturePipeline` takes the
// seven page values the pipeline reads (the canvas, the status line and its
// render, the paint, selection, the context menu and the clock) and answers
// with the handlers boot binds plus the small questions the rest of the page
// still asks (`pendingGesture`, `isSpaceHeld`, ...). State the page wrote
// directly when this code lived inline — arming the crop mode, receiving the
// toolbar binder — crosses as the two-line functions at the bottom.

import { GESTURES, cancelGesture, commits, dragTargetsFor } from "./gesture.mjs";
import { ADMISSION, admitPointerDown, ownsGesture } from "./gesture-stream.mjs";
import { createLaserTrail } from "./laser.mjs";
import * as laserGesture from "./gestures/laser.mjs";
import { pinchCentre } from "./pinch.mjs";
import * as pinchGesture from "./gestures/pinch.mjs";
import {
    beginSecondaryPress,
    cancelSecondaryPress,
    finishSecondaryPress,
    isPanGesture,
    isSecondaryPress,
    moveSecondaryPress,
    panCursor,
} from "./pan.mjs";
import * as multipointMode from "./multipoint.mjs";
import {
    TOOLS,
    arrowLabelJsonFor,
    boundTextJsonFor,
    consultsChrome,
    cursorFor,
    createdTextJsonFor,
    linearJsonFor,
    createToolState,
    freshSeed,
} from "./tools.mjs";
import { textToolTargetAt } from "./bound-text.mjs";
import { handleAt } from "./vertex-edit.mjs";
import { chromeGeometry, cursorForChrome, resizeCursorFor, textToolCursorFor } from "./cursor-for.mjs";
import * as rotateGesture from "./gestures/rotate.mjs";
import * as segmentGesture from "./gestures/segment.mjs";
import * as midpointGesture from "./gestures/midpoint.mjs";
import * as cropGesture from "./gestures/crop.mjs";
import * as cropModeGeometry from "./crop-mode.mjs";
import * as marqueeGesture from "./gestures/marquee.mjs";
import * as translateGesture from "./gestures/translate.mjs";
import * as freedrawGesture from "./gestures/freedraw.mjs";
import * as drawGesture from "./gestures/draw.mjs";
import * as eraserGesture from "./gestures/eraser.mjs";
import * as resizeGesture from "./gestures/resize.mjs";
import * as panGesture from "./gestures/pan.mjs";
import * as vertexGesture from "./gestures/vertex.mjs";
import { forgetImageFor, imageNaturalSize } from "./paint.mjs";
import { createTransformPicture } from "./transform-preview.mjs";

/** The gestures whose picture is a preview, and so the ones Escape can take back whole. */
const TRANSFORMS = new Set([GESTURES.TRANSLATE, GESTURES.RESIZE, GESTURES.ROTATE]);

/**
 * Whether `error` is the kernel refusal this call site already decided to
 * ignore, as opposed to something it should surface.
 *
 * The tag is a prefix of the message, because that is all the boundary
 * carries: `SceneError::EmptyClipboard` becomes `"empty_clipboard: the
 * clipboard is empty; copy something first"`. There is no `error.tag` at the
 * frontier to branch on, so this matches the prefix and nothing else — the
 * message after the colon is prose and may change without breaking this.
 *
 * This exists because `catch (_)` is the wrong shape at a call site with more
 * than one possible refusal. Swallowing by tag is a decision; swallowing
 * everything is an abdication, and the two look identical to the user until
 * the day the second error arrives.
 * The clipboard use case asks it too, which is why it is a module export and
 * not a closure private (TASK-26).
 */
export function isRefusal(error, tag) {
    const message = typeof error?.message === "string" ? error.message : "";
    return message.startsWith(`${tag}: `);
}


/**
 * Build the pointer pipeline for one mounted editor.
 *
 * @param {object} page the page values the pipeline reads.
 * @param {HTMLCanvasElement} page.canvas the drawing surface.
 * @param {object} page.statusLine the status line handle.
 * @param {() => void} page.renderStatus repaints the status line.
 * @param {(session: object, ctx: object) => void} page.paint paints the scene.
 * @param {(event: MouseEvent, session: object) => boolean} page.selectAt selects at a click.
 * @param {(point: object, session: object, ctx: object) => void} page.openContextMenuAt opens the menu.
 * @param {() => number} page.nowMs the clock, in milliseconds.
 * @param {() => boolean} [page.isViewOnly] whether the page refuses edits right now; asked where a
 *   gesture is born, so the pipeline keeps no copy of the answer.
 * @param {{ take: (session: object) => object | null } | null} [page.frames] the frame cache the
 *   paint reads, asked for the selected element's chrome when the hover needs its angle. It is the
 *   same frame the painter drew, so the cursor and the handle under the pointer cannot disagree.
 * @returns {object} the handlers boot binds and the questions the page asks.
 */
export function createGesturePipeline({
    canvas, statusLine, renderStatus, paint, selectAt, openContextMenuAt, nowMs,
    dateNowMs = () => Date.now(),
    mountTextEditor = null,
    isViewOnly = () => false,
    // Pen mode: with it on, a finger is not a pen. The stylus draws; the hand
    // pans, which is upstream's rule (`appState.penMode`).
    penMode = () => false,
    // Tool lock: with it on, a creation keeps the tool; off (upstream's
    // default) hands the page back to the selection.
    toolLock = () => false,
    canvasRect = { get: () => canvas.getBoundingClientRect(), invalidate() {} },
    // The frame cache, once the page has built it. The hover asks it for the
    // selected element's chrome record — the one the painter drew — rather than
    // re-deriving the element's turn from the scene. `null` in a unit that has
    // no frame: the chrome then answers upright, and the cursor is the one an
    // unturned element has.
    frames = null,
}) {
    const DRAG_THRESHOLD_CSS = 3;
    // The autowrap threshold: the screen-space travel a press must pass
    // before its drag stops being a click and starts sizing a birth
    // (`TEXT_AUTOWRAP_THRESHOLD`, `constants.ts:24`), and the floor under the
    // width a drag may leave — the empty body's measure plus the two sides of
    // label padding (`getMinTextElementWidth`, `textMeasurements.ts:53-59`:
    // an empty string measures nothing, so the floor is the padding alone).
    const TEXT_AUTOWRAP_THRESHOLD = 36;
    const MIN_TEXT_WIDTH = 10;

    /** Minimum scene-unit side of a resize box.
     *
     * This is the *user experience* guard, not the correctness one: a box two units
     * across is something nobody meant to draw, so the gesture stops here rather
     * than letting the user watch a rectangle collapse into a line and undo it.
     *
     * The correctness guard is in the kernel, and it is a different guard. H6.3 added
     * it: `resize_to_box` now refuses a box whose width or height is zero, negative
     * or not finite. This comment used to claim that refusal already existed here —
     * "below this the kernel would receive a non-positive size and return
     * `unresizable`" — and it was false. The clamp was the only guard in the system,
     * and a clamp cannot refuse: it answers a different number. Two guards described
     * as one is one guard with a reader who thinks there are two, so the wording now
     * says which is which.
     *
     * The two must stay separate. A floor here is a number a person chose; a sign
     * check in the kernel is an invariant nobody gets to pick.
     */
    const MIN_BOX_SIZE_CSS = 2;

    /** The current pointer gesture, or `null` when no gesture is in progress. */
    let gesture = null;

    /**
     * The laser pointer's trail.
     *
     * The trail outlives its gesture on purpose: the fade runs on the clock,
     * not on the pointer, so the points outlast the drag that drew them by up
     * to a second. It lives beside the gesture for the same reason the
     * click-by-click drawing does — the state is the pipeline's, the rules
     * are the module's (`client/laser.mjs`), and the paint asks for what is
     * still alive at the instant it draws.
     */
    const laserTrail = createLaserTrail();

    /**
     * The id a new element will be born under, minted at the press and not at
     * the release.
     *
     * The shape is the one Excalidraw's `randomId()` produces — a short random
     * token, not sortable, not persisted across reloads (the file format would
     * regenerate it on import), enough to be unique within a session — and the
     * moment it is minted is what TASK-132 moved: the draft preview and the
     * commit must name the same element, so the press mints the id (and the
     * seed beside it) and the release inserts under it. A gesture that ends as
     * a click, a multipoint or a cancellation simply never spends its id.
     *
     * @returns {string}
     */
    function mintElementId() {
        return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    }

    /**
     * The click-by-click drawing mode, or `null` when it is not open.
     *
     * The mode is a client affair from beginning to end: the growing line is
     * painted here as the rubber band the user aims with, the document is
     * written once — when the drawing is finished — and one `Cmd+Z` takes the
     * whole drawing back. The state itself and its rules live in the pure
     * module; what lives here is the fact that a drawing is open and the
     * plumbing that feeds it.
     */
    let multipoint = null;

    /**
     * Whether the pointer last stood inside the mode's commit zone.
     *
     * The zone is the place where the next click ends the drawing, and a
     * cursor that reads as a button there is the affordance that says so.
     * The answer changes with every hover move and dies with the mode, which
     * is why it is plumbing and not state.
     */
    let multipointInZone = false;

    /**
     * The open mode, unless the tool that opened it has moved on.
     *
     * The mode belongs to the tool that opened it: a user who switches from
     * the line to the rectangle mid-drawing has abandoned the drawing, and a
     * mode that survived the switch would draw their next rectangle click
     * into a line they are not drawing. The check is lazy rather than hooked
     * into every path a tool can change through — a mode nobody feeds is a
     * mode that costs nothing, and the next feed is where the answer matters.
     *
     * @returns {object | null} The live mode's state.
     */
    function liveMultipoint() {
        if (multipoint === null) {
            return null;
        }
        if (
            multipoint.tool !== toolState.currentTool
            || multipoint.arrowType !== (toolState.arrowType ?? undefined)
        ) {
            multipoint = null;
            multipointInZone = false;
        }
        return multipoint;
    }

    /**
     * End the click-by-click drawing: write it, select it, put the tool down.
     *
     * The drawing reaches the document the way a dragged one does — one
     * insert, through the same door — so the two gestures produce the same
     * kind of element and the same kind of history entry. A drawing that
     * never grew past its first click ends as nothing: the mode opened and
     * closed, and the document never heard about it.
     */
    function endMultipoint(session, ctx) {
        const state = multipoint;
        multipoint = null;
        multipointInZone = false;
        const points = state === null ? null : multipointMode.finish(state);
        if (points !== null) {
            // The finalize asks the loop question of the drawing it is about
            // to write, the way the reference asks it at its own finalize: a
            // line whose path came home has its last point snapped onto the
            // first — «this ensures that loop remains closed at different
            // scales» — and is born a polygon. The arrow is not part of the
            // rule: its ends stay where they were drawn
            // (`actionFinalize.tsx:307-338`).
            const isLoop = multipointMode.isPathALoop(points, state.zoom, session);
            const closed = isLoop && state.tool === TOOLS.line;
            if (closed) {
                points[points.length - 1] = [points[0][0], points[0][1]];
            }
            const id = `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
            const json = linearJsonFor(state.tool, id, state.origin, points, {
                arrowType: state.arrowType,
                polygon: closed,
            });
            if (json !== null) {
                settleCreation(json, id, session);
            }
        }
        syncCursor();
        paint(session, ctx);
    }

    /**
     * The crop mode, or `null` when no image is being cropped.
     *
     * The mode is armed by `Enter` on a lone chosen image and owns every press
     * until it is left: a drag names the region of the bitmap the image shows,
     * and `Escape` (or another `Enter`) leaves without changing anything. It is a
     * mode and not a tool because it answers to a selection the user already
     * made, not to a toolbar choice — and because while it is on, the press that
     * would have selected or drawn is the press that crops instead.
     */
    let cropMode = null;
    /**
     * The crop mode, unless the scene has moved on from the image it was armed
     * on.
     *
     * Validity is re-checked at every use rather than enforced at every mutation,
     * the same lazy rule the click-by-click drawing keeps: an undo can take the
     * image away, a history step can leave the selection somewhere else, and a
     * mode that outlived its own image would send a region to an id the kernel
     * no longer knows. The kernel's own answer — `null` for an element that is
     * not an image at all — is what keeps the mode honest about its subject.
     *
     * @param {Session} session
     * @returns {object | null} The live mode's state.
     */
    function liveCropMode(session) {
        if (cropMode === null) {
            return null;
        }
        let answer = null;
        try {
            answer = JSON.parse(session.cropOf(cropMode.id));
        } catch {
            answer = null;
        }
        const selected = session.selectedIds();
        if (
            answer === null
            || toolState.currentTool !== TOOLS.selection
            || selected.length !== 1
            || selected[0] !== cropMode.id
        ) {
            cropMode = null;
            syncCursor();
        }
        return cropMode;
    }

    /** Leave crop editing without applying its transient preview. */
    function exitCropMode(session, ctx) {
        cropMode = null;
        syncCursor();
        paint(session, ctx);
    }

    /** Apply the persistent crop preview as one kernel edit and one history step. */
    function confirmCropMode(session, ctx) {
        const mode = liveCropMode(session);
        if (mode === null) return;
        const bounds = session.boundsOf(mode.id);
        const box = { left: bounds[0], top: bounds[1], right: bounds[2], bottom: bounds[3] };
        const topLeft = session.sceneToScreen(box.left, box.top);
        const bottomRight = session.sceneToScreen(box.right, box.bottom);
        const preview = cropModeGeometry.preview(
            { left: topLeft[0], top: topLeft[1], right: bottomRight[0], bottom: bottomRight[1] },
            mode,
        );
        cropMode = null;
        syncCursor();
        try {
            const completed = cropGesture.start(mode.id, box, { x: preview.left, y: preview.top });
            cropGesture.commit(session, completed, { x: preview.right, y: preview.bottom }, {
                naturalSize: (id) => imageNaturalSize(id, (key) => session.imageText(key)),
                threshold: 0,
            });
        } catch (error) {
            statusLine.setProblem(`the crop was refused: ${error.message ?? error}`);
            renderStatus();
        }
        paint(session, ctx);
    }

    /** End a pointer adjustment; the preview remains open until Enter commits it. */
    function finishCropInteraction(session, ctx, completed, event) {
        if (completed.modeInteraction !== undefined && cropMode !== null) {
            cropMode = cropModeGeometry.move(
                completed.modeInteraction,
                completed.modeInteraction.box,
                screenFromEvent(event),
            );
        }
        syncCursor();
        paint(session, ctx);
    }

    /**
     * The secondary-button session, or `null` when there is none.
     *
     * The right button opens a *session*, not a menu: the press is a question —
     * "is this a click or a drag?" — and the answer is only known when the
     * pointer comes back up.
     *
     * A click opens the menu; a drag pans the view. The threshold that decides
     * which is five pixels (`SECONDARY_PAN_THRESHOLD`), and it lives in
     * `client/pan.mjs` next to the other two questions about this button.
     *
     * It is not a gesture. A gesture is a thing the client draws or commits;
     * this is a thing the client is *waiting for*, and it commits nothing and
     * previews nothing. Keeping it out of `GESTURES` is what keeps the
     * structural guard in `wiring.test.mjs` honest: every gesture there is
     * created and committed, and this one is neither.
     */
    let secondary = null;

    /**
     * The text tool's press waiting for its release to decide.
     *
     * Upstream defers the container's click exactly this way — the press arms
     * it and the release decides click or drag (`App.textTool.ts`, the
     * `pending` of `AppTextTool`) — because a drag past the autowrap
     * threshold is not the click's gesture at all: it is the birth of a free
     * text the drag sizes (`dragNewTextElement`, `dragElements.ts:280-313`).
     * The free road joins the same deferral here for the same reason, so a
     * drag that starts on empty canvas can size what it will create.
     *
     * It is not a gesture. A gesture is a thing the client draws or commits;
     * this is a thing the client is *waiting for*, and while it waits the
     * canvas shows nothing — the element an upstream drag sizes is an empty
     * text, and empty text is no ink. Keeping it out of `GESTURES` is what
     * keeps the structural guard in `wiring.test.mjs` honest: every gesture
     * there is created and committed, and this one is neither.
     */
    let pendingText = null;

    /**
     * The fingers on the canvas, by pointer id.
     *
     * The browser does not say "a second finger arrived": it delivers a second
     * `pointerdown` with another id, and the page has to notice that it already
     * knows one. A pinch needs both of them and the distance between them, and
     * that distance is the zoom.
     *
     * Only touch is tracked. A mouse has one pointer by definition, and a
     * trackpad reports the same id for the whole gesture, so counting them would
     * only add a way to be wrong.
     */
    const touchPointers = new Map();

    /** The client's drawing tool. Pure state lives in `tools.mjs`; this
     *  variable is the live handle the rest of the client reads.
     *
     *  Defaulting to `selection` keeps the existing click / marquee /
     *  drag behaviour intact: nothing changes until the user explicitly
     *  picks a draw tool with the keyboard.
     */
    const toolState = createToolState();

    /**
     * The one function that lights the tool buttons, bound at boot and called from
     * everywhere the tool can change.
     *
     * It used to be three copies of the same pressed-state write, two of them with
     * the tool name spelled into a `document.querySelector` selector. That works
     * while exactly one button exists and keeps working as buttons are added, so the
     * failure mode is a highlight that quietly stops lighting rather than an error.
     * One function, found once, is the difference between "the toolbar is stale" and
     * "the toolbar cannot be stale".
     *
     * Before boot it is a no-op, which is what the keyboard handler needs: the user
     * can press `r` before the toolbar exists, and that must change the tool.
     */
    let toolButtonRefresher = () => {};

    /** Switch tools and bring the cursor and the buttons along. */
    function setTool(tool) {
      toolState.currentTool = tool;
      refreshToolButtons();
      syncCursor();
    }

    /**
     * Begin a gesture owned by the pointer that began it.
     *
     * The owner is not decoration. Only the owner may move the gesture and only the owner
     * may end it, so a pointer that arrives in the middle of one cannot take it away from
     * the pointer that owns it and cannot finish it either. Writing the owner down here
     * means the page has no way to say "a gesture nobody owns" — every gesture in the file
     * is created here, and the owner is part of what it is.
     *
     * The pinch is the exception and says so where it happens: it is owned by two fingers,
     * and either of them may end it.
     *
     * @param {string} kind One of the gesture kinds.
     * @param {PointerEvent} event The pointer that began the gesture.
     * @param {object} payload What the gesture needs to remember while it is alive.
     */
    function startGesture(kind, event, payload) {
      gesture = { ...payload, kind, owners: [event.pointerId] };
    }

    /**
     * Put a new element in the document and leave the page as the user expects to find it.
     *
     * A shape that lands on the canvas is left **chosen**, and the tool goes back to
     * selection: the next drag moves the shape that was just drawn instead of drawing
     * over it, and every verb that needs something chosen is offered on it right away.
     *
     * The three steps are one gesture, so they live in one place. They used to live in the
     * text tool's branch alone, while the two branches that draw a shape or a stroke put
     * their element in the document and left it there unchosen — so a shape that had just
     * been drawn was a shape the user could not move, resize or cut without clicking on it
     * first, and the drawing tool stayed armed for a second shape nobody had asked for.
     *
     * @param {string} json The document the kernel inserts.
     * @param {string} id The id of the element being created.
     * @param {Session} session
     * @param {{start: [number, number], end: [number, number]} | null} ends The two
     *   ends of an arrow that is born tied, in scene units, or `null` for an
     *   element that ties nothing.
     */
    function settleCreation(json, id, session, ends = null) {
      // The ends ride along with the creation so that the kernel ties them and
      // keeps the creation and the tying as one undo step. The client cannot
      // open a capture of its own: a capture it opened could be left open by
      // a refusal, and an open capture moves the scene live without touching
      // the history, which is how the undo stops working without saying so.
      //
      // The two ends cross as plain tuples, and they have to be flattened
      // first: the scene points arrive as `Float64Array`, and a `Float64Array`
      // serialises as a map (`{"0":640,"1":500}`), not as the `[640,500]`
      // tuple the kernel's `TiedEnds` reads. The map is why every arrow was
      // refused at birth with an error nobody saw (TASK-68): the refusal
      // travelled as a throw the pipeline caught and the drawing lost.
      // A box creation carries its raw drag end instead (`dragEnd`): the kernel
      // re-decides the object snap from it, the same answer the preview
      // painted (SNAP-05). The same flattening rule applies — a scene point
      // serialises as a map, never as the tuple the kernel reads.
      session.insert(
        json,
        ends
          ? JSON.stringify(
              "dragEnd" in ends
                ? { dragEnd: Array.from(ends.dragEnd) }
                : {
                    start: Array.from(ends.start),
                    end: Array.from(ends.end),
                    // Alt is a fact of the gesture, and the kernel is where the tie is
                    // decided: it travels beside the ends, the same way the ends do.
                    ...(ends.alt === true ? { alt: true } : {}),
                  },
            )
          : undefined,
      );
      session.setSelection([id]);
      // Upstream's rule: the creation hands the page back to the selection
      // unless the lock kept the tool in the hand.
      if (!toolLock()) {
        setTool(TOOLS.selection);
      }
    }

    /**
     * A finger that lifts stops being a finger on the glass.
     *
     * Leaving is a physical fact about the glass, not a claim about the gesture, so this
     * happens whether or not the pointer that leaves owns the gesture in flight: the set
     * of fingers on the glass is what a pinch measures itself with, and a finger that has
     * gone is not one of its points.
     *
     * @param {PointerEvent} event
     */
    function forgetTouch(event) {
      if (event.pointerType === "touch") {
        touchPointers.delete(event.pointerId);
      }
    }

    /**
     * What space is doing right now. The keyboard and the pointer are separate event
     * streams and a `PointerEvent` does not carry "is space down", so the bridge between
     * them has to live somewhere: it lives here, and the only thing that writes it is the
     * keyboard handler.
     */
    let spaceHeld = false;

    /**
     * The chrome record of one element, from the frame the paint already holds.
     *
     * The frame is the painter's own answer: its chrome is the record it drew,
     * in screen pixels, and its handles carry the frame's turn. A page with no
     * frame cache — a unit driving the pipeline without one — answers `null`,
     * which [`chromeGeometry`] reads as the upright frame.
     *
     * @param {Session} session
     * @param {string} id
     * @returns {object | null}
     */
    function chromeRecordOf(session, id) {
        if (frames === null || typeof frames.take !== "function") {
            return null;
        }
        const frame = frames.take(session);
        return (frame?.chrome ?? []).find((record) => record.id === id) ?? null;
    }

    /** The turn and the flip of a selected element's frame, as the painter drew it. */
    function chromeGeometryOf(session, id) {
        return chromeGeometry(chromeRecordOf(session, id));
    }

    /**
     * The cursor a gesture in flight keeps.
     *
     * A resize carries its frame's facts from the press: the preview writes the
     * pointer's travel into a box that the committed chrome has not caught up
     * with, so reading the angle back from the frame on every move would be
     * reading a frame the drag has already left behind. The other chrome
     * gestures name one shape — a turn is a grab, a move is a move, and holding
     * a point is a pointer — and a gesture with no chrome of its own leaves the
     * cursor to the tool, which is the shape it had before.
     *
     * @returns {string | null} the cursor, or `null` to leave it to the hover or the tool.
     */
    function gestureCursor() {
        if (gesture === null) {
            return null;
        }
        switch (gesture.kind) {
            case GESTURES.RESIZE:
                return resizeCursorFor(gesture.handle, gesture.angle ?? 0, {
                    flipped: gesture.flipped === true,
                });
            case GESTURES.ROTATE:
                return "grab";
            case GESTURES.TRANSLATE:
                return "move";
            case GESTURES.VERTEX:
            case GESTURES.MIDPOINT:
            case GESTURES.SEGMENT:
                return "pointer";
            default:
                return null;
        }
    }

    /**
     * The cursor over an element that is not one of the selected chrome's pieces.
     *
     * Upstream answers `move` for any hit element while the selection tool is
     * active, and nothing over a locked one: a locked element cannot be dragged,
     * so a cursor that promised it would be advertising a gesture the press
     * refuses.
     *
     * @param {Session} session
     * @param {{x: number, y: number}} point in canvas CSS pixels.
     * @returns {string | null} `move`, or `null` over nothing.
     */
    function elementMoveCursor(session, point) {
        const hits = session.hitTestAtScreen(point.x, point.y, 0);
        const id = hits.length > 0 ? hits[0] : null;
        if (id === null) {
            return null;
        }
        if (typeof session.isLocked === "function" && session.isLocked(id)) {
            return null;
        }
        return "move";
    }

    /**
     * What the chrome under the pointer offers, or `null` to defer.
     *
     * Only the selection tool consults the chrome, the same rule the press
     * follows: another tool is the user's intent and wins over the affordance
     * the selection still has on screen.
     *
     * The answer is the kernel's hit vocabulary, not a second geometry: for one
     * selected element it names the handle, the rotate dot, a vertex or a
     * midpoint of a line, the body, or nothing. A miss falls through to the
     * element hit, because upstream asks the transform handles first and then
     * the hit test, and a pointer over an element with the selection tool
     * offers `move` even when that element is not selected.
     *
     * @param {Session} session
     * @param {{x: number, y: number}} point in canvas CSS pixels.
     * @param {string} [pointerType] the event's pointer kind, which sizes the handle.
     * @returns {string | null} a CSS cursor, or `null` over nothing.
     */
    function hoverCursor(session, point, pointerType = "") {
        if (!consultsChrome(toolState.currentTool)) {
            return null;
        }
        const selected = session.selectedIds();
        if (selected.length === 0) {
            return elementMoveCursor(session, point);
        }
        if (selected.length === 1) {
            const id = selected[0];
            const editing = session.editingId();
            if (editing !== undefined && editing === id) {
                // The edit mode's vertices are the only chrome drawn: the box is
                // not there to be hit, and the same `handleAt` vocabulary the
                // press uses names a vertex or the midpoint of a segment.
                return cursorForChrome(handleAt(session, point.x, point.y, id));
            }
            const hit = JSON.parse(session.hitChromeAtScreen(point.x, point.y, id, pointerType));
            // The turn only matters for a handle: the dot offers `grab` whatever
            // the angle, and the body and a point do not turn at all.
            const geometry = hit.kind === "handle"
                ? chromeGeometryOf(session, id)
                : { angle: 0, flipped: false };
            return cursorForChrome(hit, geometry.angle, geometry) ?? elementMoveCursor(session, point);
        }
        const hit = JSON.parse(session.hitSelectionChromeAtScreen(point.x, point.y, pointerType));
        // The common box is upright by construction: upstream lays a set's
        // handles at angle zero, and `ChromeFrame::upright` says the same.
        return cursorForChrome(hit) ?? elementMoveCursor(session, point);
    }

    /**
     * The vertex of the element being edited that the pointer rests over, as
     * the kernel's hover fact.
     *
     * The kernel paints the disk from the chrome it builds, so a hover the
     * client held would light a point the drawing does not; the same chrome
     * hit the cursor reads answers which point is under the pointer, and what
     * lights up is what the pointer is on, whatever the zoom says. A rest
     * over a midpoint or a body is a rest over no point: the disk goes out,
     * the way upstream's `getPointIndexUnderCursor` answers `-1` there.
     *
     * @param {object} session
     * @param {{ x: number, y: number }} at the pointer, in screen pixels.
     */
    function updateHover(session, at) {
        const editing = session.editingId();
        if (editing === undefined) {
            return;
        }
        const hit = handleAt(session, at.x, at.y, editing);
        session.setHoverVertex(editing, hit !== null && hit.kind === "vertex" ? hit.index : null);
    }

    /**
     * The one place that decides the canvas cursor.
     *
     * It used to be four separate `canvas.style.cursor = cursorFor(toolState.currentTool)`
     * calls, and any of them could have been left out of a change that added a second
     * reason for the cursor to be something else. Composing the reasons in one
     * function means a new reason is added once, not at every call site.
     *
     * The order is what the user sees, most specific first: the pan owns the
     * glass while it is armed or moving, the click-by-click zone and the crop
     * mode own it next, then a gesture in flight, then the chrome under a
     * resting pointer, and finally the active tool's own cursor.
     *
     * `session` and `point` are optional because the keyboard and the toolbar
     * ask for the cursor with no pointer event in hand; without a place there
     * is no hover to read, and the answer is the gesture's or the tool's.
     *
     * @param {Session | null} [session] the live session, when the caller has one.
     * @param {{x: number, y: number} | null} [point] where the pointer is, in canvas CSS pixels.
     * @param {string} [pointerType] the pointer kind of the event in hand.
     * @param {{ ctrlKey?: boolean, metaKey?: boolean }} [modifiers] the modifiers of the event in hand, for the answers that read them.
     */
    function syncCursor(session = null, point = null, pointerType = "", modifiers = {}) {
      canvas.style.cursor =
        panCursor({ panning: gesture !== null && gesture.kind === GESTURES.PAN, spaceHeld }) ??
        (multipoint !== null && multipointInZone ? "pointer" : null) ??
        (cropMode !== null ? "crosshair" : null) ??
        gestureCursor() ??
        (session !== null && point !== null ? textHoverCursor(session, point, modifiers) : null) ??
        (session !== null && point !== null ? hoverCursor(session, point, pointerType) : null) ??
        cursorFor(toolState.currentTool);
    }

    /**
     * The text tool's cursor over a resting pointer, from what a click there
     * would edit.
     *
     * The pin answers the hover and the click with one question, "so the
     * affordance can never promise something the click won't deliver"
     * (`App.textTool.ts`): the same target rule the press runs names the
     * road, and `cursorFor` (`App.textTool.ts:266`) reads it — the I-beam
     * over text, the pointer over an arrow, the crosshair over a shape's
     * label road and over free canvas. Ctrl or Cmd opts the container out
     * (`App.textTool.ts:128`), and a text being edited owns the glass the
     * way upstream suppresses the affordance while the editor is up.
     *
     * @param {Session} session the live session.
     * @param {{x: number, y: number}} point where the pointer rests, in canvas CSS pixels.
     * @param {{ ctrlKey?: boolean, metaKey?: boolean }} modifiers the modifiers of the move in hand.
     * @returns {string | null} the cursor, or `null` when this is not the text tool's road.
     */
    function textHoverCursor(session, point, modifiers = {}) {
        if (toolState.currentTool !== TOOLS.text) {
            return null;
        }
        if (session.editingId() !== undefined) {
            return null;
        }
        const target = textToolTargetAt(session, point.x, point.y);
        return textToolCursorFor(target, {
            ctrlOrCmd: modifiers.ctrlKey === true || modifiers.metaKey === true,
        });
    }
    canvas.style.cursor = cursorFor(toolState.currentTool);

    /** Convert a `PointerEvent` to CSS-pixel canvas coordinates. */
    function canvasPointFromEvent(event) {
        const rect = canvasRect.get();
        return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    }

    /** Alias kept for the resize handle code that runs in screen space. */
    function screenFromEvent(event) {
        return canvasPointFromEvent(event);
    }

    /**
     * Where the pointer is, in CSS pixels relative to the canvas.
     *
     * A paste lands where the pointer is, so the pointer's last position has to be
     * known even when no gesture is running: the user copies, moves the pointer
     * somewhere else and pastes, and the block comes out under the pointer rather
     * than where the copy came from.
     *
     * It starts at the canvas's origin, which is where a pointer that has never
     * moved would be.
     */
    const pointerAt = { x: 0, y: 0 };

    /**
     * Remember where the pointer is.
     *
     * @param {{x: number, y: number}} at The pointer's place in canvas coordinates.
     */
    function rememberPointer(at) {
        pointerAt.x = at.x;
        pointerAt.y = at.y;
    }

    const transformPictureOf = createTransformPicture(MIN_BOX_SIZE_CSS);

    /**
     * What the transform in flight shows: the scene a move, a resize or a turn
     * would leave if the pointer were released now, and the chrome around it.
     *
     * The picture is the kernel's: the preview applies the action the release
     * will commit, with the same arguments and the same resize floor, so the
     * client paints the answer and never computes a position of its own.
     *
     * @param {Session} session
     * @param {object} frame The committed frame the picture is painted instead of.
     * @param {object | null} state The gesture in flight.
     * @returns {ReturnType<ReturnType<typeof createTransformPicture>>}
     */
    function transformPictureAt(session, frame, state) {
        return transformPictureOf(session, frame, state);
    }

    /**
     * Resolve the text press the release ended: the drag's road mounts the
     * editor at the origin carrying the width the drag left, and the click's
     * road is the one the press armed — the label's, or the free
     * caret-at-the-click birth. Both roads close the text tool's turn the
     * way every other one does: the tool reverts unless the lock kept it
     * (`App.textTool.ts:436-452`).
     */
    /**
     * Open the label editor a sticky note's birth owes the user.
     *
     * Upstream's finalize opens the editor at the container's centre and the
     * label is born when the user confirms — the road a shape's label already
     * walks: `bindText` writes the container, the centring and the index, and
     * the kernel wraps and measures. The seat is the inserted note's own
     * centre, which only the box the kernel normalized knows.
     *
     * This lives beside `resolvePendingText` rather than inside the pointer-up
     * handler: the handler's body is scanned for kernel calls and the commit
     * table's `try` anchors its scan, so a body with a second `try` in it
     * moves the anchor — the same shape reason that pulled the text roads out
     * of the handler (TASK-7).
     *
     * @param {object} session the session the birth inserted into.
     * @param {object} ctx the paint context the confirm repaints.
     * @param {string} noteId the id the birth inserted, already selected.
     */
    function openStickyLabelEditor(session, ctx, noteId) {
        const bounds = session.boundsOf(noteId);
        const labelId = mintElementId();
        mountTextEditor({
            session,
            sceneX: (bounds[0] + bounds[2]) / 2,
            sceneY: (bounds[1] + bounds[3]) / 2,
            onCommit: (body) => {
                if (!body || body.trim() === "") {
                    return;
                }
                try {
                    session.bindText(noteId, boundTextJsonFor(labelId, body));
                    paint(session, ctx);
                } catch (error) {
                    statusLine.setProblem(`text bind failed: ${error.message ?? error}`);
                    renderStatus();
                }
            },
            onCancel: () => {},
        });
    }

    function resolvePendingText(pending, session, ctx) {
        const at = pending.originScene;
        if (pending.dragging) {
            const id = mintElementId();
            const x = pending.leftOfOrigin ? at[0] - pending.width : at[0];
            mountTextEditor({
                session,
                sceneX: at[0],
                sceneY: at[1],
                fixedWidth: pending.width,
                onCommit: (body) => {
                    // A body that is only white space is no birth at all,
                    // the way the click's road keeps.
                    if (!body || body.trim() === "") {
                        return;
                    }
                    try {
                        settleCreation(
                            createdTextJsonFor(id, body, x, at[1], pending.width),
                            id,
                            session,
                        );
                        paint(session, ctx);
                    } catch (error) {
                        statusLine.setProblem(`insert failed: ${error.message ?? error}`);
                        renderStatus();
                    }
                },
                onCancel: () => {},
            });
            if (!toolLock()) {
                setTool(TOOLS.selection);
            }
            return;
        }
        if (pending.target !== null) {
            // The label road: the kernel wraps the body at the container's
            // width, measures it, grows the shape if it does not fit and
            // centres the label in it, so the place this mount opens at is
            // only where the caret is; the box is the kernel's answer.
            const labelId = mintElementId();
            mountTextEditor({
                session,
                sceneX: at[0],
                sceneY: at[1],
                onCommit: (body) => {
                    if (!body || body.trim() === "") {
                        return;
                    }
                    try {
                        session.bindText(
                            pending.target.container,
                            pending.target.arrowLabel
                                ? arrowLabelJsonFor(labelId, body)
                                : boundTextJsonFor(labelId, body),
                        );
                        paint(session, ctx);
                    } catch (error) {
                        statusLine.setProblem(`text bind failed: ${error.message ?? error}`);
                        renderStatus();
                    }
                },
                onCancel: () => {},
            });
            if (!toolLock()) {
                setTool(TOOLS.selection);
            }
            return;
        }
        const id = mintElementId();
        mountTextEditor({
            session,
            sceneX: at[0],
            sceneY: at[1],
            onCommit: (body) => {
                if (!body || body.trim() === "") {
                    return;
                }
                try {
                    settleCreation(createdTextJsonFor(id, body, at[0], at[1]), id, session);
                    paint(session, ctx);
                } catch (error) {
                    statusLine.setProblem(`insert failed: ${error.message ?? error}`);
                    renderStatus();
                }
            },
            onCancel: () => {},
        });
        if (!toolLock()) {
            setTool(TOOLS.selection);
        }
    }

    /** Pointer down: pick a handle, an element, or empty space. */
    function onPointerDown(event, session, ctx) {
        // A press starts from a fresh box: the cache cannot see the canvas move
        // without changing size.
        canvasRect.invalidate();
        const at = screenFromEvent(event);
        rememberPointer(at);
        // Who owns the gesture in flight decides whether this pointer may act at all. A
        // pointer that arrives while a gesture is running is admitted only when it can be
        // the second finger of a pinch; everything else is refused. A third finger cannot
        // replace the pinch, and a mouse cannot take the drawing away from a finger. The
        // refusal happens before the pointer reaches the glass, so a refused finger is not
        // one of the points the pinch measures itself with.
        //
        // The question is asked of every pointer and not only of the fingers, because the
        // hole is not about touch: it is about a second pointer arriving while the first
        // one is still working. A mouse is a pointer too, and a mouse that presses a
        // button while a finger is drawing has no business taking that drawing away.
        const admission = admitPointerDown(
            {
                owners: gesture === null ? [] : gesture.owners,
                touches: [...touchPointers.keys()],
            },
            { pointerId: event.pointerId, pointerType: event.pointerType },
        );
        if (admission === ADMISSION.REFUSE) {
            return;
        }
        if (event.pointerType === "touch") {
            touchPointers.set(event.pointerId, at);
            if (admission === ADMISSION.PINCH) {
                beginPinch(event, session, ctx);
                return;
            }
        }
        // The hand tool is the pan made into a mode: a primary drag moves the
        // view, exactly the gesture the space bar and the middle button start.
        const handDrag =
            event.button === 0 && toolState.currentTool === TOOLS.hand;
        // Pen mode: a touching finger pans; the pen is what draws. The press
        // becomes the same pan the space bar starts, so the view moves under
        // the finger instead of the finger drawing a shape it did not mean.
        const penTouchPan =
            event.button === 0 && event.pointerType === "touch" && penMode();
        if (isPanGesture({ button: event.button, spaceHeld }) || handDrag || penTouchPan) {
            // A pan has no start value and no commit: it is the pointer's own movement fed
            // straight into the scroll. The delta is applied on every move rather than
            // accumulated and applied once on pointerup, because a view that does not move
            // under the hand while the hand is moving is not a pan at all.
            startGesture(GESTURES.PAN, event, panGesture.start(at));
            canvas.setPointerCapture(event.pointerId);
            syncCursor();
            return;
        }
        if (isSecondaryPress(event)) {
            // The right button starts a *session*, and the session is what decides
            // between a menu and a pan. It is checked before the `button !== 0`
            // bail below, because this is the one non-primary button that means
            // something: the middle one is already a pan above, and every other
            // button is nothing.
            //
            // The press is remembered, not acted on. Nothing happens until the
            // pointer comes back up, and by then the answer is known.
            //
            // The session remembers the pointer that began it, for the same reason the
            // gestures do: a session that belongs to nobody can be finished by anybody.
            // A finger that crosses the glass while the right button is held must not
            // turn a right-click into a right-drag, and a finger that lifts must not open
            // a menu the button was about to open.
            secondary = beginSecondaryPress(event.pointerId, at);
            return;
        }
        if (event.button !== 0) {
            return;
        }
        const start = at;
        // View mode is the gate every editing press dies at. It sits here —
        // below the pan, the pinch and the secondary button, all of which
        // answered above — so the things that are "the view" keep working
        // with the document out of reach: that is what makes the mode a way
        // of looking and not a way of freezing. Everything below this line
        // would write into the document or the selection, and a view mode
        // that let one through would be a view mode with an asterisk.
        //
        // The press is consumed silently rather than refused loudly: the
        // user is pointing at a drawing they asked to look at, and a status
        // line that scolds them for touching the canvas is a mode that
        // fights its own purpose.
        if (isViewOnly()) {
            return;
        }
        // The crop mode keeps its selection as client state until Enter commits it. The
        // image bounds and the eight crop handles use the same CSS-pixel space as input.
        const cropping = liveCropMode(session);
        if (cropping !== null) {
            const bounds = session.boundsOf(cropping.id);
            const topLeft = session.sceneToScreen(bounds[0], bounds[1]);
            const bottomRight = session.sceneToScreen(bounds[2], bounds[3]);
            const box = { left: topLeft[0], top: topLeft[1], right: bottomRight[0], bottom: bottomRight[1] };
            const modeInteraction = cropModeGeometry.begin(cropping, box, start);
            startGesture(GESTURES.CROP, event, {
                id: cropping.id,
                modeInteraction,
                startScreen: start,
                currentScreen: start,
            });
            canvas.setPointerCapture(event.pointerId);
            return;
        }
        // The chrome pieces are asked about, not guessed at. The kernel answers
        // with the same numbers it painted: the handles are checked before the
        // rotate dot, so the more specific affordance under the pointer wins,
        // and the two never overlap to begin with — the dot sits upstream's
        // distance above the frame (sixteen to twenty-eight CSS pixels, by
        // kind) and the north corner handles sit four pixels outside it.
        //
        // The box and the centre arrive in screen pixels, the same space the
        // pointer is in, so the gesture anchors itself without crossing back
        // into the scene.
        const selected = session.selectedIds();
        // The vertex being edited. This is asked before the chrome of the selection
        // because in the edit mode the vertices are the only control there is: the
        // box is not drawn while the vertices are, so a pointer on a vertex is on
        // the vertex and not on the edge of the shape.
        //
        // The element being edited is the session's own answer and not the
        // selection's, because the mode is a fact about the mode: a selection of
        // several elements has no single set of vertices, and the element being
        // edited is the one that has them.
        const editingId = session.editingId();
        if (editingId !== undefined && consultsChrome(toolState.currentTool)) {
            // The hit is the chrome's own vocabulary, the one that comes back from
            // `hitChromeAtScreen`: a vertex or a midpoint, each with its index.
            const hit = handleAt(session, start.x, start.y, editingId);
            if (hit !== null && hit.kind === "vertex") {
                // The vertex is picked before the drag begins, so a click without
                // a drag leaves it picked — which is what the `Supr` afterwards
                // takes. Upstream selects the point on the click the same way
                // (`packages/excalidraw/components/App.tsx:6205`).
                //
                // The selection is the kernel's, not the client's: the edit mode
                // ends when the element leaves the selection, and that is an event
                // this file does not own.
                session.selectVertex(hit.index);
                let dragging;
                try {
                    // The drag is opened here and closed when the pointer lifts. The
                    // kernel holds the scene as it was for the whole of it, so the
                    // gesture is one undo step however many pointermoves it took.
                    dragging = vertexGesture.start(session, editingId, hit, start);
                } catch (error) {
                    statusLine.setProblem(`vertex drag failed: ${error.message ?? error}`);
                    renderStatus();
                    return;
                }
                startGesture(GESTURES.VERTEX, event, dragging);
                canvas.setPointerCapture(event.pointerId);
                return;
            }
            if (hit !== null && hit.kind === "segment") {
                // The handle of a segment of a turning arrow. Dragging it **pins**
                // the segment: the chain is built around it, and the rule of how a
                // segment slides is the kernel's
                // (`packages/element/src/linearElementEditor.ts:2269-2350`).
                //
                // The client says which segment and where the pointer is; what
                // that means is the core's business.
                let dragging;
                try {
                    dragging = segmentGesture.start(session, editingId, hit, start);
                } catch (error) {
                    statusLine.setProblem(`segment drag failed: ${error.message ?? error}`);
                    renderStatus();
                    return;
                }
                startGesture(GESTURES.SEGMENT, event, dragging);
                canvas.setPointerCapture(event.pointerId);
                return;
            }
            if (hit !== null && hit.kind === "midpoint") {
                let inserting;
                try {
                    // The vertex is not added yet: a click on a midpoint adds
                    // nothing, and the threshold the pointer move measures is what
                    // tells a click from a drag.
                    inserting = midpointGesture.start(session, editingId, hit, start);
                } catch (error) {
                    statusLine.setProblem(`vertex insert failed: ${error.message ?? error}`);
                    renderStatus();
                    return;
                }
                startGesture(GESTURES.MIDPOINT, event, inserting);
                canvas.setPointerCapture(event.pointerId);
                return;
            }
        }
        // The chrome of the selection belongs to the selection tool. Any other tool is
        // the user's intent and wins: a drag that begins on the handle of a chosen
        // element draws over it instead of resizing it, because the toolbar tool says
        // what the pointer is for and the hit test is only the default for the case
        // where there is no tool.
        if (consultsChrome(toolState.currentTool) && selected.length === 1) {
            // The kernel tells us which chrome piece (if any) the pointer is
            // over. The shape arrives as `{kind, name, box, centre?}`.
            const hit = JSON.parse(
                session.hitChromeAtScreen(start.x, start.y, selected[0], event.pointerType),
            );
            if (hit.kind === "segment" && Number.isInteger(hit.index)) {
                let dragging;
                try {
                    dragging = segmentGesture.start(session, selected[0], hit, start);
                } catch (error) {
                    statusLine.setProblem(`segment drag failed: ${error.message ?? error}`);
                    renderStatus();
                    return;
                }
                startGesture(GESTURES.SEGMENT, event, dragging);
                canvas.setPointerCapture(event.pointerId);
                return;
            }
            if (hit.kind === "vertex" && Number.isInteger(hit.index)) {
                // The end of a chosen turning arrow answers before the resize
                // handles — the kernel says which end, and the index it names is
                // the one the chain's own list carries. The drag is the same one
                // the edit mode runs: the end follows the pointer live, and the
                // release asks the kernel what the drop means — a shape, or the
                // void. The distance the hand took the point at rides with the
                // gesture, because a point dragged by its edge keeps that
                // distance — upstream's own rule, and the reason the kernel's
                // answer carries the vertex's place.
                let dragging;
                try {
                    dragging = vertexGesture.start(session, selected[0], hit, start);
                } catch (error) {
                    statusLine.setProblem(`vertex drag failed: ${error.message ?? error}`);
                    renderStatus();
                    return;
                }
                startGesture(GESTURES.VERTEX, event, dragging);
                canvas.setPointerCapture(event.pointerId);
                return;
            }
            if (hit.kind === "midpoint" && Number.isInteger(hit.index)) {
                // The middle of a chosen line of two points: upstream shows it
                // and grabs it without the edit mode
                // (`linearElementEditor.ts:862-933`). The insert is the one the
                // edit mode runs, one undo step from press to release.
                let inserting;
                try {
                    inserting = midpointGesture.start(session, selected[0], hit, start);
                } catch (error) {
                    statusLine.setProblem(`vertex insert failed: ${error.message ?? error}`);
                    renderStatus();
                    return;
                }
                startGesture(GESTURES.MIDPOINT, event, inserting);
                canvas.setPointerCapture(event.pointerId);
                return;
            }
            const turning = rotateGesture.start(hit, selected[0], start);
            if (turning !== null) {
                startGesture(GESTURES.ROTATE, event, turning);
                canvas.setPointerCapture(event.pointerId);
                syncCursor();
                return;
            }
            if (hit.kind === "handle" && hit.name && Array.isArray(hit.box)) {
                // The start box is the element's box on the screen, which is
                // where the box-at-handle math starts from: the gesture moves
                // the box the user could see, not a second copy of it.
                //
                // The frame's turn and flip ride the gesture because the cursor
                // must keep the handle's name for the whole drag, and the drag
                // itself does not turn the element: a fling that leaves the
                // handle must not turn the cursor into the element's `move`.
                const frame = chromeGeometryOf(session, selected[0]);
                startGesture(GESTURES.RESIZE, event, {
                    ...resizeGesture.start(
                        hit.name,
                        start,
                        { left: hit.box[0], top: hit.box[1], right: hit.box[2], bottom: hit.box[3] },
                        { id: selected[0] },
                    ),
                    angle: frame.angle,
                    flipped: frame.flipped,
                });
                canvas.setPointerCapture(event.pointerId);
                syncCursor();
                return;
            }
        }
        // The chrome of a **multi**-selection belongs here too, above the
        // element hit: a corner handle of the common box sits where an
        // element may sit, and upstream asks the transform handles before it
        // asks the hit test
        // (`packages/excalidraw/components/App.selectionTool.ts:118-131`).
        // The answer carries the common box in CSS pixels — the box the
        // gesture starts from, the same one the painter drew. The body is
        // *not* taken here: a pointer over an element inside the box names
        // that element first, and the body drag only answers when the
        // pointer is over the box and over nothing.
        if (consultsChrome(toolState.currentTool) && selected.length > 1) {
            const selectionHit = JSON.parse(
                session.hitSelectionChromeAtScreen(start.x, start.y, event.pointerType),
            );
            // The turn answers first, the order the single element's own
            // chrome asks: the dot above the common box is nowhere a handle
            // lives. The kernel resolves the selection and its centre itself,
            // so the gesture carries no id.
            if (selectionHit.kind === "rotate") {
                const turning = rotateGesture.start(selectionHit, undefined, start);
                if (turning !== null) {
                    startGesture(GESTURES.ROTATE, event, turning);
                    canvas.setPointerCapture(event.pointerId);
                    syncCursor();
                    return;
                }
            }
            if (selectionHit.kind === "handle" && selectionHit.name) {
                startGesture(GESTURES.RESIZE, event, {
                    ...resizeGesture.start(
                        selectionHit.name,
                        start,
                        {
                            left: selectionHit.box[0],
                            top: selectionHit.box[1],
                            right: selectionHit.box[2],
                            bottom: selectionHit.box[3],
                        },
                        { targets: new Set(selected) },
                    ),
                    // A common box is upright: upstream lays a set's handles at
                    // angle zero, so the shared resize has no turn to apply.
                    angle: 0,
                    flipped: false,
                });
                canvas.setPointerCapture(event.pointerId);
                syncCursor();
                return;
            }
        }
        const hits = session.hitTestAtScreen(start.x, start.y, 0);
        const hitId = hits.length > 0 ? hits[0] : null;
        // The text tool. A click with the text tool active mounts the inline
        // editor at the cursor — upstream's own creation road
        // (`packages/excalidraw/components/App.textTool.ts`, measured by
        // the `create-text` receipt, d3a9c2a1, which recorded the old road
        // as a fixed `Hello` that no editor ever opened) — and the element is
        // born when the user confirms. Nothing inserts on the click itself:
        // a click the user never types into leaves no element and no
        // history entry, the way upstream's empty editor leaves nothing.
        //
        // The editor owns the body and nothing else. The settle stays here,
        // the same settle every creation shares — insert, select, back to
        // the selection tool — so a birth cannot drift from the creations
        // the rest of the pipeline makes. The birth document is
        // `createdTextJsonFor`'s, the fields the receipt measured. There is
        // no `setPointerCapture`: the gesture is a single click, not a drag,
        // and the rest of the pointer event flow is uninteresting.
        if (toolState.currentTool === TOOLS.text) {
            // The press asks the browser to keep its default away. The
            // compatibility `mousedown` this click would end with hits the
            // canvas, whose default action moves the focus — and the sheet
            // the mount below focuses would take that blur and close before
            // the first key ever landed, so every creation click would die
            // inside the same event turn that opened it. No unit suite can
            // see the death: the shared fake's focus is a stub nothing
            // steals, which is why every suite stayed green over a page that
            // swallowed the click. The live walk that proves the fix is
            // `scripts/e2e/text-create.test.mjs`.
            event.preventDefault();
            if (mountTextEditor === null) {
                return;
            }
            // What the click means is the kernel's answer, not this file's:
            // a text under the pointer is edited, an empty container whose
            // centre the click is near gets its label, and anywhere else is
            // free text (TEXT-03, TEXT-04). The container is looked for by
            // box, so a click in the middle of an unfilled shape is a label
            // even though the shape's own hit test has no interior to hit.
            const target = textToolTargetAt(session, start.x, start.y);
            if (target !== null && target.text !== undefined) {
                // The click landed on a text — a shape's label included. The
                // canvas's double click owns that road, and it is the one
                // that already knows how to open an editor over an element;
                // asking it is what keeps the two roads from drifting.
                //
                // One bit travels with it: this road seats the caret where
                // the click landed (upstream's text tool hands the editor
                // `initialCaretSceneCoords`, App.textTool.ts:296-300), while
                // a real double click does not. The flag rides the event
                // object the listener reads.
                const rect = canvasRect.get();
                const at = {
                    clientX: rect.left + start.x,
                    clientY: rect.top + start.y,
                    bubbles: true,
                    cancelable: true,
                    caretAtClick: true,
                };
                if (typeof MouseEvent === "function") {
                    const road = new MouseEvent("dblclick", at);
                    road.caretAtClick = true;
                    canvas.dispatchEvent(road);
                } else {
                    canvas.dispatchEvent("dblclick", at);
                }
                // The finish reverts only when the tool is not locked
                // (`App.textTool.ts:436-452`), and the double click's road is
                // the text tool's finish like every other one.
                if (!toolLock()) {
                    setTool(TOOLS.selection);
                }
                return;
            }
            if (target !== null) {
                // The label road joins the deferral: a drag that starts on a
                // container is not the click's gesture — it is the birth of a
                // free text the drag sizes, and the release decides
                // (`App.textTool.ts`, the pending road's `resolvePending`).
                pendingText = {
                    owner: event.pointerId,
                    originScreen: start,
                    originScene: session.screenToScene(start.x, start.y),
                    target,
                    dragging: false,
                    width: 0,
                    leftOfOrigin: false,
                };
                canvas.setPointerCapture(event.pointerId);
                return;
            }
            // The free road defers the same way: the editor opens on the
            // release, and the drag the press grows into decides what the
            // birth will be — a click keeps the caret-at-the-click birth, a
            // drag past the autowrap threshold fixes the width first. The
            // editor an upstream drag carries is open from the press with an
            // empty body; this one opens at the release, and the difference
            // lives in a moment where both sheets are blank.
            pendingText = {
                owner: event.pointerId,
                originScreen: start,
                originScene: session.screenToScene(start.x, start.y),
                target: null,
                dragging: false,
                width: 0,
                leftOfOrigin: false,
            };
            canvas.setPointerCapture(event.pointerId);
            return;
        }
        // H6.12 freehand. Upstream's contract, read at `App.tsx:8269-8330`:
        // the element's origin is the scene point of the press, the first
        // point is the origin itself, and the pressures are empty when the
        // pressure is simulated.
        //
        // `simulatePressure` is upstream's own test — `event.pressure === 0.5` —
        // and not a guess. A mouse reports exactly `0.5` for as long as it is
        // held down, so a mouse can never carry a real pressure, and a stroke
        // that pretended to have one would be flat. Upstream therefore reads
        // the pressure only from a pointer that reports something else.
        //
        // The streamline follows the *kind* of pointer rather than a setting
        // (`App.tsx:8305-8309`): a mouse gets 0.5 and anything else — a
        // stylus, a finger — gets 0.2, because the mouse's flat pressure
        // needs the extra smoothing to not look like a polygon.
        if (toolState.currentTool === TOOLS.freedraw) {
            // The kernel reads the zoom once, here, and measures the stroke with it
            // for its whole life; the strategy opens the stroke and keeps the origin.
            // The identity rides the press for the same reason the draw tool's does:
            // the trail the user is watching and the element the release inserts are
            // one element.
            startGesture(
                GESTURES.FREEDRAW,
                event,
                freedrawGesture.start(session, start, {
                    pressure: event.pressure,
                    pointerType: event.pointerType,
                }, { id: mintElementId(), seed: freshSeed() }),
            );
            canvas.setPointerCapture(event.pointerId);
            return;
        }
        // H6.12 eraser. The gesture is the *trail*, not a box: the kernel keeps the
        // path the pointer travelled through and decides what it crosses, and the
        // client only says where the pointer is. The elements it crosses are
        // marked, not deleted — upstream erases on the release
        // (`App.tsx:10126`), so one stroke is one undo step and the elements it
        // will erase can still be drawn faded while the pointer is down.
        if (toolState.currentTool === TOOLS.eraser) {
            // The elements the stroke has marked are the kernel's answer, not the
            // client's: the rule that decides what a stroke crosses lives in the core,
            // and a client copy of it would be a second truth about a rule that has to
            // agree with upstream's to the pixel. The ink under the pointer is not in
            // the gesture either: it decays with the clock, so it is asked of the
            // kernel at the instant it is painted and never cached here.
            startGesture(GESTURES.ERASER, event, eraserGesture.start(session, start, nowMs()));
            canvas.setPointerCapture(event.pointerId);
            return;
        }
        // The laser pointer. The gesture is the trail, and the trail is the
        // *only* thing the tool produces: no element, no selection change, no
        // history entry. Upstream starts a path in its laser overlay and
        // touches nothing else (`laserTrails.ts:44-55`), which is what makes
        // the tool a pointer and not a pen.
        //
        // The points are screen pixels — the space the pointer reports, the
        // space the paint draws in, and the space upstream's fixed overlay
        // lives in — so a point marks where the laser *was*. Panning under a
        // fading trail moves the drawing and not the trail, the way a real
        // laser dot stays where it was shone.
        //
        // The kernel is never called. A gesture the table says commits
        // nothing has nothing to hand it, and the capture is still taken so
        // the pointer's release cannot escape the gesture that owns it.
        if (toolState.currentTool === TOOLS.laser) {
            startGesture(GESTURES.LASER, event, laserGesture.start(laserTrail, start, nowMs()));
            canvas.setPointerCapture(event.pointerId);
            return;
        }
        // A draw tool is the loudest affordance: with a rectangle, ellipse,
        // diamond, line or arrow tool active the next drag is always a new
        // shape, never a selection. This matches Excalidraw: the toolbar
        // tool is the user's intent, the hit-test is a default for the
        // no-tool case. The user goes back to the selection tool with
        // `Escape` (or `V` once it lands) to recover the default.
        //
        // The hit-test used to be able to veto this: a drag that started on
        // top of an existing element translated it instead of drawing over
        // it. That condition was introduced in H4.1 and it contradicted the
        // sentence above, which described the behaviour the code did not
        // have. It also made the freehand tool a trap — the second stroke
        // drawn over the first would move the first instead of landing next
        // to it. The condition is gone: the tool decides, and the hit-test
        // only decides what happens with the selection tool.
        if (toolState.currentTool !== TOOLS.selection) {
            // A press while the click-by-click mode is open belongs to the
            // drawing, not to the tool: it either ends the drawing — a click
            // back inside the commit zone, a path that closed its own loop —
            // or it selects the drawing and lets it grow. The press never
            // starts a drag, which is what keeps the mode's clicks from
            // becoming shapes.
            const drawing = liveMultipoint();
            if (drawing !== null) {
                const scene = session.screenToScene(start.x, start.y);
                const answer = multipointMode.press(drawing, { x: scene[0], y: scene[1] }, session);
                multipoint = answer.state;
                if (answer.finalize) {
                    endMultipoint(session, ctx);
                } else {
                    paint(session, ctx);
                }
                return;
            }
            // The identity rides the press: the draft the user is watching and
            // the element the release will insert are one element (TASK-132),
            // so the id, the seed and the arrow kind are minted here, where
            // the tool and its sub-type are in hand, and not re-asked at the
            // release.
            startGesture(GESTURES.DRAW, event, drawGesture.start(toolState.currentTool, start, {
                id: mintElementId(),
                seed: freshSeed(),
                arrowType: toolState.arrowType,
                ...(toolState.currentTool === TOOLS.stickynote ? { created: dateNowMs() } : {}),
            }));
            canvas.setPointerCapture(event.pointerId);
            return;
        }
        // Ctrl/Cmd turns the press into a box instead of a drag
        // (`WF-SELECT-05`): upstream marks the pointer-down with
        // `withCmdOrCtrl` and refuses to move the elements for the whole of
        // the gesture, so the marquee it created on the press is what grows.
        // On the release, a press that never became a drag is the deep
        // selection of `WF-SELECT-06`, which the page's click answers.
        //
        // The chrome above was consulted first, so Ctrl on a handle still
        // resizes: upstream's handle hit test runs before the modifier
        // branch too.
        const ctrlOrMeta = event.ctrlKey === true || event.metaKey === true;
        if (hitId === null) {
            // The body of a selection: a pointer inside its box and over
            // nothing names the selection itself, and the drag moves it whole.
            //
            // A multi-selection answers with the common box (upstream's
            // `isOverBoundingBox`, `App.selectionTool.ts:118-131`). A single
            // element answers with its own chrome's `body`, which is the
            // element's box — and that is what makes a selected **unfilled**
            // shape draggable from its interior: upstream's hit test takes a
            // selected element by its bounding box before it asks for the ink
            // (`App.hitElement`: "if the element is selected, then hit test is
            // done against its bounding box"), while an unselected one is still
            // chosen by its outline (WF-SELECT-03). A pointer outside the box
            // is the marquee it always was.
            if (!ctrlOrMeta && consultsChrome(toolState.currentTool) && selected.length > 0) {
                const selectionHit = JSON.parse(
                    selected.length > 1
                        ? session.hitSelectionChromeAtScreen(start.x, start.y, event.pointerType)
                        : session.hitChromeAtScreen(
                              start.x,
                              start.y,
                              selected[0],
                              event.pointerType,
                          ),
                );
                if (selectionHit.kind === "body") {
                    startGesture(
                        GESTURES.TRANSLATE,
                        event,
                        {
                            ...translateGesture.start(start, selected[0], new Set(selected)),
                            // The press landed on the **selection** and not on
                            // an element: a lift with no travel is a click on
                            // the selection, and it keeps it. The reference
                            // resolves the selection on pointerdown, where a
                            // selected element is hit by its box, so a click in
                            // the middle of a selected unfilled shape does not
                            // clear it (`KEY-13` measures exactly that click).
                            fromSelectionBody: true,
                        },
                    );
                    canvas.setPointerCapture(event.pointerId);
                    return;
                }
            }
            // Drag-on-empty is the marquee: a rubber-band rectangle the
            // kernel will compare against every element's AABB. Shift
            // keeps the additive behaviour that shift-click on a single
            // element already has, so a user who already has a few
            // elements selected and wants to grab one more corner of
            // the canvas doesn't lose them when the marquee lifts. With no
            // element under the press there is no fallback hit to carry, so
            // Ctrl/Cmd changes nothing here.
            startGesture(GESTURES.MARQUEE, event, marqueeGesture.start(start, event.shiftKey));
        } else if (ctrlOrMeta) {
            // The press is on an element: the marquee carries the element so
            // that a box which catches nothing keeps it (plus its group),
            // the way upstream's box rule does.
            startGesture(
                GESTURES.MARQUEE,
                event,
                marqueeGesture.start(start, event.shiftKey, { hit: hitId }),
            );
        } else {
            // A plain press on a shape the selection does not hold **chooses
            // it**, before the drag starts. Upstream resolves the selection on
            // pointerdown (`App.selectionTool.ts:326-428`: `clearSelection`
            // when the hit is outside the selection and not Shift, then
            // `selection.add(hitElement)`), and the chrome follows the
            // selection: a drag that kept the previous selection would move
            // one shape while drawing a different shape's handles and
            // outline. `arrow-follows-box` measured exactly that — the box
            // moved, its bound arrow followed, and the chrome stayed on the
            // arrow with no box around the shape that had just been dragged.
            //
            // Only the plain press takes this road. Shift's toggle
            // (`selectAt`), Alt's cycle and Ctrl/Cmd's deep pick belong to the
            // release or to the marquee above, and a press on **any** selected
            // shape under the pointer keeps the selection it found — upstream's
            // `someHitElementIsSelected` guard.
            if (
                !event.shiftKey &&
                !event.altKey &&
                !hits.some((id) => session.isSelected(id))
            ) {
                session.selectUnit(hitId);
            }
            startGesture(
                GESTURES.TRANSLATE,
                event,
                translateGesture.start(start, hitId, dragTargetsFor(hitId, session)),
            );
        }
        // Capture the pointer so a drag that leaves the canvas (the user drags
        // off-screen to a second monitor, say) still gets `pointermove` and
        // `pointerup` on the canvas, which is the only way to commit a
        // translation that went past the canvas edge.
        canvas.setPointerCapture(event.pointerId);
    }

    /**
     * Two fingers on the glass: the drawing becomes a pinch.
     *
     * The gesture the first finger started is discarded before the pinch begins.
     * A box that is half drawn on the screen would land on the canvas when the
     * finger lifts, and a pinch that is also a drawing is a drawing nobody asked
     * for. The rule is the one a cancelled gesture follows — `cancelGesture`
     * throws away what was in flight — because it is the same situation: a
     * gesture the user did not finish.
     *
     * The anchor is read now, before anything moves: it is the scene under the
     * middle of the fingers, and the whole gesture is about keeping it there.
     *
     * @param {PointerEvent} event the finger that arrived second
     * @param {Session} session
     * @param {object} ctx the paint context
     */
    function beginPinch(event, session, ctx) {
        if (gesture !== null) {
            cancelGesture(gesture.kind, session, () => paint(session, ctx));
            gesture = null;
        }
        const points = [...touchPointers.values()];
        const centre = pinchCentre(points);
        const anchor = session.screenToScene(centre.x, centre.y);
        gesture = {
            ...pinchGesture.start(points, session.zoom(), { x: anchor[0], y: anchor[1] }),
            // The pinch is the one gesture with two owners: either finger may move the
            // view and either finger lifting ends it. That is what makes it one gesture
            // rather than two that happen to agree.
            owners: [...touchPointers.keys()],
        };
        canvas.setPointerCapture(event.pointerId);
    }

    /**
     * One frame of a pinch: a finger moved, so the view follows.
     *
     * The order is the whole of the trick, and it lives in `client/pinch-frame.mjs`
     * rather than here: the zoom first, then the scene under the fingers read at the
     * new scale, then the pan that puts the anchor back under them. The page and
     * the two suites that judge it run the same function, so a page that scaled
     * about the wrong point could not pass a suite that proved another point works.
     *
     * @param {PointerEvent} event
     * @param {Session} session
     */
    function applyPinch(event, session) {
        if (!touchPointers.has(event.pointerId)) {
            return;
        }
        touchPointers.set(event.pointerId, screenFromEvent(event));
        const points = [...touchPointers.values()];
        if (points.length < 2) {
            return;
        }
        try {
            gesture = pinchGesture.move(session, gesture, points);
        } catch (error) {
            statusLine.setProblem(`pinch failed: ${error.message ?? error}`);
            renderStatus();
        }
    }

    /**
     * The pinch is over: a finger lifted, or the browser took it.
     *
     * A pinch commits nothing — the view moved, the drawing did not — so there is
     * nothing to hand the kernel and nothing to put in the history. The fingers go
     * with it: the one that stayed on the glass does not become a drawing
     * gesture, because the gesture it started was cancelled when the second
     * finger arrived. A finger that is still down and a new one that arrives make
     * a new pinch, which is the right answer for two fingers that are meant to
     * pinch.
     */
    function endPinch() {
        for (const id of touchPointers.keys()) {
            try {
                canvas.releasePointerCapture(id);
            } catch {
                // The browser already gave the capture back; there is nothing left
                // to release and nothing to commit.
            }
        }
        touchPointers.clear();
        gesture = null;
        syncCursor();
    }

    /** Pointer move: keep the gesture state current; the re-paint reads it. */
    function onPointerMove(event, session) {
        // Where the pointer is is remembered whether or not a gesture is running: a
        // paste lands under the pointer, and the user may have moved the pointer
        // while a gesture was in flight.
        rememberPointer(canvasPointFromEvent(event));
        // Only the pointer that owns the gesture in flight may move it. A third finger
        // that slides across the glass must not drag the box the first finger is drawing,
        // and a mouse that moves while a finger is drawing must not move that drawing
        // either. The gesture belongs to one pointer, and everything about it — where it
        // goes and when it ends — is answered to that pointer alone.
        if (gesture !== null && !ownsGesture(gesture.owners, event.pointerId)) {
            return;
        }
        if (gesture !== null && gesture.kind === GESTURES.PINCH) {
            applyPinch(event, session);
            return;
        }
        const next = screenFromEvent(event);
        // The pending text press tracks its drag: the first move past the
        // autowrap threshold turns the click into a drag that sizes the birth,
        // and the width it leaves is the last move's, floored, anchored on the
        // origin the press made (`dragNewTextElement`,
        // `dragElements.ts:280-313` — the anchor recomputes per move, so the
        // side is where the pointer last was). The threshold is upstream's
        // screen-space rule — `Math.abs(pointerCoords.x - origin.x) * zoom`
        // is the travel in screen pixels, so the port reads the screen travel
        // directly. A tool that moved on mid-press orphans the click,
        // upstream's own cancel.
        if (pendingText !== null && pendingText.owner === event.pointerId) {
            if (toolState.currentTool !== TOOLS.text) {
                pendingText = null;
                return;
            }
            const travel = next.x - pendingText.originScreen.x;
            if (!pendingText.dragging) {
                if (Math.abs(travel) > TEXT_AUTOWRAP_THRESHOLD) {
                    pendingText.dragging = true;
                }
            }
            if (pendingText.dragging) {
                const at = session.screenToScene(next.x, next.y);
                const dx = at[0] - pendingText.originScene[0];
                pendingText.width = Math.max(Math.abs(dx), MIN_TEXT_WIDTH);
                pendingText.leftOfOrigin = dx < 0;
            }
            return;
        }
        if (secondary !== null && secondary.owner === event.pointerId) {
            const transition = moveSecondaryPress(secondary, event.pointerId, next);
            secondary = transition.state;
            if (transition.startedPan) {
                // This is the presentation/effect side of the transition: the
                // pure session decided when the drag became a pan; the pipeline
                // starts the gesture at the crossing point and captures input.
                startGesture(GESTURES.PAN, event, panGesture.start(transition.panStart));
                canvas.setPointerCapture(event.pointerId);
                syncCursor();
            }
        }
        if (!gesture) {
            // The click-by-click drawing aims with the pointer itself: a hover
            // move carries the rubber band the user sights the next corner
            // with, and says whether the pointer has come back inside the
            // commit zone, which is the cursor's business. The branch sits
            // below the ownership question because a move that cannot act on
            // a gesture cannot act on the drawing either.
            if (liveMultipoint() !== null) {
                const scene = session.screenToScene(next.x, next.y);
                const answer = multipointMode.move(multipoint, { x: scene[0], y: scene[1] });
                multipoint = answer.state;
                multipointInZone = answer.pointer;
                syncCursor();
            } else {
                // A resting pointer is the only moment the chrome can advertise
                // what a press would do. The hit and the frame are both the
                // kernel's and the painter's own answers, so the cursor under
                // the pointer and the square it is over are the same object.
                syncCursor(session, next, event.pointerType, { ctrlKey: event.ctrlKey, metaKey: event.metaKey });
                // The hover of the editor's own points: a move that rests over
                // a vertex lights it up, and a move that rests over nothing
                // puts the light out. The move is the only writer the fact
                // has — upstream writes `hoverPointIndex` on the move alone
                // (`packages/excalidraw/components/App.tsx:7419-7472`), which
                // is why a release that lands where no move happened leaves
                // the disk where it was.
                updateHover(session, next);
            }
            return;
        }
        if (gesture.kind === GESTURES.PAN) {
            // The view moves under the hand on every move; see `client/gestures/pan.mjs`.
            gesture = panGesture.move(session, gesture, next);
        } else if (gesture.kind === GESTURES.LASER) {
            // The trail is fed as the pointer travels, in the screen pixels the event
            // reports, and the kernel is never asked: the tool has nothing to say to the
            // document. The paint asks for the alive points at its own instant, which is
            // what makes the fade the trail's and not the gesture's.
            gesture = laserGesture.move(laserTrail, gesture, next, nowMs());
        } else if (gesture.kind === GESTURES.ROTATE) {
            // Shift is read on every move, as upstream reads it: holding it locks the
            // angle to fifteen degrees, and letting it go frees the angle again.
            gesture = rotateGesture.move(gesture, next, event.shiftKey === true);
        } else if (gesture.kind === GESTURES.MARQUEE) {
            gesture = marqueeGesture.move(gesture, next);
        } else if (gesture.kind === GESTURES.TRANSLATE) {
            // The two modifiers of a move are read from the pointer itself, as upstream
            // reads them: Shift on every move locks the axis (`App.selectionTool.ts`) and
            // Alt on any move starts the duplicated drag (`App.duplicate.ts`). Reading
            // them from the pointer rather than from a keyboard flag is what makes the
            // gesture's own events the only truth about what the user held.
            gesture = translateGesture.move(gesture, next, {
                shift: event.shiftKey === true,
                alt: event.altKey === true,
            });
        } else if (gesture.kind === GESTURES.RESIZE) {
            gesture = resizeGesture.move(gesture, next);
        } else if (gesture.kind === GESTURES.DRAW) {
            gesture = drawGesture.move(gesture, next, event.ctrlKey === true || event.metaKey === true);
            // The hover of a straight gesture's own end: upstream's editor
            // exists through the draw, and every move writes
            // `hoverPointIndex` with the point under the pointer — the moving
            // end of a two-point drag
            // (`packages/excalidraw/components/App.tsx:7419-7472`). Nothing
            // lights while the drag runs (there is no chrome for an element
            // that is not born yet), and the disk lights where the drag let
            // go. A shape with no vertices carries no hover, and the move
            // says so rather than leaving a disk on a stale element.
            if (gesture.tool === TOOLS.line || gesture.tool === TOOLS.arrow) {
                session.setHoverVertex(gesture.id, 1);
            } else {
                session.setHoverVertex(gesture.id, null);
            }
        } else if (gesture.kind === GESTURES.ERASER) {
            // The kernel answers one question: what the stroke has marked. `alt` is
            // upstream's own way of *un*-erasing (`App.tsx:7371`).
            gesture = eraserGesture.move(session, gesture, next, nowMs(), event.altKey);
        } else if (gesture.kind === GESTURES.FREEDRAW) {
            // The stroke is the one gesture whose *result* is a function of every
            // position the pointer passed through, so the positions are collected as
            // they happen. The kernel owns the ink; the client owns the path.
            gesture = freedrawGesture.move(gesture, next, event.pressure);
        } else if (gesture.kind === GESTURES.CROP) {
            // Two answers, two owners: the gesture's own moment moves the pointer
            // (`client/gestures/crop.mjs`), and the persistent crop mode's region
            // is the mode's geometry. Neither writes the document while the
            // pointer is down.
            const modeInteraction = { ...gesture.modeInteraction, current: next };
            cropMode = cropModeGeometry.move(modeInteraction, modeInteraction.box, next);
            gesture = { ...cropGesture.move(gesture, next), modeInteraction };
        } else if (gesture.kind === GESTURES.VERTEX) {
            // The vertex follows the pointer, at the distance the hand took it:
            // the pointer's travel is measured from where the pointer went down,
            // and the point's own place rides the offset the grab preserved. The
            // kernel moves the point in the document itself, live, and the capture
            // the drag holds is what keeps the whole gesture to one undo step — so
            // the drawing on the screen is the drawing the document holds, and not
            // a ghost of it.
            try {
                gesture = vertexGesture.move(
                    session,
                    gesture,
                    next,
                    event.ctrlKey === true || event.metaKey === true,
                );
            } catch (error) {
                statusLine.setProblem(`vertex drag failed: ${error.message ?? error}`);
                renderStatus();
            }
        } else if (gesture.kind === GESTURES.MIDPOINT) {
            // The vertex is added when the pointer has travelled far enough to be
            // a drag and not a click, and it is added under the pointer.
            try {
                gesture = midpointGesture.move(session, gesture, next);
            } catch (error) {
                statusLine.setProblem(`vertex insert failed: ${error.message ?? error}`);
                renderStatus();
            }
        } else if (gesture.kind === GESTURES.SEGMENT) {
            // The segment follows the pointer. The kernel pins it in the document
            // itself, live, and the capture the drag holds is what keeps the whole
            // gesture to one undo step — so the drawing on the screen is the
            // drawing the document holds, and not a ghost of it.
            try {
                gesture = segmentGesture.move(session, gesture, next);
            } catch (error) {
                statusLine.setProblem(`segment drag failed: ${error.message ?? error}`);
                renderStatus();
            }
        }
        // The shape under the hand does not change while the hand moves, except
        // for the box a resize is growing; the gesture's own cursor is the one
        // the press advertised, and keeping it here is what stops a move that
        // left the handle from turning into the element's `move` mid-drag.
        syncCursor(session, next, event.pointerType, { ctrlKey: event.ctrlKey, metaKey: event.metaKey });
    }

    /** Pointer up: commit a resize, a drag, or a click. */
    function onPointerUp(event, session, ctx) {
        // A pointer that does not own the gesture in flight cannot end it. The drawing in
        // the middle of a drag belongs to the pointer that began the drag, so a finger
        // that was refused — or a finger that arrives late — must not commit what another
        // finger was drawing. The release is ignored, and the gesture carries on under the
        // pointer that owns it until that one lifts.
        if (gesture !== null && !ownsGesture(gesture.owners, event.pointerId)) {
            forgetTouch(event);
            return;
        }
        if (gesture !== null && gesture.kind === GESTURES.PINCH) {
            endPinch();
            return;
        }
        forgetTouch(event);
        if (secondary !== null) {
            const transition = finishSecondaryPress(secondary, event.pointerId);
            if (!transition.matched) {
                // Another pointer cannot end the pending secondary-button session.
                return;
            }
            secondary = transition.state;
            if (transition.intent.kind === "open-menu") {
                openContextMenuAt(transition.intent.at, session, ctx);
                return;
            }
            // A drag became a pan; the ordinary path below releases capture.
        }
        // The pending text press resolves on the release: a drag past the
        // autowrap threshold mounts the editor at the origin with the width
        // the drag left, and the birth carries it (`TEXT-02`,
        // `dragNewTextElement`, `dragElements.ts:280-313` — the anchor rule
        // `anchorRatio: x < originX ? 1 : 0` puts the box's far edge where the
        // drag ended). A release that never dragged is the click the press
        // armed — the label's road or the free caret-at-the-click birth — and
        // a tool that moved on mid-press orphans the click, upstream's cancel.
        if (pendingText !== null && pendingText.owner === event.pointerId) {
            const pending = pendingText;
            pendingText = null;
            if (toolState.currentTool !== TOOLS.text) {
                return;
            }
            resolvePendingText(pending, session, ctx);
            return;
        }
        if (!gesture) {
            // A release with no gesture in flight belongs to the click-by-click
            // drawing when it is open: the release is what fixes the vertex the
            // rubber band was carrying, which is what makes a click a corner.
            // The first click does not come through here — it opens the mode at
            // the end of its own gesture — so what this sees are the clicks
            // that grow the drawing.
            if (liveMultipoint() !== null) {
                multipoint = multipointMode.commit(multipoint);
                multipointInZone = false;
                paint(session, ctx);
                return;
            }
            return;
        }
        const completed = gesture;
        const dxScreen = completed.currentScreen.x - completed.startScreen.x;
        const dyScreen = completed.currentScreen.y - completed.startScreen.y;
        const moved = Math.hypot(dxScreen, dyScreen) >= DRAG_THRESHOLD_CSS;
        gesture = null;
        try {
            // Above the commit table, not below it: a gesture that takes a capture has to
            // give it back whether or not it turns into an edit. The pan branch used to
            // return without releasing, which happened to be harmless because the browser
            // releases implicitly on pointer-up — and "harmless by accident" is not the
            // reason to leave a resource held.
            canvas.releasePointerCapture(event.pointerId);
        } catch {
            // The pointer was already released; the capture is gone, and
            // there is nothing to commit. The gesture is still committed below
            // if it moved.
        }
        if (!commits(completed.kind)) {
            // A gesture the table says commits nothing has already done its work, one pointer
            // event at a time. There is nothing to hand the kernel and nothing to put in the
            // history: the user moved the view to look at something rather than changing the
            // drawing. A refactor that routed the view through an `Action` would make every
            // drag one undo step, which is the bug H4.4 fixed for translate.
            syncCursor();
            return;
        }
        try {
            if (completed.kind === GESTURES.ROTATE) {
                rotateGesture.commit(session, completed);
                paint(session, ctx);
                return;
            }
            if (completed.kind === GESTURES.RESIZE) {
                // A resize is a single dispatch per gesture, regardless of
                // distance. Even a one-pixel drag of a handle is the user saying
                // "this is the box now" — anything less leaves the kernel no
                // decision to make, because the gesture is what carries the
                // intent.
                //
                // The box is the kernel's too: the client hands over the box
                // the chrome drew, the handle the drag took and the travel of
                // the pointer, and the kernel measures the box the pointer
                // chose, converts it to the scene and applies it. A lone
                // element and a group are one door: the kernel reads from the
                // number of ids which of the two rules applies, and a group is
                // resized through the scales the kernel reads off the two
                // boxes.
                resizeGesture.commit(session, completed, MIN_BOX_SIZE_CSS);
                paint(session, ctx);
                return;
            }
            if (completed.kind === GESTURES.CROP) {
                finishCropInteraction(session, ctx, completed, event);
                return;
            }
        if (completed.kind === GESTURES.DRAW) {
            // Commit the shape the drag drew. The screen-to-scene conversion
            // is literally the same call the resize branch makes, so a
            // 1-CSS-pixel drag is the smallest box the kernel will
            // accept. Below
            // that the gesture was a tap on the empty canvas with a draw
            // tool active, and the right answer is "nothing happened",
            // not a microscopic shape.
            // The release is read from the event rather than from the last move,
            // because the pointer may travel between the two and the release is the
            // point the user actually chose. A straight gesture too short to be a
            // line is the opening of the click-by-click mode, whose next clicks are
            // corners and whose Escape or Enter finishes it; the mode is a client
            // affair and the document is written once, when the drawing ends.
            // The id and the seed are the gesture's own, minted at the press — the
            // element the preview drew is the element this inserts.
            const drawn = drawGesture.commit(session, completed, screenFromEvent(event), {
                pointerType: event.pointerType,
                // The two modifiers of the lift, as upstream reads them on its own
                // finalize: Ctrl/Cmd is "binding off" (the arrow is born untied) and
                // Alt forces the inside tie at the pointer.
                bindingOff: event.ctrlKey === true || event.metaKey === true,
                alt: event.altKey === true,
            });
                if (drawn.kind === "multipoint") {
                    multipoint = multipointMode.begin(
                        completed.tool,
                        toolState.arrowType,
                        drawn.from,
                        session.zoom(),
                    );
                    multipointInZone = false;
                    syncCursor();
                    return;
                }
                if (drawn.kind === "tiny") {
                    return;
                }
                settleCreation(drawn.json, drawn.id, session, drawn.ends);
                paint(session, ctx);
                // The note's birth hands the page to its label: upstream's
                // finalize reverts the tool (which `settleCreation` already did)
                // and opens the editor at the container's centre
                // (`App.tsx:9930-9951` `startTextEditing` with `container`), and
                // the lock keeps both the tool and the silence — its branch
                // returns before the editor.
                if (completed.tool === TOOLS.stickynote && !toolLock()) {
                    openStickyLabelEditor(session, ctx, drawn.id);
                }
                return;
            }
            if (completed.kind === GESTURES.FREEDRAW) {
                // A cancelled pointer does not reach this function: cancellation has
                // its own path (`onPointerCancel`), and the rule it follows is
                // upstream's — the element it inserted on pointer-down is discarded
                // when the pointer is cancelled (`handleCanvasPointerCancel` →
                // `maybeCleanupAfterMissingPointerUp`), so a stroke the browser took
                // away leaves nothing behind.
                // Upstream appends the release point from the pointer-up event
                // itself, not from the last move (`App.tsx:9722-9752`): the
                // release carries the coordinates the pointer actually left the
                // canvas with, which the last move does not necessarily have.
                // The id and the seed are the gesture's own, minted at the press.
                const stroke = freedrawGesture.commit(
                    session,
                    completed,
                    screenFromEvent(event),
                    event.pressure,
                );
                settleCreation(stroke.json, stroke.id, session);
                paint(session, ctx);
                return;
            }
            if (completed.kind === GESTURES.ERASER) {
                // A cancelled pointer does not reach this function either. The
                // eraser is the one gesture that needs its own way to say it was
                // abandoned, because it *marks* the elements it crosses while the
                // pointer is down and deletes them on release: ending the gesture
                // here would delete everything it marked. The freehand stroke above
                // already says why cancellation is not a release
                // (`App.tsx:9722-9752`), and the eraser is where that difference
                // bites.
                // The deletion happens here and not on every move, so that one
                // stroke is one undo step: a single `Cmd+Z` brings back every
                // element the stroke erased, not one per element.
                //
                // The kernel answers with the ids it removed, and they are
                // what the pictures are released against: an element the
                // eraser took is gone, and the bytes it was holding are
                // memory for a picture nobody can see. The ids used to be
                // ignored here, so an erased picture stayed in the cache for
                // the rest of the session — megabytes at a time.
                for (const id of eraserGesture.commit(session).removed) {
                    forgetImageFor(id);
                }
                paint(session, ctx);
                return;
            }
            if (completed.kind === GESTURES.SEGMENT) {
                // The drag ends here. The elbow moved while the pointer was down,
                // and the capture the drag held is what made that **one** undo step
                // instead of one per pointermove — so ending it is what puts the
                // scene as it was before the drag on the history, and the drawing is
                // already where the pointer left it.
                //
                // A handle that was clicked and not dragged pins the segment where it
                // already was, and the capture closes with the scene as it was: the
                // kernel notices that nothing changed and leaves the history alone.
                segmentGesture.commit(session);
                paint(session, ctx);
                return;
            }
            if (completed.kind === GESTURES.VERTEX) {
                // The drag ends here. The drawing moved while the pointer was down,
                // and the capture the drag held is what made that **one** undo step
                // instead of one per pointermove — so ending it is what puts the
                // scene as it was before the drag on the history, and the drawing is
                // already where the pointer left it.
                //
                // A drag that did not move ends the same way: the capture closes and
                // the kernel notices that the scene did not change, so nothing is
                // left on the history.
                //
                // The two ends of a turning arrow are the exception that answers a
                // question when they land: the kernel decides what the drop means —
                // the shape it lands on, or the void — and the call sits inside the
                // capture, so the drag and its answer are the same undo step. The
                // first vertex is the end the arrow leaves from; every other one is
                // read as the end it arrives at, which is what the index means on
                // the arrows that turn. A straight arrow's ends speak another
                // binding vocabulary and the kernel leaves them alone when they are
                // asked here, so the call is safe on every vertex the mode drags.
                // The two modifiers of the lift are upstream's own: Ctrl/Cmd lets
                // the end go, Alt forces the inside tie at the pointer.
                vertexGesture.commit(
                    session,
                    completed,
                    screenFromEvent(event),
                    event.ctrlKey === true || event.metaKey === true,
                    event.altKey === true,
                );
                paint(session, ctx);
                return;
            }
            if (completed.kind === GESTURES.MIDPOINT) {
                // The insert ends here. The vertex was added while the pointer was
                // down, and the capture the gesture held is what made the whole
                // thing **one** undo step instead of two — the add and the drag.
                //
                // A midpoint that was clicked and not dragged added nothing, and
                // the capture closes with the scene as it was: the kernel notices
                // that nothing changed and leaves the history alone.
                midpointGesture.commit(session);
                paint(session, ctx);
                return;
            }
            if (completed.kind === GESTURES.MARQUEE) {
                if (moved) {
                    // The rectangle is normalised and the additive union is a single
                    // kernel crossing; both live with the gesture.
                    marqueeGesture.commit(session, completed);
                    paint(session, ctx);
                    return;
                }
                // No movement: a click on empty space. The H3.8 `selectAt`
                // path already clears the selection on hits.length === 0,
                // which is the right answer for "I pressed down on
                // nothing, I lifted on nothing".
                if (selectAt(event, session)) {
                    paint(session, ctx);
                }
                return;
            }
            // Translate is the last gesture that commits, and it is written as a named branch
            // rather than as the tail of the function. It used to be the tail — every other kind
            // returned above it, so it *was* translate's arm without saying so — and the cost of
            // that was that a new kind added to the table with `commits: true` and no arm of its
            // own would fall through here and be treated as a translate. Naming it is what lets
            // the structural guard check the list instead of trusting the fall-through.
            if (completed.kind === GESTURES.TRANSLATE) {
                if (moved) {
                    // One atomic translate for the whole drag. Pre-H4.5 this looped
                    // `session.translate(id, ...)` per target, so dragging a 5-element
                    // group pushed 5 history entries and a single Cmd+Z restored only
                    // one. Now a single door lifts the whole drag into one entry,
                    // matching the atomic-undo contract H4.2-H4.4 already established
                    // for delete / duplicate / reorder.
                    //
                    // The door takes the pointer's two positions and the kernel
                    // measures the travel: the zoom of the view is the only part of
                    // the transform that scales a difference, and a client that
                    // divided by a zoom it read itself held a second truth about
                    // where the scene is.
                    //
                    // The targets are a set, so the paint can ask "does this record
                    // move?" in constant time; the commit opens it into the list the
                    // frontier takes.
                    translateGesture.commit(session, completed);
                    paint(session, ctx);
                    return;
                }
                // No movement: a click. A click on the **body of the
                // selection** is a click on the selection, and it keeps it —
                // the press already resolved the selection, and asking again
                // at the release point would clear a selection the user
                // clicked inside. Every other click delegates to the H3.8
                // selection logic.
                if (completed.fromSelectionBody === true) {
                    return;
                }
                if (selectAt(event, session)) {
                    paint(session, ctx);
                }
                return;
            }
            // Every kind the table declares as committing has a branch above, so reaching here
            // means the page started a gesture the table has no arm for — the H5.15 shape, where
            // an arm was added and nothing used it. Throwing is the point: the alternative is a
            // silent fall-through that would treat an unknown gesture as a translate and move the
            // user's drawing in a way nobody asked for.
            throw new Error(`unhandled gesture kind: ${completed.kind}`);
        } catch (error) {
            // A refused commit is the one case this function has to survive. H6.3 gave the
            // kernel a second refusal — a box with no area on either axis — and every
            // fallible `session.*` call below has always been able to throw. Until now an
            // exception here escaped a bare DOM listener, which meant two silences at once:
            // the `paint` every branch ends with never ran, so the canvas kept showing the
            // box the gesture was *previewing*, and the refusal appeared in no surface the
            // user can reach. The gesture is already `null` by this point, so no later
            // `pointermove` would have repainted it either: the canvas froze on a box that
            // was never committed, until something unrelated moved.
            //
            // Repainting from the scene is the whole recovery. It also *is* the feedback: a
            // box snapping back to where it was is the honest answer to a gesture the kernel
            // refuses, and it is better than a status line the user has to read about a drag
            // that already ended. The line is for problems that persist, not for one that
            // lasts a frame.
            //
            // Rethrown on purpose. Reporting the failure is the client's job; deciding it was
            // fine is not, and the `unhandled gesture kind` throw at the end of the table
            // above is a defect in this file rather than something the user did — both reach
            // the console through here.
            paint(session, ctx);
            throw error;
        }
    }

    /**
     * Pointer cancel: the browser took the pointer, so the gesture is discarded.
     *
     * This used to be `pointercancel` wired to the same handler as `pointerup`, with the
     * release path checking `event.type` to notice the difference. Two handlers, one
     * function, and a flag inside it: the difference between "the user let go" and "the
     * browser took the pointer over" was a string comparison in the middle of the commit
     * logic, and it was easy to leave out. Only two gestures remembered to check it — the
     * freehand stroke and the eraser — so a cancelled **rotate**, **resize**, **draw**,
     * **translate** or **marquee** confirmed itself: the box appeared, the shape was
     * inserted, the drawing moved and the selection changed, all of it from a gesture the
     * user never finished.
     *
     * Upstream does not have this problem because cancellation is a separate event on its
     * way into the page: `handleCanvasPointerCancel` → `maybeCleanupAfterMissingPointerUp`,
     * with the reason written next to it — *the browser took the pointer over — no
     * pointerup will follow*. So the rule lives here, in a function that **cannot** commit
     * anything: it hands the gesture to `cancelGesture`, which discards it and repaints the
     * scene. A cancelled drag leaves the drawing exactly as it was.
     *
     * Two things have to be undone besides the commit itself:
     *
     * 1. The pointer capture. The gesture took a capture on pointer-down, and the browser
     *    takes it back when it cancels — but the page still holds the reference, and a
     *    capture the page believes it has is a capture that leaks.
     * 2. The cursor. `syncCursor` decides between "grabbing" and the tool's cursor from
     *    whether a pan gesture is alive, so a cancelled pan that skipped this would leave
     *    the cursor grabbing forever, with no keyup coming to reset it.
     *
     * @param {PointerEvent} event
     * @param {Session} session
     * @param {object} ctx the paint context
     */
    function onPointerCancel(event, session, ctx) {
        // A pointer that does not own the gesture in flight cannot cancel it. The browser
        // taking a third finger away says nothing about the box the first finger is
        // drawing, so the drawing carries on until its own pointer is taken away.
        if (gesture !== null && !ownsGesture(gesture.owners, event.pointerId)) {
            forgetTouch(event);
            return;
        }
        if (gesture !== null && gesture.kind === GESTURES.PINCH) {
            endPinch();
            return;
        }
        // The pending text press dies with the pointer the browser took: no
        // pointerup will follow, so no release will ever resolve it — the
        // same orphaning upstream's `cancel` does (`App.textTool.ts`).
        if (pendingText !== null && pendingText.owner === event.pointerId) {
            pendingText = null;
        }
        forgetTouch(event);
        // A cancelled press opens no menu. The browser took the pointer away —
        // a palm, a system gesture, a scroll that carried it off — and a menu
        // that opens because a gesture was cancelled is a menu the user never
        // asked for. Only the button that began the session can end it.
        secondary = cancelSecondaryPress(secondary, event.pointerId);
        if (!gesture) {
            return;
        }
        const completed = gesture;
        gesture = null;
        try {
            canvas.releasePointerCapture(event.pointerId);
        } catch {
            // The browser already took the capture back when it cancelled the pointer;
            // there is nothing left to give, and nothing to commit either way.
        }
        if (completed.kind === GESTURES.CROP && completed.modeInteraction !== undefined) {
            cropMode = completed.modeInteraction.mode;
        }
        // The one place that knows what "discarded" means for each gesture. The eraser
        // is the exception it exists for: it marked the elements it crossed while the
        // pointer was down, and ending the gesture would delete them.
        cancelGesture(completed.kind, session, () => paint(session, ctx));
        syncCursor();
    }

    /**
     * Escape in the middle of a move, a resize or a turn: the transform is thrown away.
     *
     * The preview never wrote to the document, so discarding the gesture is the whole
     * cancel: the release that follows finds no gesture and commits nothing, and the next
     * frame paints the committed scene with its chrome where it was. The selection stays:
     * Escape answers the most specific thing in flight first, the way upstream's Escape
     * finishes a crop before it deselects, and a second Escape drops the selection. The
     * capture goes back now, because the gesture that took it is gone.
     *
     * @param {Session} session
     * @param {object} ctx the paint context
     * @returns {boolean} whether a transform was in flight and is now gone.
     */
    function cancelTransform(session, ctx) {
        if (!TRANSFORMS.has(gesture?.kind)) {
            return false;
        }
        const cancelled = gesture;
        gesture = null;
        for (const pointerId of cancelled.owners) {
            try {
                canvas.releasePointerCapture(pointerId);
            } catch {
                // The capture was already given back; the gesture is gone either way.
            }
        }
        cancelGesture(cancelled.kind, session, () => paint(session, ctx));
        syncCursor();
        return true;
    }

    // The seams the page still touches directly (TASK-26): boot asks whether a
    // gesture or a ghost is live before it repaints, the keyboard handlers own
    // the space key and the window blur, and the toolbar binding arrives after
    // the pipeline exists. Each is a two-line question or answer, and none of
    // them reaches past this file into the state they guard.
    function pendingGesture() {
        return gesture;
    }
    function pendingCrop(session) {
        return session === undefined ? cropMode : liveCropMode(session);
    }
    function armCropMode(id) {
        cropMode = cropModeGeometry.start(id);
    }
    function isSpaceHeld() {
        return spaceHeld;
    }
    function setSpaceHeld(value) {
        spaceHeld = value;
    }
    function setToolButtonRefresher(bind) {
        toolButtonRefresher = bind;
    }
    function refreshToolButtons() {
        toolButtonRefresher();
    }
    /**
     * The laser trail's alive points at `now`, oldest first.
     *
     * The paint asks once per frame and never keeps the answer: the points
     * decay with the clock, so a copy would be a picture of a moment that
     * has already gone. An empty array is the ordinary answer — the trail is
     * usually dead — and an empty array is also how the decay loop ends.
     *
     * @param {number} now The clock, in milliseconds.
     * @returns {Array<{x: number, y: number, at: number}>}
     */
    function laserPoints(now) {
        return laserGesture.preview(laserTrail, now);
    }

    return {
        onPointerDown, onPointerMove, onPointerUp, onPointerCancel, cancelTransform,
        syncCursor, canvasPointFromEvent, transformPictureAt,
        liveMultipoint, pendingGesture, pendingCrop, armCropMode, endMultipoint, exitCropMode, confirmCropMode,
        isSpaceHeld, setSpaceHeld, setToolButtonRefresher, refreshToolButtons,
        laserPoints,
        toolState, pointerAt,
    };
}
