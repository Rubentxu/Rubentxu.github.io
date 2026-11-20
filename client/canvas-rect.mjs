// Where the canvas is on the page, read once and kept until the page moves it.
//
// # Why this exists
//
// Turning a pointer position into a canvas position needs the canvas's box, and
// asking the browser for the box forces a layout. Doing it on every pointer
// move, right after the page wrote to the DOM, is a layout per event. The box
// only changes when the canvas is resized or the page is scrolled or resized,
// so it is read once and kept until one of those says otherwise.
//
// # Never stale
//
// A cached box is only trusted while something is watching for the changes
// that would make it wrong. When the page has no `ResizeObserver`, or the
// observer refuses to observe, nothing would ever invalidate the cache, so
// `get()` reads every time: slower, and never wrong. A box that moves without
// changing size is not seen by the observer; window `scroll` and `resize`
// cover the usual causes, and the gesture pipeline drops the cache at each
// press so a gesture always starts from a fresh box.
//
// # What it never does
//
// It never throws. An observer or listener that fails leaves the module
// reading every time; a read that fails answers the last box it had, or an
// empty one.
//
// # The browser is a parameter
//
// The element, the window and the observer constructor come in, so a suite
// holds fakes and the page passes the real ones.

const EMPTY = Object.freeze({ x: 0, y: 0, left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 });

/**
 * @typedef {object} CanvasRect
 * @property {() => DOMRect} get The canvas's box, from the cache when it can be trusted.
 * @property {() => void} invalidate Drop the cache; the next `get()` reads again.
 * @property {() => void} close Stop watching and drop the cache. Idempotent.
 */

/**
 * @param {object} options
 * @param {{ getBoundingClientRect: () => DOMRect }} options.element The canvas.
 * @param {{ addEventListener: Function, removeEventListener?: Function } | undefined} [options.window]
 * @param {(new (callback: () => void) => { observe: Function, disconnect: Function }) | undefined} [options.ResizeObserver]
 * @returns {CanvasRect}
 */
export function createCanvasRect({ element, window: win, ResizeObserver: Observer }) {
    let cached = null;
    let last = EMPTY;
    let watching = false;
    let closed = false;
    let observer = null;
    const invalidate = () => {
        cached = null;
    };
    const listeners = [];

    try {
        observer = new Observer(invalidate);
        observer.observe(element);
        watching = true;
    } catch {
        observer = null;
        watching = false;
    }

    if (watching) {
        for (const [name, capture] of [["scroll", true], ["resize", false]]) {
            try {
                win.addEventListener(name, invalidate, capture);
                listeners.push([name, capture]);
            } catch {
                // The observer still covers a resize of the canvas itself.
            }
        }
    }

    return {
        get() {
            if (cached !== null && watching) {
                return cached;
            }
            try {
                last = element.getBoundingClientRect();
            } catch {
                return last;
            }
            cached = last;
            return last;
        },
        invalidate,
        close() {
            if (closed) {
                return;
            }
            closed = true;
            watching = false;
            cached = null;
            try {
                observer?.disconnect();
            } catch {
                // Already gone.
            }
            for (const [name, capture] of listeners) {
                try {
                    win.removeEventListener?.(name, invalidate, capture);
                } catch {
                    // Nothing else to release.
                }
            }
        },
    };
}
