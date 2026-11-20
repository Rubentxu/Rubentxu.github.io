// The save, the tabs, the pictures' store, the recovery offer and the stored
// document's door.
//
// What this module is:
// - The wiring of everything persistence: the browser's promise to keep the
//   drawing, the tab watch, the pictures' keeper, the recovery offer, the
//   autosave that owns the moments a leaving page owes, and `restore`, the
//   door the session start reads the stored document through. The page builds
//   it once, where its collaborators exist, and hands the answers around.
//
// What this module is not:
// - The owner of the embedder's surfaces. The surfaces the embedder can
//   replace (the navigator, the BroadcastChannel, the IndexedDB, the change
//   hook) arrive inside the page's `options`, so a test names its own and the
//   browser's are only reached when none was named.
// - The owner of the kernel's constructor. The page is the one module that
//   imports the glue, so `Session` crosses as a dependency.

import { clearDocument, loadDocument, openStoredDocument } from "./persist.mjs";
import { browserIndexedDB, createImageStore } from "./image-store.mjs";
import { createImageKeeper } from "./image-keeper.mjs";
import { createPersistRequest } from "./persist-request.mjs";
import { createTabWatch } from "./tab-watch.mjs";
import { handOverRecoveredDocument } from "./document-io.mjs";
import { createRecoveryOffer, recoveryQueueReadable } from "./recovery.mjs";
import { createAutosave } from "./autosave.mjs";
import { forgetImages } from "./paint.mjs";
import { joinNotices } from "./status.mjs";
import { noticeText } from "./mode-notices.mjs";

/**
 * Wire the save and the recovery, and answer with what the page drives them by.
 *
 * @param {object} deps the surfaces the save reads.
 * @param {object} deps.options the embedder's surface: `navigator`, `BroadcastChannel`,
 *   `indexedDB` and `onChange`, each falling back to the browser's own.
 * @param {object} deps.document the document the autosave listens on.
 * @param {object} deps.window the window the autosave listens on.
 * @param {object} deps.canvasRect the canvas's cached box.
 * @param {object} deps.lifecycle the mount's lifecycle.
 * @param {object} deps.statusLine the page's failure channel.
 * @param {Function} deps.renderStatus the one place that puts the state on the screen.
 * @param {Function} deps.say the page's words.
 * @param {Function} deps.Session the kernel session's constructor, asked of the glue.
 * @param {Function} deps.pendingGesture the gesture in flight, read when asked.
 * @param {Function} deps.removeGlobalPanicHandlers the handlers' remover, read when asked.
 * @returns {{persistScheduler: object, seedRevision: Function, recovery: object,
 *   restore: () => Promise<{session: object, problem: string|null, notice: string|null, unreadable: string|null}>}}
 *   the autosave's scheduler and seeder, the offer the boot holds unreadable
 *   bytes with, and the stored document's door.
 */
