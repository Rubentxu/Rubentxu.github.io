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
import { createNextDrawApp } from "./create-app.mjs";

window.__app = await createNextDrawApp(document.body, {});
