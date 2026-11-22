// The document's doors: export, open, save, drop and recover.
//
// What this file is:
// - `bindDocumentIo(deps)` wires the page's buttons and its canvas to the files the
//   drawing goes in and out of: the two exports, the open (a chosen file and a dropped
//   one share one door), the save, the library piece dragged onto the canvas, and the
//   button that takes away the drawings that could not be opened.
// - The text moved whole from the page's entry point. What each door means stays in
//   `document-io.mjs`, `export.mjs`, `drop-files.mjs`, `library-drop.mjs` and `recovery.mjs`.
//
// What it takes that the page changes: the page replaces its session when it rebuilds
// after a panic, so the session arrives as a question (`currentSession`) and each handler
// reads it when it runs, not when the page was mounted.

import { exportPng, exportSvgWithFonts, pngBlobForSession } from "./export.mjs";
import { pageFontSource } from "./svg-fonts.mjs";
import { canvasBackground, themeFilter } from "./theme.mjs";
import { askExport } from "./export-dialog.mjs";
import { createSavedMark, describeOpen, openDocumentFile, saveDocumentFile } from "./document-io.mjs";
import { formatText } from "./i18n.mjs";
import { DROP_STEP, bindFileDrop } from "./drop-files.mjs";
import { DROP_TEXTS, bindDropOverlay } from "./drop-overlay.mjs";
import { bindLibraryDrop } from "./library-drop.mjs";
import { insertImageFromDataURL, measureInBrowser } from "./image-import.mjs";
import { blobToDataURL } from "./clipboard.mjs";
import { forgetImages } from "./paint.mjs";
import { noticeText } from "./mode-notices.mjs";

const EXPORT_PREVIEW_MAX_EDGE = 640;

