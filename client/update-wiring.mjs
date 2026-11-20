// The offline worker's registration and the version offer's control.
//
// What this module is:
// - The page's side of the browser's update story: the worker is registered,
//   the watcher (`client/update.mjs`, where the policy lives) hears what the
//   browser says, a tab that comes back asks once whether the build moved, and
//   the reload button is the way to act on the offer — the page never reloads
//   itself, because the drawing on screen may hold work that was not saved.
//
// What this module is not:
// - The owner of the browser's surfaces. The navigator, the document and the
//   `location` a test names arrive as dependencies; a page without a service
//   worker runs exactly the same, online, and says why it cannot go offline.

import { noticeText } from "./mode-notices.mjs";
import { createVersionWatcher } from "./update.mjs";

/**
 * Wire the offline worker and the version offer.
 *
 * @param {object} deps the surfaces the browser answers through.
 * @param {object} deps.document the document the tab's visibility is read from.
 * @param {object} deps.navigator the navigator that holds the service worker.
 * @param {object} deps.lifecycle the mount's lifecycle; every listener goes on its signal.
 * @param {object} deps.statusLine the page's failure channel.
 * @param {Function} deps.renderStatus the one place that puts the state on the screen.
 * @param {Function} deps.say the page's words.
 * @param {object} [deps.reloadButton] the button that acts on the offer, when the page has one.
 * @param {object} [deps.location] where `reload` is asked; the browser's own when none is named.
 * @param {Function} [deps.registerWorker] how the worker is registered, for a test to name.
 */
export function wireUpdateCheck({
    document, navigator, lifecycle, statusLine, renderStatus, say,
    reloadButton = null, location = globalThis.location, registerWorker,
}) {
    let workerRegistration = null;

    /**
     * Ask the browser whether the worker on this origin has changed.
     *
     * The browser fetches the worker and the modules it imports and compares them
     * with the ones it has. A browser that cannot check says nothing, and a page
     * that cannot be told about a new version keeps running the one it has.
     *
     * @param {object} registration The registration the browser gave.
     * @returns {Promise<void>}
     */
    async function checkForANewWorker(registration) {
        try {
            await registration.update();
        } catch {
            // The check failed: there is nothing to say about a version nobody
            // could look for, and the page keeps running the build it has.
        }
    }

    // The policy — when a new version is ready and what to offer — lives in
    // `client/update.mjs`; what the browser answers is injected here, because the
    // browser's surface belongs to the browser and not to a module that has to be
    // exercised without one.
    const versionWatcher = createVersionWatcher({
        listen: (target, type, handler) => target.addEventListener(type, handler, { signal: lifecycle.signal }),
        isControlled: () => navigator.serviceWorker.controller !== null,
        offer: () => {
            statusLine.setNotice(noticeText(say, "notice.update.available"));
            renderStatus();
            if (reloadButton !== null) reloadButton.hidden = false;
        },
    });

    const register = registerWorker ?? ((name, options) => navigator.serviceWorker.register(name, options));
    if ("serviceWorker" in navigator) {
        register("/sw.js", { type: "module" })
            .then((registration) => {
                workerRegistration = registration;
                versionWatcher.registration(registration);
                return checkForANewWorker(registration);
            })
            .catch((error) => {
                // The page works online without the worker, but it will not work
                // offline, and the person has to know that: a page that cannot go
                // offline looks exactly like one that can, and the reason has to
                // reach the console as well as the screen.
                //
                // The notice, and not a problem: the registration will not succeed
                // again on this page, and a problem is erased by the next
                // successful save. A notice stays on the line until something else
                // replaces it.
                console.error(`the offline worker could not be registered: ${error?.message ?? error}`);
                statusLine.setNotice(noticeText(say, "notice.worker.failed"));
                renderStatus();
            });
    }

    // The user comes back to the tab, and the build that was published while they
    // were away is one the browser has not been told about yet. The check is the
    // browser's, and it costs one request; a page that never comes back never
    // needs it.
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState !== "visible") return;
        if (workerRegistration === null) return;
        checkForANewWorker(workerRegistration);
    }, { signal: lifecycle.signal });

    // The offer is a control, not only a sentence: the status line says what
    // happened, and this is the way to act on it. The drawing on screen may hold
    // work that was not saved, so the page does not reload itself — the user
    // says when.
    if (reloadButton !== null) {
        reloadButton.addEventListener("click", () => {
            location.reload();
        }, { signal: lifecycle.signal });
    }
}

