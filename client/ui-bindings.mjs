// The page's toolbars, menu and palette, bound from one table.
//
// What this module is:
// - The one place that calls every toolbar binder (style, inks, text, arrow,
//   history, zoom, image import, tools) and the two command views (the context
//   menu and the palette). `create-app.mjs` calls `bindUiCommands` once, in the
//   same place the block used to live, and reads back the refreshers the paint
//   calls and the `menu`/`palette` handles the keyboard and the right click ask
//   about.
//
// What this module is not:
// - The owner of the words. The locale, the labels and the empty-text sentence
//   arrive as dependencies, because the page is the only module allowed to
//   import the catalogues (`client/i18n.test.mjs` holds that door). A binder
//   that wanted to say something says it through the status line it is handed.
//
// The refreshers are the paint's vocabulary: `paintNow` calls them after every
// frame so a row never shows a selection the kernel has already outlived. They
// are returned, not published, so the page stays the one place that wires them
// to the painter.

import { installChromeCss, installChromeTokens } from "./chrome.mjs";
import { bindFooterHelp, decorateFooterIcons } from "./footer.mjs";
import { decorateStyleButtons } from "./style-icons.mjs";
import { bindStyleToolbars } from "./style-toolbar.mjs";
import { bindStylePanel } from "./style-panel.mjs";
import { bindInks } from "./text-editor-wiring.mjs";
import { bindTextStyle } from "./text-style.mjs";
import { bindArrowStyle } from "./arrow-style.mjs";
import { bindHistoryToolbar } from "./history-toolbar.mjs";
import { bindZoomToolbar } from "./zoom-toolbar.mjs";
import { bindImageImport, measureInBrowser } from "./image-import.mjs";
import { bindToolToolbar } from "./tool-toolbar.mjs";
import { bindContextMenu } from "./context-menu.mjs";
import { bindCanvasMenu, prepareCanvasMenu } from "./canvas-menu.mjs";
import { bindPalette } from "./palette.mjs";
import { ALL_COMMANDS, SHORTCUT_COMMANDS } from "./commands.mjs";
import { bindHelpDialog, bindHintViewer } from "./help.mjs";
import { CHROME_ICONS } from "./chrome-icons.mjs";
import { writeSystemClipboard } from "./clipboard.mjs";

/**
 * Bind every toolbar, the context menu and the command palette.
 *
 * The order of the calls is the order the block had in the page, so the
 * listeners are registered in the same sequence and nothing that reads a
 * sibling's binding at bind time can tell the difference.
 *
 * @param {object} deps the surfaces the binders read.
 * @param {object} deps.document the document the rows are looked up in.
 * @param {object} deps.session the session the binders read and write.
 * @param {object} deps.ctx the paint context the inks repaint with.
 * @param {Function} deps.paint the paint the toolbars ask for.
 * @param {object} deps.statusLine the page's failure channel.
 * @param {Function} deps.renderStatus the one place that puts the state on the screen.
 * @param {object} deps.lifecycle the mount's lifecycle; every listener goes on its signal.
 * @param {Function} deps.viewOnlyNow whether the page refuses edits right now.
 * @param {Function} deps.runCommand the door the menu and the palette run verbs through.
 * @param {Function} deps.toolArmed what arming a tool does besides the tool: the toolbar calls it after a button arms one.
 * @param {Function} deps.commandState the state the palette reads per render.
 * @param {object} deps.toolState the pipeline's tool state.
 * @param {Function} deps.syncCursor the cursor refresher the tool toolbar asks for.
 * @param {Function} deps.setToolButtonRefresher where the pipeline keeps the refresher.
 * @param {Function} deps.labelOf the localized label of a command id.
 * @param {string} deps.emptyText what the palette says when nothing matches.
 * @returns {{syncStyleControls: Function, syncStrokeColour: Function, syncBackgroundColour: Function,
 *   syncTextStyle: Function, syncArrowStyle: Function, syncHistoryButtons: Function,
 *   syncZoomButtons: Function, menu: object, palette: object}} the refreshers the paint
 *   calls and the two handles the page holds.
 */
