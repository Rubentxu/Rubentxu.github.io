// The promise that says the application has caught up with what it was asked
// to do.
//
// # What this is
//
// A page that has been told to draw something has three things left to do
// before a person can see it: the document has to change, the change has to
// reach the screen, and the change has to be written down so that a reload
// finds it. The first happens inside the event handler, so a caller that has
// sent a gesture knows it already happened. The second happens in the frame
// after that, and the third in the browser's next idle moment after the
// frame.
//
// This module owns the answer to "has all of that happened yet?", and it is
// the answer a test asks instead of guessing how long it takes.
//
// # Why the question is not a number
//
// A number of milliseconds is a claim about the machine: it says how long the
// application was expected to take, and it is wrong on every machine that is
// not the one it was measured on. A promise that resolves when the
// application says it is done is a claim about the application, and it holds
// on every machine.
//
// The two halves are asked of the two halves that own them. The frame is the
// client's own (`client/frame.mjs` knows when a frame has been painted), and
// the write is the autosave's own (`client/persist.mjs` knows what is owed).
//
// # Why the frame is counted and not waited for
//
// Waiting for "no frame is pending" would be the obvious way to ask, and it
// is the wrong question: an application that keeps painting never has no
// frame pending. A room with peers in it paints the remote pointers on every
// frame, a laser trail keeps asking for frames while it fades, and an
// application that asks for a frame from inside its own paint schedules the
// next one before the current one has finished. Those pages are never idle,
// and a waiter that waits for idleness waits for ever.
//
// The count is the other half of the truth. A frame that has been *painted*
// since the question was asked is a frame the person can see; that is a fact
// about the past, and the past does not move.
//
// # What the promise guarantees when it resolves
//
// Two things, and both of them are facts about the state of the page rather
// than about the passage of time:
//
// - a frame has been painted since the question was asked, so the screen
//   carries the change;
// - the document has been written down, so the revision is stored.
//
// The write is *asked for* here rather than left to the browser's idle
// moment. The idle moment is a promise the browser makes about when it has
// nothing better to do, and a page that never goes idle waits a second for
// it; the write itself is the same write either way, and asking for it now
// is what makes the promise mean what it says.
//
// # Why the clock is injected
//
// The same reason `client/frame.mjs` and `client/persist.mjs` inject theirs:
// the module then runs under a fake, and the tests are the only place the
// "did it resolve at the right moment?" question can be answered at all.

/**
 * The promise that says the application has caught up.
 *
 * @param {object} options what to ask and what to tell.
 * @param {(run: () => void) => void} options.requestFrame The clock: the
 *   browser's next frame.
 * @param {() => number} options.paintedFrames How many frames have been
 *   painted since the application started.
 * @param {() => boolean} options.framePending Whether a frame has been asked
 *   for and has not run yet.
 * @param {() => void} options.save Write the document down now.
 * @returns {() => Promise<void>} the promise, asked for as many times as
 *   needed.
 */
export function createIdleWaiter({ requestFrame, paintedFrames, framePending, save }) {
    return function whenIdle() {
        // The frame count as it is *now*: the promise is about what happens
        // from here on, and a frame painted before the question was asked is
        // not an answer to it.
        const seen = paintedFrames();
        return new Promise((resolve, reject) => {
            const check = () => {
                try {
                    // Either a frame has reached the screen since the
                    // question, or there was never a frame to wait for: a
                    // gesture that changed nothing asks for no paint, and a
                    // waiter that only watched the count would wait for a
                    // frame that is never coming.
                    if (paintedFrames() > seen || !framePending()) {
                        // The write happens before the promise resolves, so
                        // that a caller who awaits it can reload the page and
                        // find the drawing there.
                        save();
                        resolve();
                        return;
                    }
                    requestFrame(check);
                } catch (error) {
                    // A waiter that never settles is a waiter that hangs the
                    // caller, and a hang says nothing about why.
                    reject(error);
                }
            };
            requestFrame(check);
        });
    };
}