export function bindDocumentIo(deps) {
    const {
        document, window, canvas, canvasRect, lifecycle, statusLine, renderStatus, paint, ctx,
        currentSession, recovery, persistScheduler, say, insertLibraryPieces, viewOnlyNow,
        surface, plural = null,
    } = deps;
    // What an export was asked for, read from the click: the elements the
    // user has chosen — a selection exports alone, the drawing in full when
    // nothing is chosen — and the paper, which rides on the shift key because
    // the transparent file is what most consumers want and the background is
    // the deliberate ask. The paper's colour is the canvas's own, the same
    // declaration the page paints with, so the file and the canvas cannot
    // disagree about what the background is.
    const exportOptions = (event, session) => ({
        ids: session.selectedIds().length > 0 ? session.selectedIds() : null,
        background: event.shiftKey
            ? canvasBackground(document.documentElement)
            : null,
    });
    // The four asks a file can carry, from the sheet's answer: the margin and
    // the divisor cross as numbers, the theme's filter comes from the page's
    // own declaration (the same one the canvas renders through — a second
    // literal here would let the file and the canvas disagree about what dark
    // is), and the embedded scene is the document the kernel holds, so a
    // person who receives the file can reopen it.
    const asksFrom = (answer, session) => ({
        background: answer.background
            ? canvasBackground(document.documentElement)
            : null,
        scale: 1 / answer.resolution,
        resolution: answer.resolution,
        padding: answer.padding,
        darkFilter: answer.dark ? themeFilter(document.documentElement) : null,
        embedScene: answer.embedScene ? session.toJson() : null,
    });
    // The sheet's preview goes through the same PNG rasterizer as the download.
    // A newer choice supersedes an older asynchronous raster, and closing the
    // sheet invalidates work still in flight and releases the visible image URL.
    const exportSheet = (session) => {
        let previewGeneration = 0;
        let previewUrl = null;
        return askExport({
            host: document.getElementById("export-dialog"),
            createElement: (tag) => document.createElement(tag),
            owner: document,
            text: say,
            preview: (answer, image) => {
                const generation = ++previewGeneration;
                try {
                    const options = {
                        ...exportOptions({ shiftKey: false }, session),
                        ...asksFrom(answer, session),
                        maxRasterDimension: EXPORT_PREVIEW_MAX_EDGE,
                    };
                    void pngBlobForSession(
                        session,
                        canvas.width,
                        canvas.height,
                        URL,
                        undefined,
                        undefined,
                        options,
                        pageFontSource(),
                    ).then((blob) => {
                        if (generation !== previewGeneration) return;
                        const href = URL.createObjectURL(blob);
                        if (previewUrl !== null) URL.revokeObjectURL(previewUrl);
                        previewUrl = href;
                        image.src = href;
                    }).catch(() => {
                        if (generation === previewGeneration) {
                            image.alt = say("export-dialog.previewFailed", "Preview unavailable");
                        }
                    });
                } catch {
                    image.alt = say("export-dialog.previewFailed", "Preview unavailable");
                }
            },
            cleanupPreview: () => {
                previewGeneration += 1;
                if (previewUrl !== null) URL.revokeObjectURL(previewUrl);
                previewUrl = null;
            },
        });
    };
    // Export. One crossing and one Blob: the kernel has already walked the
    // scene into a document by the time the browser hears about it, so this
    // handler never sees a point or an attribute. The only thing worth
    // handling is a failure, and there is exactly one — a pen the boundary
    // rejects — which is a defect in `pen.mjs`, not something the user did.
    const exportButton = document.getElementById("export-svg");
    exportButton.addEventListener("click", async (event) => {
        const session = currentSession();
        try {
            // A plain click asks first: the sheet holds the four asks and its
            // answer is what the file carries. Shift is the direct path — the
            // sheet is for a decision, Shift is for "as always".
            let asks = null;
            if (!event.shiftKey) {
                const answer = await exportSheet(session);
                if (answer === null) {
                    return;
                }
                asks = asksFrom(answer, session);
            }
            const result = await exportSvgWithFonts(session, undefined, undefined, { ...exportOptions(event, session), ...asks }, pageFontSource());
            if (result.fontError) {
                // The file was offered, without its faces: say so rather than export quietly.
                statusLine.setProblem(`exported without embedded fonts: ${result.fontError.message ?? result.fontError}`);
                renderStatus();
                return;
            }
            statusLine.clearProblem();
            renderStatus();
        } catch (error) {
            statusLine.setProblem(`export failed: ${error.message ?? error}`);
            renderStatus();
        }
    }, { signal: lifecycle.signal });
    // The PNG export rasterises the SVG at the canvas pixel size (CSS pixels
    // times device pixel ratio), so a Retina display produces a 2× PNG. The
    // same crossing and the same failure surface as the SVG button: a defect
    // in `pen.mjs` is the only thing that can fail, and the status line is
    // where the user hears about it.
    const exportPngButton = document.getElementById("export-png");
    exportPngButton.addEventListener("click", async (event) => {
        const session = currentSession();
        try {
            // The same sheet, the same answer: the PNG rasterises the SVG the
            // kernel builds, so the asks travel with it and the raster paints
            // the margin, the filter and the divisor the file declares.
            let asks = null;
            if (!event.shiftKey) {
                const answer = await exportSheet(session);
                if (answer === null) {
                    return;
                }
                asks = asksFrom(answer, session);
            }
            await exportPng(session, canvas.width, canvas.height, undefined, undefined, undefined, undefined, { ...exportOptions(event, session), ...asks }, pageFontSource());
            statusLine.clearProblem();
            renderStatus();
        } catch (error) {
            statusLine.setProblem(`export failed: ${error.message ?? error}`);
            renderStatus();
        }
    }, { signal: lifecycle.signal });
    // The document: a file in, a file out.
    //
    // The save is the kernel's `toJson` handed to a Blob — one crossing, and the
    // bytes are the kernel's own document rather than something this file
    // reformats. The open is the same crossing in reverse: the text goes to the
    // kernel, and the kernel's verdict is what decides whether the drawing on
    // screen is replaced. A file the kernel refuses leaves the drawing alone,
    // which is why the failure path does not touch the session.
    //
    // The images remembered by id are forgotten after a successful open, and
    // only then: ids belong to a document, and a document may reuse an id the
    // previous one used for a different picture. Forgetting them before the
    // load would throw away the pictures of a drawing that is still on screen
    // when the file turns out not to open.
    const savedMark = createSavedMark();
    const openFileInput = document.querySelector("[data-open-file]");
    const openDocumentButton = document.querySelector("[data-open-document]");
    openDocumentButton.addEventListener("click", () => openFileInput.click(), { signal: lifecycle.signal });
    // One door for a chosen file and a dropped one: the confirmation, the
    // saved mark and the notices are the same whichever way the file arrived.
    const openFile = async (file) => {
        const session = currentSession();
        try {
            const { report, library, pieces, cancelled } = await openDocumentFile(
                file,
                session,
                (envelope) => insertLibraryPieces(session, envelope),
                // Opening replaces the drawing and its history: when it holds
                // work that is in no file, the person decides first.
                async () =>
                    !savedMark.isUnsaved(session) ||
                    typeof window.confirm !== "function" ||
                    window.confirm(
                        formatText(
                            say(
                                "file.replaceConfirm",
                                "Opening {name} replaces the drawing, which has changes that are not saved to a file. Open it anyway?",
                            ),
                            { name: file.name },
                        ),
                    ),
                // The refusals this door raises are words the user reads, so they
                // go through the page's translator.
                say,
            );
            if (cancelled) {
                statusLine.clearProblem();
                statusLine.setNotice(
                    formatText(say("file.openCancelled", "Open cancelled: {name} was not opened."), {
                        name: file.name,
                    }),
                    false,
                );
                renderStatus();
                return;
            }
            forgetImages();
            paint(session, ctx);
            if (library) {
                // A library file is not a drawing to open but pieces to lay
                // down: the open leaves the user's drawing alone, and the
                // pieces the file carried stand on the canvas. The last
                // piece's identities are the selection, because the last
                // insert is the one the user reaches for first.
                const count = pieces ?? 0;
                const note =
                    plural === null
                        ? `${count} piece${count === 1 ? "" : "s"} inserted`
                        : plural("libraryFile.pieces", count, {
                            one: "{count} piece inserted",
                            other: "{count} pieces inserted",
                        });
                statusLine.clearProblem();
                statusLine.setNotice(
                    formatText(say("file.libraryOpened", "Opened {name}: {note}."), {
                        name: file.name,
                        note,
                    }),
                    true,
                );
                renderStatus();
                return;
            }
            // The kernel says what it had to do to open the file. A file that opened
            // exactly as it was written says nothing, and the status line says what it
            // has always said. A file that had to be repaired, kept whole or trimmed
            // says so, and says it in the colour the status line uses for something
            // the user has to know about: the file they opened is not the file they
            // wrote.
            //
            // It is a *notice* and not a failure. The repair is in the document, so
            // the fact stays true through every edit that follows — and the autosave
            // runs one frame from here, so a failure would have been wiped by it
            // before anybody could read it.
            savedMark.markSaved(session);
            const note = describeOpen(report, plural);
            statusLine.clearProblem();
            statusLine.setNotice(
                note === null
                    ? formatText(say("file.opened", "Opened {name}."), { name: file.name })
                    : formatText(say("file.openedWithNote", "Opened {name}. {note}"), {
                        name: file.name,
                        note,
                    }),
                note !== null,
            );
            renderStatus();
        } catch (error) {
            // The drawing on screen is untouched: the kernel replaces the
            // document only when the file opens. All that is left to do is
            // tell the user why their file did not open.
            statusLine.setProblem(
                formatText(say("file.openFailed", "could not open {name}: {error}"), {
                    name: file.name,
                    error: error.message ?? error,
                }),
            );
            renderStatus();
        }
    };
    openFileInput.addEventListener("change", () => {
        const file = openFileInput.files?.[0];
        // The input is emptied before the file is read, so choosing the same
        // file twice fires `change` twice: browsers only report a change when
        // the value differs from the last one.
        openFileInput.value = "";
        if (file) {
            openFile(file);
        }
    }, { signal: lifecycle.signal });
    // The flight of a file has a visible answer (TASK-145): what a drop
    // would do, said while the file is in the air. The state is display-only
    // — the drop itself stays the door below. The words are the locale's,
    // read the way every saying here is read.
    bindDropOverlay({
        surface,
        ownerDocument: document,
        viewWindow: window,
        t: (key) => say(`drop.${key}`, DROP_TEXTS[key]),
        isViewOnly: viewOnlyNow,
        signal: lifecycle.signal,
    });
    // Files dropped on the canvas: a picture lands where it fell, a drawing or a
    // library goes through the Open door above.
    bindFileDrop({
        target: canvas,
        isViewOnly: viewOnlyNow,
        onDocument: openFile,
        onImage: async (file, { clientX, clientY, index }) => {
            const session = currentSession();
            try {
                const rect = canvasRect.get();
                const [x, y] = session.screenToScene(clientX - rect.left, clientY - rect.top);
                const newId = await insertImageFromDataURL({
                    session,
                    dataURL: await blobToDataURL(file),
                    at: [x + index * DROP_STEP, y + index * DROP_STEP],
                    paintFn: () => paint(session, ctx),
                    measure: measureInBrowser,
                    onError: (error) => {
                        statusLine.setProblem(`drop failed: ${error.message ?? error}`);
                        renderStatus();
                    },
                });
                if (newId !== null) {
                    session.setSelection([newId]);
                    paint(session, ctx);
                }
            } catch (error) {
                statusLine.setProblem(`drop failed: ${error.message ?? error}`);
                renderStatus();
            }
        },
        onRefuse: (file) => {
            statusLine.setProblem(`could not use ${file.name}: drop a picture or a drawing file`);
            renderStatus();
        },
        signal: lifecycle.signal,
    });
    // A piece dragged from the library panel lands where it was dropped. The point is
    // the kernel's conversion of the pointer; the page does no geometry of its own.
    bindLibraryDrop({
        target: canvas,
        isViewOnly: viewOnlyNow,
        onRefuse: () => {
            statusLine.setProblem(say("library.viewOnly", "The page is read-only"));
            renderStatus();
        },
        onPiece: async (piece, { clientX, clientY }) => {
            const session = currentSession();
            const rect = canvasRect.get();
            const where = session.screenToScene(clientX - rect.left, clientY - rect.top);
            await insertLibraryPieces(session, { libraryItems: [piece] }, where);
            paint(session, ctx);
        },
        signal: lifecycle.signal,
    });
    const saveDocumentButton = document.querySelector("[data-save-document]");
    saveDocumentButton.addEventListener("click", () => {
        const session = currentSession();
        try {
            saveDocumentFile(session, { mark: savedMark });
            statusLine.clearProblem();
            statusLine.setNotice(noticeText(say, "notice.save.done"));
            renderStatus();
        } catch (error) {
            statusLine.setProblem(`save failed: ${error.message ?? error}`);
            renderStatus();
        }
    }, { signal: lifecycle.signal });
    // The drawings that could not be opened. The button is only there when
    // there is something to take away: a control that appears and disappears
    // is a control the user learns to ignore, and the bar is already tight.
    const recoverButton = document.querySelector("[data-recover-document]");
    const refreshRecoverButton = () => {
        recoverButton.hidden = !recovery.waiting();
    };
    recoverButton.addEventListener("click", async () => {
        try {
            // The handoff may ask the browser where to put the file, and the
            // browser answers when it is done, so this is not a click that
            // ends with the drawing in the user's hands: it ends when the
            // browser says so.
            const outcome = await recovery.take();
            refreshRecoverButton();
            if (!outcome.offered && !outcome.released) {
                // The user closed the file picker, or there was nothing to
                // take away. Either way there is nothing to report, and the
                // line keeps whatever it was saying.
                return;
            }
            // What differs between the outcomes is what is known. When the
            // file is on the disk and this application let go of its copy,
            // the drawing is recovered. When the file is on the disk and the
            // copy is still here, the bytes exist twice and the user has to
            // try again. And when the file was never confirmed on the disk,
            // the copy here is the only one there is and the drawing on
            // screen is still not being saved.
            const paused = recovery.held ? ` ${noticeText(say, "notice.recover.paused")}` : "";
            if (outcome.released) {
                // The drawing on screen is being saved again, so whatever
                // failure the line was reporting is over.
                statusLine.clearProblem();
                statusLine.setNotice(
                    noticeText(say, outcome.confirmed ? "notice.recover.done" : "notice.recover.offered"),
                );
                // The drawing on screen is savable again, so it is asked to be
                // saved now. Waiting for the next edit would leave the work
                // that was just made safe sitting in memory for as long as the
                // user does not draw again.
                persistScheduler.request(currentSession());
            } else if (outcome.confirmed) {
                // The file is on the disk but the copy kept here could not be
                // removed. The drawing on screen is being saved, so this is a
                // fact about the queue and not a failure — but the user still
                // has to come back for it.
                statusLine.clearProblem();
                statusLine.setNotice(
                    noticeText(say, "notice.recover.retry"),
                    true,
                );
            } else {
                // The file was never confirmed on the disk, so the copy here is
                // the only one there is, and the drawing on screen is not being
                // saved. That is a failure the user has to act on.
                statusLine.setProblem(
                    noticeText(say, "notice.recover.unconfirmed") + paused,
                );
            }
            renderStatus();
        } catch (error) {
            statusLine.setProblem(`recover failed: ${error.message ?? error}`);
            renderStatus();
        }
    }, { signal: lifecycle.signal });
    refreshRecoverButton();
}