export function bindUiCommands(deps) {
    const {
        document, session, ctx, paint, statusLine, renderStatus, lifecycle,
        viewOnlyNow, runCommand, toolArmed, commandState, toolState, syncCursor,
        setToolButtonRefresher, labelOf, emptyText, say, pendingGesture, hintPreference, penMode, toolLock,
        theme = () => "light",
    } = deps;
    // The chrome's tokens and stylesheet, before any binder builds a row:
    // every island, button and cycle the binders lay out is drawn by the
    // names these two install (`client/chrome.mjs`), and a binder that ran
    // first would mount into a page the stylesheet has not met yet. Both are
    // idempotent — a page that boots twice replaces its own blocks.
    installChromeTokens(document);
    installChromeCss(document);
    // The menu's rows exist before any binder looks one up. In the page they
    // were built before the theme binder; the call is idempotent, so the
    // suites that bind this table over a fresh page get the same rows.
    prepareCanvasMenu(document);
    const commandsById = new Map(ALL_COMMANDS.map((command) => [command.id, command]));
    const commandOf = (id) => commandsById.get(id);
    // The style rows are upstream's segmented icon options: the icon comes from
    // the same table the toolbar's buttons use, and the label stays the name.
    decorateStyleButtons(document);
    // The footer is upstream's two islands and its help corner: the markup
    // carries the tokens and the drawings come from the iconary here, before
    // the binders read the buttons (`client/footer.mjs`).
    decorateFooterIcons(document);
    // The undo and the redo have two homes. Upstream draws them in the footer's
    // island (`Footer.tsx`) on a desktop and in the phone's shape-actions row
    // (`Actions.tsx:853-872`), the horizontal row that sits above the tool
    // island of the bottom bar. One pair of buttons cannot be in two places,
    // so the layout moves them: the markup carries the pair and this watcher
    // says which of the two homes it is in. The pair is the same pair either
    // way — the binder below holds the element, not the place it is in.
    const phoneLayout = document.defaultView?.matchMedia?.("(max-width: 640px), (pointer: coarse)") ?? null;
    const historyButtons = document.getElementById("history-buttons");
    const footerLeft = document.getElementById("footer-left");
    const styleRow = document.getElementById("style-panel");
    const placeHistoryButtons = () => {
        const home = phoneLayout?.matches === true ? styleRow : footerLeft;
        if (home === null || home === undefined || historyButtons === null) {
            return;
        }
        if (historyButtons.parentElement !== home) {
            home.append(historyButtons);
        }
    };
    placeHistoryButtons();
    phoneLayout?.addEventListener("change", placeHistoryButtons, { signal: lifecycle.signal });
    const syncStyleControls = bindStyleToolbars({
        document,
        session,
        paintFn: () => paint(session, ctx),
        signal: lifecycle.signal,
        onError: (error) => {
            statusLine.setProblem(`setStyle failed: ${error.message ?? error}`);
            renderStatus();
        },
    }).sync;
    // The two inks: a palette and a hex entry each, over the same write door.
    const { syncStrokeColour, syncBackgroundColour } = bindInks({
        document, session, ctx, paint, statusLine, renderStatus, lifecycle, text: say,
        theme,
    });
    // The type settings of a selected text, over the same write door. The
    // page draws each property as its own section (`Actions.tsx`'s font family,
    // font size and text align fieldsets), so the binder is handed the section
    // per property rather than one host for all of them.
    const syncTextStyle = bindTextStyle({
        hosts: {
            fontFamily: document.getElementById("text-family-row"),
            fontSize: document.getElementById("text-size-row"),
            textAlign: document.getElementById("text-align-row"),
            verticalAlign: document.getElementById("text-vertical-row"),
        },
        session,
        paintFn: () => paint(session, ctx),
        createElement: (tag) => document.createElement(tag),
        signal: lifecycle.signal,
        text: say,
        onError: (error) => {
            statusLine.setProblem(`setStyle failed: ${error.message ?? error}`);
            renderStatus();
        },
    }).sync;
    // The heads and the bend of a selected line or arrow, over the same write
    // door. They are two sections upstream — "Arrow type" before the text group
    // and "Arrowheads" after it — so the binder is called twice, once per host.
    const arrowBinder = (host, properties) => bindArrowStyle({
        host,
        properties,
        session,
        paintFn: () => paint(session, ctx),
        createElement: (tag) => document.createElement(tag),
        signal: lifecycle.signal,
        text: say,
        onError: (error) => {
            statusLine.setProblem(`setStyle failed: ${error.message ?? error}`);
            renderStatus();
        },
    }).sync;
    const syncArrowType = arrowBinder(document.getElementById("arrow-type-row"), ["arrowType"]);
    const syncArrowHeads = arrowBinder(document.getElementById("arrow-heads-row"), ["startArrowhead", "endArrowhead"]);
    const syncArrowStyle = (styles) => {
        syncArrowType(styles);
        syncArrowHeads(styles);
    };
    // Undo / redo: the same shape, a fifth refresher with no vocabulary of its own.
    // What earns it its own module instead of a fifth `STYLES` row is that its
    // `disabled` state is the kernel's own answer, so it has no selection to read.
    const syncHistoryButtons = bindHistoryToolbar({
        root: document.getElementById("history-buttons"),
        session,
        paintFn: () => paint(session, ctx),
        isViewOnly: viewOnlyNow,
        signal: lifecycle.signal,
        onError: (error) => {
            statusLine.setProblem(`history failed: ${error.message ?? error}`);
            renderStatus();
        },
    }).sync;
    // Zoom: the third refresher whose state is about the document rather than the
    // selection. Same wiring as the two above; the difference is that its `sync`
    // writes the current level into the button that resets it, so the label the
    // user reads is the level the kernel holds and not a number someone remembered
    // to update.
    const syncZoomButtons = bindZoomToolbar({
        root: document.getElementById("zoom-buttons"),
        session,
        paintFn: () => paint(session, ctx),
        signal: lifecycle.signal,
        onError: (error) => {
            statusLine.setProblem(`zoom failed: ${error.message ?? error}`);
            renderStatus();
        },
    }).sync;
    // Image import: a one-shot dispatcher — no `sync` getter, because
    // import is not a toggle of state. The same `onError` reports
    // `bad_image:` (a non-image data URL) and any `insert` failure with
    // the same status line the trilogy uses, so the user sees a single
    // place to look when something goes wrong on the toolbar side.
    //
    // `measure` is the browser's answer for the pictures the kernel cannot
    // read — an SVG, a BMP, an AVIF. The kernel still reads the four formats
    // it has a grammar for and is never asked to decode them twice: the
    // browser is only consulted once the kernel has said no.
    bindImageImport({
        // The import row lives in the shell menu, so the panel is the root the
        // binder searches: the button and its hidden picker are both in it.
        root: document.getElementById("canvas-menu-panel"),
        session,
        paintFn: () => paint(session, ctx),
        measure: measureInBrowser,
        signal: lifecycle.signal,
        onError: (error) => {
            statusLine.setProblem(`import failed: ${error.message ?? error}`);
            renderStatus();
        },
    });
    // The tool toolbar. Six buttons, one per row of `TOOL_BUTTONS`, built by
    // the binder rather than written in the markup — see `tool-toolbar.mjs` for
    // why. Every button is a toggle: one click selects the tool, the next click
    // on the canvas uses it, and for the text tool the tool returns to selection
    // so the next click is a normal click on what was just inserted. Same shape
    // as Excalidraw.
    setToolButtonRefresher(bindToolToolbar({
        root: document.getElementById("tool-toolbar"),
        toolState,
        createElement: (tag) => document.createElement(tag),
        // The button arms the tool and the runner does the rest of what arming
        // means (the selection drops for a drawing tool), the same as a letter.
        onChange: () => {
            syncCursor();
            toolArmed(session, ctx);
        },
        signal: lifecycle.signal,
        text: say,
        penMode,
        toolLock,
        // The extra-tools menu's image row is a command, not a tool: it runs
        // the same `insertImage` verb the palette and the `9` key run.
        onCommand: (id) => runCommand(id, session, ctx),
    }));
    // The shell menu is separate from the canvas context menu. Its file rows
    // are the controls themselves (the binders above read them by id and data
    // attribute), so the menu only delegates the rows that are views of a
    // surface the page owns — the palette, the help sheet and the confirmed
    // clear — and closes itself after any row but the theme.
    const canvasMenuRoot = document.getElementById("canvas-menu");
    if (canvasMenuRoot !== null) {
        bindCanvasMenu({
            trigger: document.getElementById("canvas-menu-trigger"),
            panel: document.getElementById("canvas-menu-panel"),
            searchAction: () => palette.open(),
            helpAction: () => helpDialog.open(),
            run: (id) => runCommand(id, session, ctx),
            commandOf,
            text: say,
            labelOf,
            hintsEnabled: hintPreference.isEnabled(),
            onToggleHints: (enabled) => {
                hintPreference.setEnabled(enabled);
                hintViewer.refresh();
            },
            signal: lifecycle.signal,
        });
    }
    // The top-right corner, in upstream's order: the share trigger, then the
    // library. The library is the page's own verb (`Alt+0` reaches the same
    // one), so the button is one more door to the panel rather than a second
    // panel. The share trigger copies a link to this editor: this page keeps
    // the drawing in the browser and has no server-backed shareable link to
    // mint, and a button that promised one would be a button that lied.
    const shareButton = document.querySelector("[data-share]");
    if (shareButton !== null) {
        shareButton.addEventListener("click", async () => {
            try {
                const url = globalThis.location?.href ?? "";
                const nav = globalThis.navigator;
                if (typeof nav?.share === "function") {
                    await nav.share({ title: document.title, url });
                    return;
                }
                if (!(await writeSystemClipboard(url, nav))) {
                    throw new Error("the clipboard refused the link");
                }
                statusLine.setNotice(say("ui.share.copied", "Link copied"), false);
                renderStatus();
            } catch {
                statusLine.setProblem(say("ui.share.failed", "The link could not be copied"));
                renderStatus();
            }
        }, { signal: lifecycle.signal });
    }
    const libraryButton = document.querySelector("[data-library-trigger]");
    if (libraryButton !== null) {
        libraryButton.innerHTML = CHROME_ICONS.LibraryIcon;
        libraryButton.addEventListener("click", () => {
            runCommand("library", session, ctx);
        }, { signal: lifecycle.signal });
    }
    // The menu itself. It is bound to a container that is empty in the
    // markup (`index.html`), because the menu's rows are the registry's
    // rows and a hand-written row would be a second place where a command
    // is named.
    //
    // `run` is the same door the keyboard goes through — `runCommand` — so
    // a verb reached by mouse and a verb reached by key do the same thing.
    const menu = bindContextMenu({
        root: document.getElementById("context-menu"),
        createElement: (tag) => document.createElement(tag),
        doc: document,
        run: (id) => runCommand(id, session, ctx),
        labelOf,
        signal: lifecycle.signal,
    });
    // The command palette. The third view of the same registry, and the same
    // door: `run` is `runCommand` again, so a verb reached by typing its name
    // does exactly what the same verb does from the keyboard or the menu.
    //
    // `readState` is a function because the answer changes: the palette asks
    // for the document's state when it opens and again whenever the query
    // changes, and it asks once per render, so a verb that reads the
    // selection does not read it once per row.
    const palette = bindPalette({
        root: document.getElementById("palette"),
        input: document.getElementById("palette-input"),
        list: document.getElementById("palette-list"),
        createElement: (tag) => document.createElement(tag),
        doc: document,
        run: (id) => runCommand(id, session, ctx),
        readState: () => commandState(session, viewOnlyNow),
        labelOf,
        emptyText,
        signal: lifecycle.signal,
    });
    const helpDialog = bindHelpDialog({
        root: document.getElementById("help-dialog"),
        createElement: (tag) => document.createElement(tag),
        commands: SHORTCUT_COMMANDS,
        labelOf,
        say,
        signal: lifecycle.signal,
    });
    // The footer's "?" is the second door to the same sheet: upstream keeps
    // it in the bottom-right corner (`Footer.tsx`), so help is reachable from
    // where the eye expects it and not only from the menu.
    bindFooterHelp({
        root: document.getElementById("canvas-footer"),
        onOpen: () => helpDialog.open(),
        signal: lifecycle.signal,
    });
    const hintViewer = bindHintViewer({
        root: document.getElementById("tool-hint"),
        toolState,
        pendingGesture,
        say,
        isEnabled: hintPreference.isEnabled,
        // The hint's selection branch is the reference's: it asks what is
        // selected only when the tool or the gesture can make the answer
        // depend on it (`help.mjs`), so a stroke pays nothing for it.
        readSelection: () => {
            try {
                const ids = session.selectedIds();
                return { count: ids.length, kind: ids.length === 1 ? session.kindOf(ids[0]) : null };
            } catch {
                return { count: 0, kind: null };
            }
        },
        isMobile: () => document.defaultView?.matchMedia?.("(max-width: 640px), (pointer: coarse)")?.matches === true,
    });
    // The panel's own binder: the selection and the armed tool decide which
    // sections are drawn, the menu's box decides where the island hangs, and
    // the verbs behind the layer, align and action rows are the command
    // registry's. The style rows keep their own refreshers; this one only
    // decides which of them the page shows.
    const labelCommand = (id) => {
        const command = commandsById.get(id);
        return command === undefined ? id : labelOf(command);
    };
    const panel = bindStylePanel({
        root: document.getElementById("style-panel"),
        menu: document.getElementById("canvas-menu"),
        view: document.defaultView,
        session,
        toolState,
        runCommand: (id) => runCommand(id, session, ctx),
        labelCommand,
        icon: (name) => (name === null ? null : (CHROME_ICONS[name] ?? null)),
        isViewOnly: viewOnlyNow,
        // On a phone this panel is not an island under the menu: it is the
        // bottom bar's horizontal style row (`index.html`), and it is up even
        // with nothing selected, because that row carries the undo and the
        // redo.
        isCompact: () => document.defaultView?.matchMedia?.("(max-width: 640px), (pointer: coarse)")?.matches === true,
        createElement: (tag) => document.createElement(tag),
        signal: lifecycle.signal,
    });
    const syncStylePanel = (styles) => {
        syncStyleControls(styles);
        panel.sync(styles);
    };
    // The first answer is the empty canvas's; every later one comes from a
    // paint, the same door the style rows are refreshed through.
    panel.sync(null);
    return {
        syncStyleControls: syncStylePanel, syncStrokeColour, syncBackgroundColour, syncTextStyle,
        syncArrowStyle, syncHistoryButtons, syncZoomButtons, menu, palette, helpDialog, hintViewer,
    };
}
