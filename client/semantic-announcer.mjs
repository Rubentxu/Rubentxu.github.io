// One live region, many messages, few announcements.
//
// A reader moving through the tree fires focus changes far faster than a
// screen reader can speak; announcing every one is how a live region becomes
// noise. The coalescer keeps only the last ordinary message inside a short
// window, and never drops an error: a failure that is coalesced away is a
// failure the user never heard. It emits the last message once, when the
// window closes (TASK-184).

/**
 * Build the announcer over a region element.
 *
 * @param {{ region: { textContent: string }, windowMs?: number,
 *           setTimer?: (run: () => void, ms: number) => unknown,
 *           clearTimer?: (handle: unknown) => void }} options
 * @returns {{ announce: (message: string, options?: { priority?: "polite"|"assertive" }) => void,
 *             flush: () => void }}
 */
export function createAnnouncer({ region, alertRegion = null, windowMs = 250, setTimer = setTimeout, clearTimer = clearTimeout }) {
    let pending = null;
    let timer = null;
    const emit = (message, priority = "polite") => {
        if (priority === "assertive" && alertRegion !== null) {
            // A role=alert region is announced immediately; the polite copy is
            // cleared so the same words are not read twice.
            alertRegion.textContent = message;
            region.textContent = "";
            return;
        }
        region.textContent = message;
    };
    return {
        announce(message, { priority = "polite" } = {}) {
            if (priority === "assertive") {
                if (timer !== null) {
                    clearTimer(timer);
                    timer = null;
                }
                pending = null;
                emit(message, "assertive");
                return;
            }
            pending = message;
            if (timer !== null) {
                clearTimer(timer);
            }
            timer = setTimer(() => {
                timer = null;
                const message_ = pending;
                pending = null;
                if (message_ !== null) {
                    emit(message_, "polite");
                }
            }, windowMs);
        },
        flush() {
            if (timer !== null) {
                clearTimer(timer);
                timer = null;
            }
            if (pending !== null) {
                emit(pending, "polite");
                pending = null;
            }
        },
    };
}
