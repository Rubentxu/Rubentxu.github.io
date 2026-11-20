// The theme's first word, said before the page paints.
//
// The stored theme is applied to the document element before anything is
// painted, so a visitor who chose the dark theme does not see a flash of the
// light one while the editor boots. That is why this file is a CLASSIC script
// and not a module: a module is deferred until the document has been parsed,
// and by then the browser may already have painted the light theme.
//
// The storage key is the one `client/theme.mjs` uses. This file cannot import
// it — a classic script has no imports — so the key is written here and a
// guard compares the two. A key that drifted would store the theme under one
// name and read it under another, and the theme would silently never come
// back.

(function () {
    try {
        var stored = window.localStorage.getItem("nextdraw.theme.v1");
        if (stored) {
            document.documentElement.dataset.theme = stored;
        }
    } catch (error) {
        /* A browser that will not be asked keeps the default theme. */
    }
})();
