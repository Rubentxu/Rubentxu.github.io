// What crosses the machine's clipboard, in one place.
//
// This is the second use case TASK-26 extracted from the boot coordinator,
// again by churn: paste and share are the two verbs the page shares with the
// rest of the machine, and they are the two the machine can refuse. The code
// moved here verbatim; what changed is only who owns the page values they
// read.
//
// The seam is one factory. `createClipboardUseCase` takes the canvas (the
// raster a shared picture is rendered at), the status line and its render,
// the paint, the chart dialog the spreadsheet paste asks its question
// through, and the kernel's answer about an embeddable address (the paste's
// third road reads that answer instead of holding a list of its own), and
// answers with the two verbs the command registry dispatches.
// The kernel contract is untouched: both verbs make the same `session.*`
// calls they made when they lived in the coordinator.

import {
    blobToDataURL,
    pasteText,
    readSystemClipboard,
    readSystemClipboardItems,
    writeSystemClipboard,
} from "./clipboard.mjs";
import { insertImageFromDataURL, measureInBrowser } from "./image-import.mjs";
import { pngBlobFor, svgTextFor } from "./export.mjs";
import { tryParseSpreadsheet } from "./chart-data.mjs";
import { barChartElements, lineChartElements } from "./chart-elements.mjs";
import { createChartMeasure } from "./chart-measure.mjs";
import { askChart } from "./chart-dialog.mjs";
import { tryMermaidLiterals } from "./mermaid-elements.mjs";
import { embeddableRoadFor } from "./embeddable-url.mjs";
import { shapeJsonFor, TOOLS } from "./tools.mjs";
import { isRefusal } from "./gesture-pipeline.mjs";

/**
 * Build the clipboard use case for one mounted editor.
 *
 * @param {object} page the page values the verbs read.
 * @param {HTMLCanvasElement} page.canvas the drawing surface, for the shared raster.
 * @param {object} page.statusLine the status line handle.
 * @param {() => void} page.renderStatus repaints the status line.
 * @param {(session: object, ctx: object) => void} page.paint paints the scene.
 * @param {Element} page.chartDialog the dialog the spreadsheet paste asks through.
 * @param {(key: string, source: string) => string} [page.text] the words the dialog writes.
 * @param {(link: string) => ({render?: boolean} | boolean)} [page.embeddablePolicy] the kernel's answer about an address, as the mounted page reads it.
 * @returns {object} the two verbs the command registry dispatches.
 */
