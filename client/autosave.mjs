// The autosave: when the document is written, what the write is told, and who is told.
//
// What this file is:
// - `createAutosave(deps)` builds the save (`autosave` and the `commit` it hands the
//   snapshot to), the scheduler that runs it when the browser has room, and the two
//   moments where a page that is going away owes what it holds (`pagehide`, and the page
//   turning hidden). It returns the scheduler the paint asks, and `seedRevision`, the one
//   door by which the page says "this document is already the stored one".
// - The rule that decides whether a write happens is in `client/persist.mjs`; this file
//   is the moment that rule is consulted and what the page does with its answer.
//
// What it does not own: the status line, the image keeper, the recovery offer, the tab
// watch and the persist request (all built by the page and handed in by name), the gesture
// in flight (the pipeline answers `pendingGesture()`, a function because the pipeline is
// built after this), and the global panic handlers (a function, because the page replaces
// the handle once they are installed).

import { createPersistScheduler, persistIfChanged } from "./persist.mjs";

export function createAutosave(deps) {
    const {
        statusLine, renderStatus, recovery, imageKeeper, tabWatch, persistRequest, onChange,
        pendingGesture, removeGlobalPanicHandlers, canvasRect, window, document, lifecycle,
    } = deps;

    // The `documentRevision()` of the last document actually written, so a paint whose
    // document has not moved has nothing new to store.
    let persistedRevision = null;

    /**
     * Write the scene to storage if a mutation has landed since the last write.
     *
     * `paint` is the one place every committed change passes through: drags repaint
     * on every pointermove but only commit on pointerup, so the drag does not
     * serialize and the commit does. Comparing one number costs one number read.
     *
     * The number is the kernel's `documentRevision()`, which counts the document and
     * nothing else. It used to be the undo depth, and that was wrong twice over: the
     * depth is bounded by `HISTORY_DEPTH`, so from the hundred-and-first edit on the
     * drawing stopped being saved, and the depth is a fact about the past, so undoing
     * back to a familiar depth could look like "nothing changed" and skip a write.
     *
     * The frame's own counter cannot answer this either. It moves for the selection
     * and the viewport too, so a client that stored on every frame bump would
     * serialize the whole drawing on every click — the drawing is one megabyte of
     * JSON at five thousand elements, and the user is still only selecting things.
     *
     * What "the document changed" means is the kernel's rule, not this file's: the
     * decision lives beside the write that causes it, and a client that kept its own
     * copy of it would be the duplicated source of truth of H5.29 with its matching
     * failure.
     *
     * The rule itself is in `client/persist.mjs`, next to the store it writes to, so
     * it can be exercised without a browser: the two counters this file used to
     * confuse are both readable from a fake session, and a test can prove that the
     * one that must not decide anything does not.
     */
    // Whether the problem on the status line is the autosave's own. Only its
    // owner clears it — see the note inside `autosave`.
    let saveReportedFailure = false;

    // The saves that wait for the image store are run one after another, and each
    // snapshot carries its number: a save that was asked for earlier but finishes
    // later must not write over one that already landed.
    let saveChain = Promise.resolve();
    let snapshotsTaken = 0;
    let snapshotCommitted = 0;
    // A tab conflict invalidates snapshots already waiting on the image store.
    let saveGeneration = 0;
    let conflictPaused = false;
    // Whether the page is going away. A page that is leaving cannot wait for the
    // image store, so it writes the document whole, which needs no store.
    let leaving = false;

    function autosave(session) {
        const snapshot = ++snapshotsTaken;
        const generation = saveGeneration;
        const revision = session.documentRevision();
        // Nothing to write, or nothing that can leave the document: the save is the
        // plain synchronous one.
        if (recovery.held || revision === persistedRevision || !imageKeeper.active()) {
            commit(session, snapshot, undefined, undefined, generation);
            return;
        }
        // The document is looked at now. Whatever the user draws while the pictures
        // are being kept is the next save's.
        const text = session.toJson();
        const plan = imageKeeper.plan(text);
        if (plan.missing.length === 0) {
            commit(session, snapshot, revision, plan.slim, generation);
            return;
        }
        if (leaving) {
            commit(session, snapshot, revision, text, generation);
            return;
        }
        saveChain = saveChain
            .then(async () => {
                const kept = await imageKeeper.keep(plan.missing);
                commit(session, snapshot, revision, kept ? plan.slim : text, generation);
            })
            .catch(() => {});
    }

    function commit(session, snapshot, revision, text, generation) {
        if (conflictPaused || generation !== saveGeneration || snapshot < snapshotCommitted) {
            return;
        }
        snapshotCommitted = snapshot;
        // A drawing that could not be opened and could not be put aside is still
        // in the one place the live drawing lives. Those bytes exist nowhere else,
        // so nothing is written over them until the user has taken them away.
        const outcome = persistIfChanged(session, { persistedRevision, held: recovery.held, revision, text });
        if (outcome.written) {
            persistedRevision = outcome.revision;
            // The first write that stuck is the first drawing worth protecting:
            // ask the browser not to evict it. The answer is not the save's
            // business, and the request never throws.
            persistRequest.afterWrite();
            tabWatch.announce(outcome.revision);
            // The embedder's ear, wired where the change is already confirmed:
            // this branch is the one place "the document changed" is a settled
            // fact, so it is the one place the event is fired. The document is
            // read only for a listener that asked — the demo page passes none.
            // A listener that throws is said on the page's failure channel, not
            // swallowed: the persistence already landed, so the drawing is safe,
            // and the next change calls the listener again — but a listener that
            // fails on every change would fail silently forever, and that is the
            // one way an embedder's own defect hides from its author.
            if (typeof onChange === "function") {
                try {
                    onChange(JSON.parse(session.toJson()));
                } catch (error) {
                    if (!statusLine.hasProblem()) {
                        statusLine.setProblem(`onChange listener failed: ${error.message ?? error}`);
                        renderStatus();
                    }
                }
            }
            // A write that landed resolves the failure **the save itself was
            // reporting** — the "Cannot save" line above, and nothing else. A
            // problem another door set in the same second (a refused link, a
            // failed import) is not the save's to clear: wiping it here let a
            // late autosave erase a refusal the user had not read yet, which is
            // exactly the race the keyboard-era sweep caught in
            // `scripts/e2e/links.test.mjs`. The flag remembers whose problem is
            // on the line; only its owner clears it.
            if (saveReportedFailure && statusLine.hasProblem()) {
                saveReportedFailure = false;
                statusLine.clearProblem();
                renderStatus();
            }
            return;
        }
        if (outcome.failed && !statusLine.hasProblem()) {
            saveReportedFailure = true;
            statusLine.setProblem(
                "Cannot save: browser storage is full or unavailable. This drawing will be lost on reload.",
            );
            renderStatus();
        }
    }

    /**
     * The save, asked for by a paint and run by the browser when it has room.
     *
     * The rule that decides *whether* a write happens lives next to the store it
     * writes to, and this file does not restate it. What lives here is the moment
     * the rule is consulted, and the moment is not the frame: a paint asks, the
     * browser answers.
     *
     * The clock is the browser's own idle moment, with a deadline so that a page
     * which never goes idle still gets its wake-up. A browser without an idle
     * callback gets a task instead, and a task runs after the frame that asked
     * for it, so the paint goes first either way.
     */
    const persistScheduler = createPersistScheduler({
        schedule: (run) => {
            if (typeof window.requestIdleCallback === "function") {
                window.requestIdleCallback(run, { timeout: 1000 });
                return;
            }
            window.setTimeout(run, 0);
        },
        save: autosave,
        // A drag is not saved a revision at a time: the debt waits for the end of the gesture.
        busy: () => pendingGesture() !== null,
    });

    // A page that is going away takes what it owes with it.
    //
    // The wake-up may never run: the tab is closing, the phone is locking the
    // screen, the machine is going to sleep. These are the two moments where the
    // browser still runs a task before that happens, so they are asked to save
    // first. What is left in memory is then only the work of the last few
    // milliseconds, and not the work of a whole drawing.
    window.addEventListener("pagehide", () => {
        leaving = true;
        persistScheduler.flush();
        leaving = false;
        tabWatch.close();
        canvasRect.close();
        // The page is going away: the global handlers have nothing left to
        // answer, and a handler that outlives the page would try to rebuild a
        // session in a page that is being torn down.
        removeGlobalPanicHandlers();
    }, { signal: lifecycle.signal });
    // Taking the editor down is leaving the page for this mount alone: what is
    // owed is written first, then the channel, the cached box and the global
    // handlers are let go.
    lifecycle.onDestroy(() => {
        persistScheduler.flush();
        tabWatch.close();
        canvasRect.close();
        removeGlobalPanicHandlers();
    });
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") {
            // Hidden may be the last moment the page runs, so it does not wait either.
            leaving = true;
            persistScheduler.flush();
            leaving = false;
        }
    }, { signal: lifecycle.signal });

    return {
        persistScheduler,
        pause() {
            if (conflictPaused) return;
            conflictPaused = true;
            saveGeneration += 1;
            persistScheduler.pause();
        },
        resume(session) {
            persistScheduler.request(session);
            conflictPaused = false;
            persistScheduler.unpause();
        },
        seedRevision: (revision) => {
            persistedRevision = revision;
        },
    };
}
