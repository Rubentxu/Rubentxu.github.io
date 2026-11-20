// What a panic does to the page.
//
// # What a panic is, from this side
//
// A panic inside the wasm used to arrive as `RuntimeError: unreachable`: a
// sentence that says nothing about what failed and nothing about where, and a
// session left in whatever state the panic interrupted. The kernel now
// installs a hook that throws the panic's own words with the boundary's tag
// at the front — `kernel_panic: …` — so the page can tell a panic from a
// refusal and can say what happened.
//
// # What this module decides, and what it does not
//
// It decides the **policy**: a panic is recognised by its tag, said out loud
// in the two places somebody looks — the console and the status line — and
// answered by putting the session back.
//
// It does not decide how the session is put back: the page owns the session,
// so the page owns that. It does not decide what the kernel does when it
// panics either — that is the kernel's, and the hook that gives the panic its
// words lives there.
//
// # Why the policy is a module and not a page
//
// The policy is the part that has to be right in the dark: a panic that
// escapes the paint, a panic that escapes a promise, a panic nobody caught.
// Writing it here with its dependencies handed in means the whole of it can
// be exercised without a browser, and the page is left with the wiring.
//
// # Why the tag is not written down here
//
// The tag is the kernel's: the artifact publishes it (`kernelPanicTag()`) and
// the page asks the artifact for it. A tag written down on both sides is a
// tag that can drift, and a drifted tag fails silently — the page stops
// recognising panics and treats them as ordinary failures, which is the
// failure this whole path exists to prevent.

import { isRefusal } from "./gesture-pipeline.mjs";
import { joinNotices } from "./status.mjs";

/**
 * Whether `error` is the kernel panic this page knows how to recover from.
 *
 * A panic arrives the way a refusal arrives: as an error whose message begins
 * with the kind of failure. So it is recognised the same way, with the one
 * helper that knows where the tag lives — the tag is a prefix of the message
 * and the detail after it is prose.
 *
 * @param {unknown} error The thrown value.
 * @param {string} panicTag The tag the artifact publishes.
 * @returns {boolean}
 */
export function isKernelPanic(error, panicTag) {
    return isRefusal(error, panicTag);
}

/**
 * The panic's message, as it crossed.
 *
 * The tag is part of it: the message that reaches the console is the message
 * the kernel wrote, and a reader of the console wants to see that this was a
 * panic and not a refusal.
 *
 * @param {unknown} error The thrown value.
 * @returns {string} The message, or the empty string when there is none.
 */
export function panicMessage(error) {
    return typeof error?.message === "string" ? error.message : "";
}

/**
 * The page's answer to a panic: say it, and put the session back.
 *
 * The recovery is **once per failure**. A panic that reaches two places — the
 * paint that caught it and the window that heard about it — is one panic, and
 * rebuilding twice would throw away the session the first rebuild had just
 * made. So the failures already answered are remembered, and the second look
 * at the same one is not a second answer.
 *
 * The failures are remembered weakly: the page does not hold the panic alive
 * to keep a note of it, and a panic nobody holds any more is a panic nobody
 * has to answer again.
 *
 * @param {object} parts
 * @param {string} parts.panicTag The tag the artifact publishes.
 * @param {(message: string) => void} parts.consoleError Where the console hears it.
 * @param {{setProblem: (text: string) => void}} parts.statusLine The status line.
 * @param {() => void} parts.renderStatus Repaints the status line.
 * @param {() => {problem: string|null, notice: string|null}} parts.rebuild
 *   Puts the session back. It answers what the restore had to say about the
 *   document: a problem the user has to act on, or a notice about it.
 * @returns {{recover: (error: unknown) => boolean}}
 */
