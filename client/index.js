// The page's entry, and the factory's first consumer.
//
// Everything the editor does lives in `client/create-app.mjs`: this file is the
// one line the demo page spends to mount it into the markup `index.html`
// carries. A page that embeds the editor calls the same function with its own
// container and gets exactly what this page gets, because this page gets
// nothing this function does not give it.
//
// The handle is published as `window.__app`, the way the embed page and the
// room page publish theirs. It is the one door into the editor: the session
// that every behaviour drives, and the promise that says the page has caught up
// with what it was asked to do (`whenIdle()`). A caller that waits for that
// promise is waiting for the editor and not for the machine — which is the
// difference between a test that measures the application and a test that
// measures its own guess.
//
// # The install offer is the page's own
//
// The band that carries the offer is the page's markup, and an editor embedded
// in somebody else's page is not installable: the offer belongs to the page
// and not to the editor, so it is wired here and not in the mount. It is wired
// BEFORE the mount, because the browser may say the application can be
// installed at any moment after the page loads, and an offer nobody heard is
// an offer nobody can take. The listener lives as long as the page, which is
// as long as the offer can matter: a page that goes away takes it with it.
import { createNextDrawApp } from "./create-app.mjs";
import { wireInstallOffer } from "./install-wiring.mjs";

wireInstallOffer({
    window,
    navigator: window.navigator,
    installButton: document.querySelector("button[data-install-app]"),
});

window.__app = await createNextDrawApp(document.body, {});
