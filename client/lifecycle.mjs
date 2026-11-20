// The life of one mounted editor: what it listens to, and how it lets go.
//
// # What this file is
//
// A page that mounts the editor twice, or mounts it and takes it down, must not
// leave behind a listener on the window that still answers keys for an editor
// nobody sees. The browser removes a listener when the signal it was given
// aborts, so one controller per mount is enough: every listener the mount puts
// on a surface that outlives it is given this signal, and `destroy` aborts it.
//
// Resources that are not listeners (a channel, a cached box, an observer) are
// registered with `onDestroy` and let go in the reverse order they were taken,
// the way a stack unwinds.
//
// # What it never does
//
// `destroy` runs once. A second call, or one made from inside a release, does
// nothing. A release that throws does not stop the others: the failure goes to
// `report`, which the mount points at its failure channel, and the next release
// still runs.
//
// The controller is a parameter so a test holds its own and the page passes
// the browser's.

/**
 * @typedef {object} Lifecycle
 * @property {AbortSignal} signal Aborts when the mount is destroyed.
 * @property {() => boolean} destroyed Whether `destroy` has run.
 * @property {(release: () => void) => void} onDestroy Register a release; it runs at once if the mount is already gone.
 * @property {() => void} destroy Abort the signal and run the releases, last registered first.
 */

/**
 * @param {{ controller?: AbortController, report?: (error: unknown) => void }} [options]
 * @returns {Lifecycle}
 */
export function createLifecycle({ controller = new AbortController(), report = () => {} } = {}) {
    let gone = false;
    /** @type {Array<() => void>} */
    const releases = [];

    function run(release) {
        try {
            release();
        } catch (error) {
            report(error);
        }
    }

    return {
        signal: controller.signal,
        destroyed: () => gone,
        onDestroy(release) {
            if (gone) {
                run(release);
                return;
            }
            releases.push(release);
        },
        destroy() {
            if (gone) {
                return;
            }
            gone = true;
            controller.abort();
            while (releases.length > 0) {
                run(releases.pop());
            }
        },
    };
}