export function createPersistence(deps) {
    const {
        options, document, window, canvasRect, lifecycle, statusLine, renderStatus, say, Session,
        pendingGesture, removeGlobalPanicHandlers,
    } = deps;
    let conflictHandler = null;
    let pendingConflict = null;
    let conflictOpen = false;
    // The session on screen, handed over once the boot has one. The conflict
    // resolution and the autosave both need it late — after the kernel loaded
    // and the canvas exists — so the page owns the reference and this module
    // owns when it is read.
    const live = { session: () => options.session, rawSession: () => options.session, context: null, paint: () => {} };

    // The drawings that could not be opened, and the way the user takes them away.
    //
    // The offer answers the two questions the page must not answer twice: whether
    // there is something to take away, and whether the autosave has to stand
    // still. The handoff and the emptying of the live key are handed in, because
    // the file that owns the live key and the file that writes files to the disk
    // are not this one.
    //
    // The handoff answers whether the file is on the disk, and the offer does not
    // let go of the bytes until it says so. A download that was merely started
    // leaves the drawing here, which is the whole point: the copy this
    // application holds is worth more than a file it cannot vouch for.
    //
    // When the file cannot be confirmed the bytes are moved to the queue rather
    // than dropped, because the queue is a place of their own: the drawing on
    // screen can be saved again while the file is still waiting to be written.
    // Asks the browser once, after the first write that stuck, not to evict the
    // drawing. The navigator is the option's when a test names one.
    const persistRequest = createPersistRequest(options.navigator ?? globalThis.navigator);

    // Tells the other tabs of the origin that this one wrote, and says once when
    // another one does: two tabs on one drawing overwrite each other. A notice and
    // not a problem, because a successful save clears a problem and this stays true.
    const tabWatch = createTabWatch({
        BroadcastChannel: options.BroadcastChannel ?? globalThis.BroadcastChannel,
        onOther: (message) => {
            statusLine.setNotice(noticeText(say, "notice.tabs.other"), true);
            renderStatus();
            if (conflictOpen) return;
            conflictOpen = true;
            autosave.pause();
            pendingConflict = makeResolution(message);
            conflictHandler?.(pendingConflict);
        },
    });

    // Where the pictures of the drawing live, so the stored document only names
    // them. When there is no IndexedDB, or it fails, the keeper is inert and the
    // document is stored whole, as it was before the store existed.
    const imageKeeper = createImageKeeper(createImageStore(options.indexedDB ?? browserIndexedDB()));

    const recovery = createRecoveryOffer({
        download: handOverRecoveredDocument,
        clearLive: () => clearDocument(),
    });

    /**
     * The save, and the moments a page that is going away owes it.
     *
     * It is built here and not earlier because it needs the recovery offer, the image
     * keeper and the tab watch, which exist just above. The gesture in flight comes from
     * the pipeline, built later, and the global panic handlers are replaced once they are
     * installed, so both arrive as functions that read the current one.
     */
    const autosave = createAutosave({
        statusLine, renderStatus, recovery, imageKeeper, tabWatch, persistRequest,
        onChange: options.onChange, canvasRect, window, document, lifecycle,
        pendingGesture: () => pendingGesture(),
        removeGlobalPanicHandlers: () => removeGlobalPanicHandlers(),
    });

    const { persistScheduler, seedRevision } = autosave;

    /**
     * The session the page starts with, and what the user has to be told about it.
     *
     * A stored document the kernel refuses is not a reason to fail the boot. The
     * canvas still comes up, the user can still draw, and the status line says what
     * happened. Coming up silently empty — and leaving the user to wonder where
     * their drawing went — is the outcome worth avoiding.
     *
     * But those bytes are the user's work and they are still there, so they are
     * put somewhere the next save cannot reach them, and the user is offered them
     * as a file. Which of the two messages the user gets depends on where the
     * bytes ended up:
     *
     * - The bytes were put aside. The drawing on screen is saved as usual, and the
     *   old drawing is waiting to be taken away. That is a fact about the document
     *   and it stays true through every edit that follows, so it is a notice.
     * - The bytes could not be put aside, so they are still in the one place the
     *   live drawing lives and the autosave is standing still. That is a failure
     *   the user has to act on, so it is a problem.
     *
     * The queue of drawings waiting to be recovered has a story of its own, and it
     * is told here rather than inside the offer: bytes that this version cannot
     * make sense of are kept but cannot be handed out, and a user who is not told
     * cannot tell "there is nothing to recover" from "there is something I cannot
     * reach".
     *
     * @returns {{session: Session, problem: string|null, notice: string|null, unreadable: string|null}}
     */
    async function restore() {
        // Ids belong to a document. A drawing loaded from disk may reuse an id the
        // previous one used for a different picture, so the pictures remembered by id
        // have to go before the new session can paint.
        forgetImages();
        // The pictures a stored document names are fetched first, so the open itself
        // stays the synchronous one: the kernel is handed the document whole.
        await imageKeeper.preload(loadDocument() ?? "");
        const outcome = openStoredDocument(Session, { prepare: imageKeeper.hydrate });
        imageKeeper.release();
        // Bytes that are under the recovery key but that this version cannot make
        // sense of. They are kept — nothing here writes over them — but they
        // cannot be handed out either.
        const unreachable = recoveryQueueReadable()
            ? null
            : "Some saved drawings could not be read. They are kept, but this version cannot offer them as files.";
        if (outcome.outcome === "opened") {
            return {
                outcome: outcome.outcome,
                session: outcome.session,
                problem: null,
                notice: joinNotices(unreachable),
                unreadable: null,
            };
        }
        if (outcome.outcome === "empty") {
            return { outcome: outcome.outcome, session: new Session(), problem: null, notice: joinNotices(unreachable), unreadable: null };
        }
        if (outcome.outcome === "kept") {
            return {
                outcome: outcome.outcome,
                session: new Session(),
                problem: null,
                notice: joinNotices(
                    "The saved drawing could not be opened. It has been kept safe — use Recover to download it.",
                    unreachable,
                ),
                unreadable: null,
            };
        }
        return {
            session: new Session(),
            problem:
                "The saved drawing could not be opened and a copy of it could not be kept. " +
                "Autosave is paused so the original is not overwritten — use Recover to download it.",
            notice: null,
            unreadable: outcome.stored,
        };
    }

    function makeResolution(message) {
        let settled = false;
        const finish = () => {
            settled = true;
            conflictOpen = false;
            pendingConflict = null;
        };
        return {
            revision: message.revision,
            keep: async () => {
                if (settled) return;
                autosave.resume(live.session());
                finish();
            },
            adopt: async () => {
                if (settled) return;
                const restored = await restore();
                if (restored.problem !== null || (restored.outcome !== "opened" && restored.outcome !== "empty")) {
                    throw new Error(restored.problem ?? "The latest drawing could not be opened.");
                }
                const raw = live.rawSession();
                const json = restored.session.toJson();
                raw.loadJson(json);
                seedRevision(raw.documentRevision());
                if (live.context !== null) {
                    live.paint(live.session(), live.context);
                }
                autosave.resume(live.session());
                finish();
            },
        };
    }

    function setTabConflictHandler(handler) {
        conflictHandler = handler;
        if (pendingConflict !== null) conflictHandler?.(pendingConflict);
    }

    /**
     * Hand the persistence the session the page drives, once the boot has one.
     *
     * @param {{session: () => object, rawSession: () => object, context: object, paint: Function}} sessions
     * @returns {void}
     */
    function bindSessions({ session, rawSession, context, paint }) {
        live.session = session;
        live.rawSession = rawSession;
        live.context = context;
        live.paint = paint;
    }

    return { persistScheduler, seedRevision, recovery, restore, setTabConflictHandler, bindSessions };
}
