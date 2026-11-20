// The install offer: the browser's own verdict, and the one control that takes it.
//
// # What this module is
//
// The page's side of the install story. Chromium fires `beforeinstallprompt`
// when the application meets the criteria to be installed, and this module
// keeps that offer so a person can take it. The button is the way to take it:
// the browser's own little bar is not this page's door, so the event is held
// here and the page says what to do with it.
//
// # What this module is not
//
// The owner of the browser's surfaces. The window that fires the events, the
// navigator that answers about the display mode and the button are injected,
// so the policy can be exercised without a browser — and a browser that cannot
// install the application (Safari, Firefox, an old one) is a page that stays
// exactly as it was.
//
// # Why the offer is a control of its own and not a row of the canvas menu
//
// The canvas menu is the reference's list, row for row: the pinned comparison
// asserts the exact rows it draws (`scripts/e2e/context-menu.test.mjs`), and a
// row of ours would be a row the reference does not have. The offer is not
// part of the drawing application the parity measures; it is a door into the
// browser's own installation, so it lives in a place of its own.
//
// # Why the button is hidden until there is something to offer
//
// An application that is already installed, and a browser that cannot install
// it, have nothing to offer. A button that promises an installation that
// cannot happen is worse than no button at all.
//
// # Why the offer is spent once it is taken
//
// The browser's event may be asked once. A second click on a spent offer would
// be a second `prompt()` the browser refuses, so the button goes away when the
// offer is taken and the browser's own dialog is the door from then on.
//
// # What the answer is worth
//
// The answer says whether the application is installed, and that is the only
// thing the page does with it: an installed application is offered nothing
// again. The browser's own dialog has already told the person what happened,
// so the page does not say it twice.

/**
 * Wire the install offer.
 *
 * @param {object} deps the surfaces the browser answers through.
 * @param {object} deps.window the window the browser fires the events on.
 * @param {object} [deps.navigator] the navigator that knows the display mode.
 * @param {object} [deps.lifecycle] the lifecycle the listeners ride, when the page has one.
 * @param {object} [deps.installButton] the button that takes the offer, when the page has one.
 * @returns {{offered: () => boolean, installed: () => boolean}} what the offer is, for the page that asks.
 */
export function wireInstallOffer({ window, navigator = null, lifecycle = null, installButton = null }) {
    // The offer the browser is holding, when it is holding one.
    let offer = null;
    // Whether the application is already installed. The browser says so twice:
    // once when the installation lands, and once in the display mode it runs
    // in, and both mean the same thing — there is nothing left to install.
    let installed = false;

    /**
     * Whether the page is running as an installed application.
     *
     * The display mode is the browser's own answer and it is asked once: a
     * navigator that cannot answer it (an old one, a fake) leaves the page
     * offering what it can.
     *
     * @returns {boolean} Whether the page is the installed application.
     */
    const runningAsAnApplication = () => {
        const media = navigator?.matchMedia?.("(display-mode: standalone)");
        return media?.matches === true;
    };

    /** Show the offer, when the page has a button for it. */
    const show = () => {
        if (installButton !== null) installButton.hidden = false;
    };

    /** Take the offer back, when the page has a button for it. */
    const hide = () => {
        if (installButton !== null) installButton.hidden = true;
    };

    if (runningAsAnApplication()) installed = true;

    window.addEventListener("beforeinstallprompt", (event) => {
        // The browser's own bar is not this page's door: the offer is kept
        // here and the page says what to do with it.
        event.preventDefault();
        if (installed) return;
        offer = event;
        show();
    }, { signal: lifecycle?.signal });

    window.addEventListener("appinstalled", () => {
        // The installation landed: the offer is spent, and the application is
        // installed, so nothing is offered again.
        installed = true;
        offer = null;
        hide();
    }, { signal: lifecycle?.signal });

    if (installButton !== null) {
        installButton.addEventListener("click", () => {
            const event = offer;
            if (event === null) return;
            // The offer is spent the moment it is taken: the browser's event
            // may be asked once, and a button that stays up over a spent
            // offer is a button that fails.
            offer = null;
            hide();
            (async () => {
                try {
                    await event.prompt();
                    const choice = await event.userChoice;
                    // The answer is what the page does with the offer: an
                    // installed application is offered nothing again.
                    if (choice?.outcome === "accepted") installed = true;
                } catch {
                    // The browser refused the prompt — it may have been called
                    // twice, or the browser may have withdrawn the offer. The
                    // offer is spent either way, and the page says nothing
                    // about an installation nobody asked for.
                }
            })();
        }, { signal: lifecycle?.signal });
    }

    return {
        /** Whether the browser is holding an offer the page has not taken. */
        offered: () => offer !== null,
        /** Whether the application is installed. */
        installed: () => installed,
    };
}
