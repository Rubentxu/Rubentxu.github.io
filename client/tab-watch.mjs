// Telling a second tab that the drawing is being written somewhere else.
//
// # Why this exists
//
// The drawing lives in one `localStorage` key, and every tab of the origin
// writes to it. Two tabs open on the same drawing overwrite each other without
// either one knowing: the last write wins and the other tab's edits are gone.
// The store cannot warn anyone, so the tabs warn each other.
//
// # What is said, and what is not
//
// A tab that hears another tab's message passes the complete revision to its
// callback once. The watch itself neither merges nor chooses a resolution; the
// persistence owner decides whether to pause and what to offer the user.
//
// The echo is ignored by id. A `BroadcastChannel` does not deliver a message to
// the object that posted it, but a second channel in the same tab would, and
// the id is what makes "another tab" mean another tab and not another channel.
//
// # What it never does
//
// It never throws. The API missing, the constructor refusing (a sandboxed
// origin), `postMessage` failing and `close` failing all leave the module
// inert or quiet; the save has already landed when this runs.
//
// # The channel is a parameter
//
// The constructor comes in, as the navigator does for the persistence request,
// so a test holds a fake channel and the page passes the real one.

/** The channel's name: one per application, shared by every tab of the origin. */
export const CHANNEL_NAME = "nextdraw.document";

/**
 * @typedef {object} TabWatch
 * @property {(revision: number) => void} announce Say that this tab wrote `revision`.
 * @property {() => void} close Stop listening and release the channel. Idempotent.
 * @property {string} id This tab's id.
 */

/**
 * @param {object} options
 * @param {(new (name: string) => any) | undefined} [options.BroadcastChannel]
 *   The channel constructor. Absent means the watch does nothing.
 * @param {(message: {tab: string, revision: number}) => void} options.onOther Called once, with the first other tab's message.
 * @param {string} [options.id] This tab's id; one is made when none is given.
 * @returns {TabWatch}
 */
export function createTabWatch({ BroadcastChannel: Channel, onOther, id = makeId() }) {
    let channel = null;
    let warned = false;

    try {
        // A missing constructor is a TypeError here, like a refusing one.
        channel = new Channel(CHANNEL_NAME);
        // Node's channel keeps the process alive until it is closed; a browser's has
        // no such method. An embedder that mounts the page outside a browser must
        // not be held open by a listener it never asked for.
        channel.unref?.();
        channel.onmessage = (event) => {
            const message = event?.data;
            if (message === null || typeof message !== "object" || typeof message.tab !== "string") {
                return;
            }
            if (message.tab === id || warned) {
                return;
            }
            warned = true;
            try {
                onOther(message);
            } catch {
                // The warning is a courtesy; its failure is not the save's.
            }
        };
    } catch {
        channel = null;
    }

    return {
        id,
        announce(revision) {
            if (channel === null) {
                return;
            }
            try {
                channel.postMessage({ tab: id, revision });
            } catch {
                // A channel that refuses a message has nothing else to offer.
            }
        },
        close() {
            const closing = channel;
            channel = null;
            try {
                closing?.close();
            } catch {
                // Already closed, or never usable.
            }
        },
    };
}

/** An id for this tab: unique enough that two tabs never share one. */
function makeId() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
