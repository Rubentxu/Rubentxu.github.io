// The status line's state.
//
// # What this is
//
// The line at the bottom of the page says one thing at a time. This module
// holds *which kind* of thing it is saying, so the page renders what the state
// says instead of deciding it with a boolean.
//
// # The three kinds
//
// - **ready** — nothing to report. The session is up and the drawing is fine.
// - **notice** — a statement about the document or about what just happened.
//   It stays on the line until something else replaces it.
// - **problem** — something failed that the user has to act on. It goes away
//   when the thing that failed succeeds again.
//
// # Why a notice is not a problem
//
// A file that had to be repaired leaves a notice: the file the user opened is
// not the file they wrote, and that stays true until another file is opened.
// It used to leave a *problem*, and a problem is erased by the next successful
// autosave. The autosave runs one frame after the file opens — `paint()` only
// asks for a frame, and the frame is where the autosave happens — so the
// notice was on screen for less than a frame and nobody could read it.
//
// One boolean cannot say which of the two it is holding, and guessing wrong
// loses information the user needed.
//
// # Priority
//
// A problem outranks a notice and a notice outranks the ready text: a failure
// the user has to act on matters more than a fact about the document.
//
// # What this is not
//
// It does not touch the DOM. The page owns the element; this owns the state,
// and a test can drive the whole thing without a browser.

/**
 * The colour for something the user has to know about.
 *
 * A reference to the stylesheet's own `--alert`, and not a colour written
 * here: the line is painted on the page, and the page has two themes. A red
 * written in this file would be a red that the dark theme cannot read — it
 * sits on `#121212` at four percent of the light theme's contrast — so the
 * colour belongs to the palette, which knows which theme it is painting.
 */
const ALERT_COLOR = "var(--alert)";

/**
 * Two facts about the drawing, said together.
 *
 * The status line holds one message, and a page that drops one of two true
 * facts to make them fit in one line loses whichever one it drops. So the
 * facts are joined rather than chosen between.
 *
 * It lives here because the line is what says them: a page that joined them
 * with a rule of its own would have a second answer to "what does the line
 * say when there are two things to say", and the two answers would drift.
 *
 * @param {...(string|null)} parts The sentences, in the order they matter.
 * @returns {string|null}
 */
export function joinNotices(...parts) {
    const said = parts.filter((part) => part !== null && part !== "");
    return said.length === 0 ? null : said.join(" ");
}

/**
 * The status line's state.
 *
 * Pure: three slots and the questions about them. Nothing here reads or writes
 * the page, so the rules below are decidable without a canvas.
 *
 * @returns {object} The line's state and the operations on it.
 */
export function createStatusLine() {
    let ready = "";
    let problem = null;
    let notice = null;

    /**
     * What the line says when nothing is wrong.
     *
     * A named function rather than a sibling method, because `current()` calls
     * it and a method reached through `this` would break the moment somebody
     * destructured the line — which is a normal thing to do to an object.
     */
    function normal() {
        return notice ?? { text: ready, color: "" };
    }

    /** What the line says right now. */
    function current() {
        return problem ?? normal();
    }

    return {
        /**
         * The plain line: there is nothing to report.
         *
         * @param {string} text The message.
         */
        setReady(text) {
            ready = text;
        },

        /**
         * Something failed, and the user has to act on it.
         *
         * @param {string} text The message.
         */
        setProblem(text) {
            problem = { text, color: ALERT_COLOR };
        },

        /**
         * A statement about the document, or about what just happened.
         *
         * `important` says the user has to know about it, which is the case for
         * a file that had to be repaired and not for a file that opened whole.
         *
         * @param {string} text The message.
         * @param {boolean} [important] Whether the line says it in red.
         */
        setNotice(text, important = false) {
            notice = { text, color: important ? ALERT_COLOR : "" };
        },

        /**
         * The failure is over: the thing that failed succeeded again.
         *
         * It says nothing about the notice, because a notice is not a failure
         * and a successful save does not make it untrue.
         */
        clearProblem() {
            problem = null;
        },

        /** Whether a failure is being reported. */
        hasProblem() {
            return problem !== null;
        },

        /**
         * Whether the line has no news to draw.
         *
         * The ready text is the absence of news, not a caption: upstream's
         * footer carries no persistent status text, and a sentence that is
         * always there is a sentence nobody reads. The text stays in the line —
         * the live region still holds it for the reader — but the page draws
         * the line only when this answers `false`, which is exactly when there
         * is something to act on.
         */
        isQuiet() {
            return problem === null && notice === null;
        },

        normal,
        current,
    };
}
