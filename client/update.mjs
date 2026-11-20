// The new build, and the offer to reload into it.
//
// # What this is
//
// The browser is the one that knows whether the worker installed on this
// origin is the one the server publishes now. It compares the worker's script
// and the modules it imports, and it installs the worker again when those
// bytes differ — and because the worker carries the build's identity, that
// comparison IS the comparison of the build with itself.
//
// The answer arrives as events: `updatefound` on the registration, and then the
// installing worker's `statechange`. A page cannot answer the question alone:
// the identity of the build that is published is a fact about the network, and
// the identity of the code the page is running is a fact about the worker the
// browser installed. The browser holds both halves of the comparison, so the
// browser is the one that has to make it.
//
// # Why the offer is the page's
//
// The page cannot reload itself: the drawing on screen may hold work that was
// not saved, and a reload that loses it is worse than a version that arrives
// late. So the page says that there is a new version, and the user decides
// when to go and get it.
//
// # What this module does not do
//
// It does not touch the browser. What the browser answers is injected, so the
// rules below can be exercised without one, and so that the page owns the
// registration and the offer while this owns the question and its answer.

/**
 * Whether a new version is waiting for the user.
 *
 * Two facts have to hold together. The worker the browser is installing has to
 * be INSTALLED — a worker that is still installing is a worker that may yet
 * fail, and an offer for a version that never arrives is a lie. And an older
 * worker has to be in charge — the first worker a page ever installs has
 * nothing to reload from, because the page is already running the build it
 * brought with it.
 *
 * @param {string} state The state the browser reports for the worker.
 * @param {boolean} controlled Whether an older worker is in charge of the page.
 * @returns {boolean}
 */
export function isNewVersionReady(state, controlled) {
    return state === "installed" && controlled === true;
}

/**
 * The watcher: it hears the browser and it offers once.
 *
 * The offer is made once because the browser says the same news several
 * times — the worker goes from installing to installed to activating to
 * activated, and the page is offered a reload it has already been offered.
 *
 * @param {object} options What the watcher needs.
 * @param {(target: object, type: string, handler: () => void) => void} options.listen
 *   How to listen to something. The page passes the browser's own.
 * @param {() => boolean} options.isControlled Whether a worker is in charge of the page.
 * @param {() => void} options.offer What to do when a new version is ready.
 * @returns {object} The watcher's two doors.
 */
export function createVersionWatcher({ listen, isControlled, offer }) {
    let offered = false;

    /**
     * Watch the worker that is being installed.
     *
     * @param {object} worker The worker the browser is installing.
     */
    function watch(worker) {
        if (worker === null || worker === undefined) return;
        listen(worker, "statechange", () => {
            if (offered) return;
            if (!isNewVersionReady(worker.state, isControlled())) return;
            offered = true;
            offer();
        });
    }

    return {
        /**
         * Watch a registration for the worker the browser installs next.
         *
         * @param {object} registration The registration the browser gave.
         */
        registration(registration) {
            listen(registration, "updatefound", () => {
                watch(registration.installing);
            });
            // A worker that was already installing when the page arrived is
            // the same news, and the listener above would have missed it.
            watch(registration.installing);
        },

        /**
         * Whether the offer has been made.
         *
         * @returns {boolean}
         */
        get offered() {
            return offered;
        },
    };
}