export function createClipboardUseCase({
    canvas,
    statusLine,
    renderStatus,
    paint,
    chartDialog,
    text,
    embeddablePolicy,
}) {
    async function pasteFromTheSystem(session, ctx, at) {
        try {
            // A picture the system holds is the paste's first answer: a screenshot
            // copied in another application lands in the drawing as a picture,
            // through the same door the picker opens — the bytes are a data URL
            // either way, and the kernel owns the box either way. The clipboard's
            // items are asked for first, because `readText` cannot see a picture;
            // when the ask is refused or carries no picture, the text path answers
            // as it always has.
            const items = await readSystemClipboardItems();
            const image = items
                ?.flatMap((item) => item.types)
                .find((type) => typeof type === "string" && type.startsWith("image/"));
            if (image) {
                const item = items.find((candidate) => candidate.types.includes(image));
                const blob = await item.getType(image);
                const dataURL = await blobToDataURL(blob);
                const newId = await insertImageFromDataURL({
                    session,
                    dataURL,
                    paintFn: () => paint(session, ctx),
                    measure: measureInBrowser,
                    onError: (error) => {
                        statusLine.setProblem(`paste failed: ${error.message ?? error}`);
                        renderStatus();
                    },
                });
                if (newId !== null) {
                    session.setSelection([newId]);
                    paint(session, ctx);
                }
                return;
            }
            const fromSystem = await readSystemClipboard();
            // What the system clipboard holds comes first, because that is the
            // surface this application shares with the rest of the machine.
            //
            // The chart offer reads the SAME text the paste would carry, and it
            // reads it where the reference reads it: after the pictures, before
            // the payload. A text the reader accepts as a chart's data offers
            // the choice; "paste as text" and a dismissed sheet fall through to
            // the ordinary door below, so the offer can never swallow a paste.
            // This application's own copies ride the same text — a drawing's
            // payload is one JSON line, and the reader refuses it by name.
            const sheet = fromSystem === null ? null : tryParseSpreadsheet(fromSystem);
            // `sheet?.ok`: a clipboard the browser refused to read leaves no
            // text at all, and there is no sheet to look at. Reading `.ok` off
            // nothing threw, and the throw ended the paste before it could
            // reach this application's own clipboard — the very fallback the
            // refusal is supposed to have. The question is "is there a sheet
            // here that is one?", and "no sheet" is an answer.
            if (sheet?.ok) {
                const answer = await askChart({
                    host: chartDialog,
                    createElement: (tag) => document.createElement(tag),
                    text,
                });
                if (answer === "bar" || answer === "line") {
                    // The paste's place is the array `screenToScene` answers with,
                    // the same shape the payload door below reads it with.
                    // The chart's labels are measured on the canvas that draws the
                    // chart: the reference asks its render environment for the same
                    // metrics, and a label's width is half of where the next one sits.
                    const measure = createChartMeasure();
                    const elements =
                        answer === "bar"
                            ? barChartElements(sheet.data, { x: at[0], y: at[1] }, measure)
                            : lineChartElements(sheet.data, { x: at[0], y: at[1] }, measure);
                    const pasted = JSON.parse(
                        session.insertLibraryItem(JSON.stringify(elements), at[0], at[1]),
                    );
                    session.setSelection(pasted);
                    paint(session, ctx);
                    return;
                }
            }
            const pasted = pasteText(fromSystem, () => session.clipboardText());
            // A Mermaid flowchart lands as shapes, arrows and labels, one history step.
            // One the converter refuses is pasted as the text it is, with the reason said.
            const diagram = tryMermaidLiterals(pasted);
            if (diagram !== null && diagram.elements) {
                const pasted = JSON.parse(
                    session.insertLibraryItem(JSON.stringify(diagram.elements), at[0], at[1]),
                );
                session.setSelection(pasted);
                paint(session, ctx);
                return;
            }
            if (diagram !== null) {
                statusLine.setProblem(`mermaid not drawn, pasted as text: ${diagram.refusal.message}`);
                renderStatus();
            }
            // Pure embeddable URLs: when every non-empty line of the system's
            // text is a URL the kernel admits, the paste becomes one web embed
            // per line instead of a text — a link copied from the browser's
            // address bar is a frame on the canvas, not a label
            // (`App.clipboard.ts:236-279`, the pinned clone). The road reads
            // the *system's* text only: this application's own payload is a
            // drawing's body, and a refused clipboard says nothing, which is
            // not a paste to classify. Each embed lands at the intrinsic size
            // the reference measures (`App.tsx:8423-8424`) and stores the URL
            // as it was pasted (`:8425`); the next one sits one embed and a
            // gutter of 20 to the right (`App.clipboard.ts:258-260`). The
            // kernel owns which addresses are embeddable, so the page's answer
            // (`embeddable_policy`, `crates/nextdraw-wasm/src/lib.rs`) crosses
            // to the road as `embeddablePolicy`: a paste cannot open a road the
            // render would refuse, and a page that supplies no answer embeds
            // nothing. The URL itself goes over as it is, because the write
            // frontier is the kernel's too.
            if (fromSystem !== null) {
                const embeds = embeddableRoadFor(fromSystem, embeddablePolicy);
                if (embeds !== null) {
                    const ids = [];
                    let prev = null;
                    for (const embed of embeds) {
                        const x = prev !== null ? prev.x + prev.width + 20 : at[0];
                        const y = at[1];
                        const id = crypto.randomUUID();
                        // `shapeJsonFor` answers the element's text — the drag
                        // road's one producer of embeddable bodies — so the
                        // link the paste carries is spelled into it here.
                        const json = JSON.parse(shapeJsonFor(TOOLS.embeddable, id, { x, y }, {
                            x: x + embed.width,
                            y: y + embed.height,
                        }));
                        // The creation call names the two colours itself: a
                        // pasted embeddable is a frame the page fills, not a
                        // shape the pen inks, and upstream writes
                        // `strokeColor` and `backgroundColor` both as
                        // `transparent` where the creation call makes it
                        // (`App.tsx:8394-8395`) — which is why a frame the
                        // reference *pastes* carries no ink where a frame the
                        // reference *drags* carries the pen's.
                        json.strokeColor = "transparent";
                        json.backgroundColor = "transparent";
                        json.link = embed.url;
                        session.insert(JSON.stringify(json), undefined);
                        ids.push(id);
                        prev = { x, width: embed.width };
                    }
                    session.setSelection(ids);
                    paint(session, ctx);
                    return;
                }
            }
            const newIds = pastePayload(session, pasted, at);
            if (newIds.length === 0) {
                return;
            }
            // The kernel returns the new ids in scene order, so they are selected
            // straight away: a drag or resize immediately after a paste moves the
            // paste, not whatever was on the canvas before.
            session.setSelection(newIds);
            paint(session, ctx);
        } catch (error) {
            statusLine.setProblem(`paste failed: ${error.message ?? error}`);
            renderStatus();
        }
    }

    /**
     * Paste the clipboard as text, with no offer on the way.
     *
     * The system's clipboard usually crosses into a payload the kernel reads:
     * a spreadsheet offers a chart and a Mermaid source may become shapes. The
     * plain paste is the user saying "the text itself": the bytes are read and
     * handed to the same payload door as a body, without asking the chart
     * dialog and without the Mermaid converter — a line of a table that looks
     * like a diagram stays the line the person copied.
     *
     * @param {Session} session
     * @param {object} ctx the paint context, for the repaint.
     * @param {number[]} at the place in the scene.
     */
    async function pastePlainFromTheSystem(session, ctx, at) {
        try {
            const text = await readSystemClipboard();
            if (text === null || text === undefined || text === "") {
                return;
            }
            const pasted = pasteText(text, () => session.clipboardText());
            const newIds = pastePayload(session, pasted, at);
            if (newIds.length === 0) {
                return;
            }
            session.setSelection(newIds);
            paint(session, ctx);
        } catch (error) {
            statusLine.setProblem(`paste failed: ${error.message ?? error}`);
            renderStatus();
        }
    }

    /**
     * Put a payload on the canvas, at the place the verb decided.
     *
     * The payload is a text, and the kernel is the one that reads it: a drawing
     * when it says so and carries a list of elements, and a body of text
     * otherwise. Where the text came from is not this door's business — the
     * system clipboard and this application's own clipboard hold the same
     * payload — so both arrive here the same way.
     *
     * A payload with nothing to put down is not a failure: it is nothing to
     * paste, and the answer is an empty list. Every other refusal is a defect,
     * and it is raised rather than swallowed, because a defect that reaches no
     * surface at all looks exactly like a paste that had nothing to put down.
     *
     * @param {Session} session
     * @param {string} payload the payload as it travels.
     * @param {number[]} at the place in the scene.
     * @returns {string[]} the new identities, in scene order.
     */
    function pastePayload(session, payload, at) {
        try {
            return session.pasteClipboard(payload, at[0], at[1]);
        } catch (error) {
            if (isRefusal(error, "empty_clipboard")) {
                return [];
            }
            throw error;
        }
    }

    /**
     * Share what this application holds with the rest of the machine.
     *
     * The payload is written in the shape the family of applications writes, so
     * another application can put on its canvas what was copied or cut here.
     *
     * Sharing is best effort and says nothing when the browser refuses it: the
     * copy is in this application's own clipboard either way, and a browser that
     * will not let the page reach the clipboard does not take the copy away. A
     * payload the kernel cannot write out is a different thing — a defect — and
     * it is reported.
     *
     * @param {Session} session
     */
    function shareWithTheSystem(session, ctx) {
        try {
            const text = session.clipboardText();
            // A selection that holds a picture shares the picture itself, rendered
            // the way the export renders it — the same SVG, the same raster, the
            // same machinery — so the application that pastes next receives a
            // picture and not a stranger's text. The render is asynchronous and
            // the copy has already happened: a browser that refuses the picture
            // leaves the text on the clipboard, which is the copy that was made.
            const ids = session.selectedIds();
            // A selection that holds a picture shares the picture itself, alone:
            // rendered the way the export renders it — the same SVG, the same
            // raster, the same machinery — because a clipboard carrying both a
            // picture and a drawing is pasted twice by an application that reads
            // both, and one copy is one thing. Whether the selection holds a
            // picture is the kernel's own answer: an image is the element with a
            // bitmap to slice.
            // The boundary hands a `None` over as `undefined`, so the question is
            // asked by truthiness: an image's answer is the JSON body naming what
            // it crops, and everything else's is nothing at all.
            const holdsPicture = ids.some((id) => Boolean(session.cropOf(id)));
            if (holdsPicture) {
                const svg = svgTextFor(session, { ids });
                void pngBlobFor(
                    svg,
                    canvas.width,
                    canvas.height,
                    () => new globalThis.Image(),
                    (w, h) => new globalThis.OffscreenCanvas(w, h),
                )
                    .then((png) => writeSystemClipboard(null, undefined, png))
                    .catch(() => {});
                return;
            }
            void writeSystemClipboard(text);
        } catch (error) {
            statusLine.setProblem(`the copy could not be shared: ${error.message ?? error}`);
            renderStatus();
        }
    }

    return { pasteFromTheSystem, pastePlainFromTheSystem, shareWithTheSystem };
}