export function createPanicRecovery({ panicTag, consoleError, statusLine, renderStatus, rebuild }) {
    const answered = new WeakSet();

    /**
     * Whether this failure has already been answered.
     *
     * A thrown value that is not an object cannot be remembered, and such a
     * value cannot carry a tagged message either — so it never reaches this
     * question with anything to answer.
     *
     * @param {unknown} error
     * @returns {boolean}
     */
    function alreadyAnswered(error) {
        if (error === null || typeof error !== "object") {
            return false;
        }
        return answered.has(error);
    }

    return {
        /**
         * Answer a failure, if it is a panic.
         *
         * @param {unknown} error The thrown value.
         * @returns {boolean} Whether this was a panic and it was answered.
         */
        recover(error) {
            if (!isKernelPanic(error, panicTag)) {
                return false;
            }
            if (alreadyAnswered(error)) {
                return false;
            }
            if (error !== null && typeof error === "object") {
                answered.add(error);
            }
            const message = panicMessage(error);
            consoleError(message);
            const restored = rebuild();
            // The line says both facts: the panic happened, and this is what
            // the restore had to say about the document. A line that could
            // only carry one of them would drop the other.
            statusLine.setProblem(
                joinNotices(message, restored?.problem ?? null, restored?.notice ?? null),
            );
            renderStatus();
            return true;
        },
    };
}

/**
 * The session the page gets back after a panic.
 *
 * It is the session the **same door the boot uses** opens: the last document
 * that was saved. Not the session that panicked — that one is in a state
 * nobody knows, which is the whole reason it is being replaced — and not a
 * blank one either, which would throw away the drawing the user was working
 * on.
 *
 * @param {object} parts
 * @param {() => {session: object, problem: string|null, notice: string|null, unreadable: string|null}} parts.restore
 *   The boot's own door.
 * @param {(session: object) => object} parts.instrument
 *   Wraps the session for the room, when there is one.
 * @param {(session: object) => void} parts.seed
 *   Re-seeds the autosave's revision, so the restored document is not written
 *   back as if it were a change.
 * @param {(session: object) => void} parts.repaint Asks for a frame.
 * @returns {() => {session: object, rawSession: object, problem: string|null, notice: string|null, unreadable: string|null}}
 */
export function createSessionRebuild({ restore, instrument, seed, repaint }) {
    return function rebuild() {
        const restored = restore();
        // The room's view of the session and the page's view of it are two
        // objects: the page's edits travel through the instrumented one, and
        // the room's documents are adopted through the raw one.
        const rawSession = restored.session;
        const session = instrument(rawSession);
        seed(session);
        repaint(session);
        return { ...restored, session, rawSession };
    };
}

/**
 * The page's two global handlers, and how to take them off.
 *
 * A panic that nobody caught — one that escaped a listener, one that escaped
 * a promise — reaches the window, and a window that hears about it can answer
 * it. Without these, such a panic ends at the console: the session stays in
 * whatever state it was in and the page keeps drawing into it.
 *
 * The handlers are **removed** when the page leaves. A handler that outlives
 * the page is a handler that answers a panic in a page that is going away,
 * and a page that is going away has nothing to rebuild.
 *
 * The target is handed in rather than reached for: the window is the browser's
 * global, and a policy that cannot be exercised without a browser is a policy
 * that is exercised only when it is too late to change it.
 *
 * @param {object} parts
 * @param {{addEventListener: Function, removeEventListener: Function}} parts.target
 *   The window-like thing that hears about failures.
 * @param {(error: unknown) => boolean} parts.recover The recovery.
 * @returns {() => void} Takes the handlers off.
 */
export function installGlobalHandlers({ target, recover }) {
    const onError = (event) => {
        // `event.error` is the thrown value for an uncaught exception, and
        // nothing for a resource that failed to load — which is not a panic
        // and must not be answered as one.
        recover(event.error ?? null);
    };
    const onRejection = (event) => {
        recover(event.reason ?? null);
    };
    target.addEventListener("error", onError);
    target.addEventListener("unhandledrejection", onRejection);
    return () => {
        target.removeEventListener("error", onError);
        target.removeEventListener("unhandledrejection", onRejection);
    };
}
