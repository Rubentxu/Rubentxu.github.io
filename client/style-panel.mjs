// The properties panel: whether it is up, what it holds, and where it hangs.
//
// # What this module owns
//
// Upstream's `SelectedShapeActions` (`packages/excalidraw/components/Actions.tsx`)
// is not one fixed form. It is a list of sections filtered by two questions —
// what kind of element is selected, and which tool is armed — and it is drawn
// only while one of those answers says there is something to configure
// (`showSelectedShapeActions`, `packages/element/src/showSelectedShapeActions.ts`).
// Upstream placed it in a column under the top-left menu island
// (`LayerUI.tsx:314-336`); the transit map gives it a home of its own — the
// inspector column on the sheet's right edge — and this module places it there.
//
// The page's markup carries the sections; this module owns the two facts the
// markup cannot: which of them are up, and where the island sits. Keeping the
// decision here means the arrow and text binders stay binders — they build the
// buttons of a row and know nothing about whether their row belongs on screen —
// and it means the rule can be read and tested without a browser.
//
// # Why the predicates are copied rather than imported
//
// This is a JavaScript port of a TypeScript file. It does not have upstream's
// `hasStrokeColor` table, and importing one would mean importing the editor's
// element package. The sets below are that table, one row per section, and they
// are the whole of the port's answer to "does this control apply?". They are
// derived from the pinned tree (d3a9c2a), and the ones the port does not model
// (`iframe`, `autoshape`) are kept where a kind could reach them.
//
// # What is deliberately absent
//
// Position, size and angle are not in this panel. Upstream keeps them in the
// statistics panel (`components/Stats/`), a separate island with its own door;
// inventing them here would show a control the reference does not have in this
// place. The panel shows what `SelectedShapeActions` shows.

import { linearPointsEditable } from "./vertex-edit.mjs";

/**
 * The sections' order, as `Actions.tsx` renders them.
 *
 * Arrow type sits before the text group and the arrowheads after it, which is
 * why a mixed text-and-arrow selection keeps that relative order. The ids are
 * the `data-panel-section` attributes the markup carries.
 */
export const PANEL_SECTIONS = Object.freeze([
    "stroke",
    "background",
    "fill",
    "width",
    "strokeStyle",
    "sloppiness",
    "edges",
    "arrowType",
    "fontFamily",
    "fontSize",
    "textAlign",
    "verticalAlign",
    "arrowheads",
    "opacity",
    "layers",
    "align",
    "actions",
]);

/**
 * The kinds that carry each property, from `packages/element/src/comparisons.ts`.
 *
 * The values are element `type` names and tool names at once: the port's tools
 * are named after the kind they draw, so one set answers both questions. A
 * `null` kind — an id the scene no longer holds — belongs to no set.
 */
const KINDS = Object.freeze({
    strokeColor: new Set([
        "rectangle",
        "stickynote",
        "ellipse",
        "diamond",
        "freedraw",
        "arrow",
        "line",
        "text",
        "embeddable",
    ]),
    background: new Set(["rectangle", "stickynote", "iframe", "embeddable", "ellipse", "diamond", "line", "freedraw"]),
    fill: new Set(["rectangle", "iframe", "embeddable", "ellipse", "diamond", "line", "freedraw"]),
    strokeWidth: new Set([
        "rectangle",
        "iframe",
        "embeddable",
        "ellipse",
        "diamond",
        "freedraw",
        "arrow",
        "line",
    ]),
    strokeStyle: new Set(["rectangle", "iframe", "embeddable", "ellipse", "diamond", "arrow", "line"]),
    sloppiness: new Set(["rectangle", "iframe", "embeddable", "ellipse", "diamond", "arrow", "line", "stickynote"]),
    edges: new Set(["rectangle", "iframe", "embeddable", "line", "diamond", "stickynote", "image"]),
    arrow: new Set(["arrow"]),
    text: new Set(["text"]),
});

/** The tools that are a cursor rather than a creator, from `showSelectedShapeActions`. */
const CURSOR_TOOLS = new Set(["selection", "hand", "eraser", "laser"]);

/**
 * The commands behind the three action sections, in upstream's order.
 *
 * Every one of them already exists in `client/commands.mjs`; the panel is a
 * second door to the same verbs, not a second implementation. `layers` is
 * `Actions.tsx`'s `LayersFieldset`, `align` is its `AlignFieldset` with the
 * distribution row, and `actions` is its `showExtraActions` fieldset. The
 * image crop and the linear editor are the two conditional members.
 */
export const PANEL_COMMANDS = Object.freeze({
    layers: Object.freeze(["back", "backward", "forward", "front"]),
    align: Object.freeze([
        "align:arrowleft",
        "align:h",
        "align:arrowright",
        "distributeHorizontally",
        "align:arrowup",
        "align:v",
        "align:arrowdown",
        "distributeVertically",
    ]),
    actions: Object.freeze(["duplicate", "delete", "group", "ungroup", "editLink", "cropArm", "editLinearPoints"]),
});

/**
 * Which drawing of a command stands in the button, from the iconary.
 *
 * The panel's sections are icon buttons upstream, and the icons are the ones
 * the chrome already carries. A command with no drawing here keeps its label,
 * which is the honest answer for a row the iconary has not covered.
 */
export const PANEL_ICONS = Object.freeze({
    back: "SendToBackIcon",
    backward: "SendBackwardIcon",
    forward: "BringForwardIcon",
    front: "BringToFrontIcon",
    "align:arrowleft": "AlignLeftIcon",
    "align:h": "CenterHorizontallyIcon",
    "align:arrowright": "AlignRightIcon",
    "align:arrowup": "AlignTopIcon",
    "align:v": "CenterVerticallyIcon",
    "align:arrowdown": "AlignBottomIcon",
    distributeHorizontally: "DistributeHorizontallyIcon",
    distributeVertically: "DistributeVerticallyIcon",
    duplicate: "DuplicateIcon",
    delete: "TrashIcon",
    group: "GroupIcon",
    ungroup: "UngroupIcon",
    editLink: "LinkIcon",
    cropArm: "cropIcon",
    // The line editor's drawing stands for the verb that edits the line's
    // points. `editSelected` keeps the Enter key and its label, not this icon:
    // a panel button that fabricates a double click says one thing and does
    // another (`run-command.mjs`).
    editLinearPoints: "lineEditorIcon",
});

/**
 * Whether the panel is drawn at all.
 *
 * Upstream's `showSelectedShapeActions` asks two questions: is the page in
 * view mode, and is there either a selection or a tool that creates something?
 * The cursor tools are the exception on the second question — selecting,
 * panning, erasing and pointing configure nothing — and `text` is not: the text
 * tool's panel is where its typeface and size live.
 *
 * A phone is the other answer. Upstream's phone draws no island under the
 * menu at all: the properties live in the horizontal style row of the bottom
 * bar (`Actions.tsx:724-874`), and that row is drawn whether or not anything
 * is selected — it carries the undo and the redo (`Actions.tsx:853-872`). So
 * the row is up on a phone even with the cursor tool and nothing selected, and
 * the desktop's rule ("never the cursor's") is the desktop's rule.
 *
 * @param {object} state The answers.
 * @param {string} state.tool The armed tool's name.
 * @param {number} [state.selectionCount] How many ids are selected.
 * @param {boolean} [state.viewOnly] Whether the page refuses edits.
 * @param {boolean} [state.compact] Whether the page is a phone or a coarse
 *   pointer, where this panel is the bottom bar's style row and not an
 *   island of its own.
 * @returns {boolean} Whether the island belongs on screen.
 */
export function panelIsVisible({ tool, selectionCount = 0, viewOnly = false, compact = false }) {
    if (viewOnly) {
        return false;
    }
    if (compact) {
        // The phone's row is the row that carries the undo and the redo, so it
        // is up even when nothing is selected.
        return true;
    }
    return selectionCount > 0 || !CURSOR_TOOLS.has(tool);
}

/**
 * The sections that apply, in `Actions.tsx`'s order.
 *
 * A section is up when the armed tool carries its property **or** any selected
 * kind does — the same "tool or selection" union `getShapeActionPredicates`
 * builds. Fill has a second condition: upstream draws it only when the
 * background is not transparent, because a fill style over no fill configures
 * nothing. Layers is the one section that also knows about the tool: upstream
 * hides the stack controls while the freehand tool is armed with nothing
 * selected, because there is no stack position to move before the stroke
 * exists.
 *
 * @param {object} state The answers.
 * @param {string} state.tool The armed tool's name.
 * @param {string[]} [state.kinds] The selected elements' types.
 * @param {object|null} [state.styles] The parsed `stylesOf` answer, or null.
 * @param {number} [state.selectionCount] How many ids are selected.
 * @returns {string[]} The visible section ids, in order.
 */
export function panelSections({ tool, kinds = [], styles = null, selectionCount = kinds.length }) {
    const applies = (set) => set.has(tool) || kinds.some((kind) => kind !== null && set.has(kind));
    const sections = [];
    const push = (condition, id) => {
        if (condition) sections.push(id);
    };
    push(applies(KINDS.strokeColor), "stroke");
    push(applies(KINDS.background), "background");
    push(applies(KINDS.fill) && styles !== null && styles.backgroundColor !== "transparent", "fill");
    push(applies(KINDS.strokeWidth), "width");
    push(applies(KINDS.strokeStyle), "strokeStyle");
    push(applies(KINDS.sloppiness), "sloppiness");
    push(applies(KINDS.edges), "edges");
    push(applies(KINDS.arrow), "arrowType");
    push(applies(KINDS.text), "fontFamily");
    push(applies(KINDS.text), "fontSize");
    push(applies(KINDS.text), "textAlign");
    // Vertical alignment is the bound text's: `shouldAllowVerticalAlign` is
    // true only for a text inside a container, and the port has no separate
    // read for "is bound". The value is the kernel's, and a bound text whose
    // alignment is not the plain top is the one the port can see — showing the
    // row for a top-aligned text would offer a control upstream does not.
    push(applies(KINDS.text) && styles !== null && (styles.verticalAlign === "middle" || styles.verticalAlign === "bottom" || styles.verticalAlign === "mixed"), "verticalAlign");
    push(applies(KINDS.arrow), "arrowheads");
    // The opacity slider is on every panel upstream draws. The one tool that
    // has a different answer is `bucketfill`, which the port does not have.
    push(true, "opacity");
    // The layer actions are hidden only while the freehand tool is armed with
    // nothing selected: there is no stack position to move before the stroke
    // exists.
    push(selectionCount > 0 || tool !== "freedraw", "layers");
    push(selectionCount > 1, "align");
    push(selectionCount > 0, "actions");
    return sections;
}

/**
 * Where the inspector column sits and how tall it may grow.
 *
 * The map's inspector is an edge of the sheet, not a guest of a toolbar: it
 * starts under the 48 px band, stops above the 24 px status strip, and is
 * measured from the window's right edge. The column's width (280 px, the
 * contract's) lives in the page's stylesheet because it is layout; the numbers
 * that depend on the running viewport are here.
 *
 * A phone has no island to place: the same element is the bottom bar's style
 * row there, and the stylesheet puts it (`index.html`). This function is the
 * desktop's answer and says nothing about the phone.
 *
 * @param {object} state The answers.
 * @param {number} state.viewportWidth The window's inner width.
 * @param {number} state.viewportHeight The window's inner height.
 * @param {number} [state.width] The inspector column's width.
 * @param {number} [state.band] The top band's height.
 * @param {number} [state.strip] The status strip's height.
 * @returns {{left: number, top: number, maxHeight: number}} The box to write.
 */
export function panelPlacement({ viewportWidth, viewportHeight, width = 280, band = 48, strip = 24 }) {
    // The inspector column (TASK-285): flush with the right edge of the sheet,
    // running from the band down to the status strip. It is placed by the
    // window, not by the menu's box, because the map's inspector is an edge of
    // the sheet and not a guest of a toolbar.
    return {
        left: Math.round(viewportWidth - width),
        top: band,
        maxHeight: Math.max(0, Math.round(viewportHeight - band - strip)),
    };
}

/**
 * Bind the panel: its visibility, its sections, its action rows and its place.
 *
 * `sync(styles)` is the frame's call, beside the style rows' own: it reads the
 * selection and the armed tool, flips every section's `hidden`, and puts the
 * column on the sheet's right edge. It is one function because the facts move
 * together —
 * a panel whose box moved but whose rows did not is a panel showing a
 * selection the kernel has already outlived.
 *
 * The action rows are built here, not spelled in the markup: their labels are
 * the command registry's, their drawings are the iconary's, and a command the
 * registry stops offering must leave the row without anyone editing an HTML
 * file to remove it. The row's host is still markup, because it belongs to a
 * section whose legend is.
 *
 * @param {object} options The binder's surfaces.
 * @param {Element} options.root The `#style-panel` inspector column.
 * @param {object} options.view The window (its box and resize event).
 * @param {object} options.session The kernel: `selectedIds` and `kindOf`.
 * @param {{currentTool: string}} options.toolState The armed tool.
 * @param {(id: string) => void} options.runCommand The page's one verb door.
 * @param {(id: string) => string} options.labelCommand The command's localized label.
 * @param {(name: string) => string|null} [options.icon] The iconary's drawing, or null.
 * @param {() => boolean} [options.isViewOnly] Whether the page refuses edits.
 * @param {(tag: string) => Element} options.createElement The page's builder.
 * @param {AbortSignal} [options.signal] When it aborts the resize listener comes off.
 * @returns {{sync: (styles: object|null) => void, place: () => void}} The per-frame refresher.
 */
export function bindStylePanel({
    root,
    view,
    session,
    toolState,
    runCommand,
    labelCommand,
    icon = () => null,
    isViewOnly = () => false,
    isCompact = () => false,
    createElement,
    signal,
}) {
    if (root === null || root === undefined) {
        throw new Error("style-panel: no #style-panel to bind");
    }
    const sections = new Map();
    for (const node of root.querySelectorAll("[data-panel-section]")) {
        sections.set(node.getAttribute("data-panel-section"), node);
    }
    const hosts = {
        layers: root.querySelector("#layers-row"),
        align: root.querySelector("#align-row"),
        actions: root.querySelector("#actions-row"),
    };
    const built = new Map();
    for (const [section, ids] of Object.entries(PANEL_COMMANDS)) {
        const host = hosts[section];
        if (host === null || host === undefined) {
            continue;
        }
        const commands = new Map();
        for (const id of ids) {
            const button = createElement("button");
            button.setAttribute("type", "button");
            button.setAttribute("data-panel-command", id);
            const label = labelCommand(id);
            button.setAttribute("aria-label", label);
            button.setAttribute("title", label);
            const drawing = icon(PANEL_ICONS[id] ?? null);
            if (typeof drawing === "string" && drawing !== "") {
                button.innerHTML = drawing;
            } else {
                button.textContent = label;
            }
            button.addEventListener("click", () => runCommand(id), { signal });
            host.appendChild(button);
            commands.set(id, button);
        }
        built.set(section, commands);
    }

    const place = () => {
        if (isCompact()) {
            // A phone's row is not placed: it is a child of the bottom bar
            // (`index.html`), and the bar's own box is where it belongs. The
            // desktop's numbers would put it in the corner of the screen.
            root.style.removeProperty("left");
            root.style.removeProperty("top");
            root.style.removeProperty("max-height");
            return;
        }
        const height = Number(view?.innerHeight);
        const width = Number(view?.innerWidth);
        if (!Number.isFinite(height) || height <= 0 || !Number.isFinite(width) || width <= 0) {
            return;
        }
        const box = panelPlacement({ viewportWidth: width, viewportHeight: height });
        root.style.setProperty("left", `${box.left}px`);
        root.style.setProperty("top", `${box.top}px`);
        root.style.setProperty("max-height", `${box.maxHeight}px`);
    };
    if (typeof view?.addEventListener === "function") {
        view.addEventListener("resize", place, { signal });
    }

    const selectedKinds = () => {
        let ids = [];
        try {
            ids = session.selectedIds();
        } catch {
            return { ids: [], kinds: [] };
        }
        const kinds = [];
        for (const id of ids) {
            try {
                kinds.push(session.kindOf(id));
            } catch {
                kinds.push(null);
            }
        }
        return { ids, kinds };
    };

    return {
        place,
        sync(styles) {
            const { ids, kinds } = selectedKinds();
            const selectionCount = ids.length;
            const tool = toolState.currentTool;
            if (!panelIsVisible({ tool, selectionCount, viewOnly: isViewOnly(), compact: isCompact() })) {
                root.hidden = true;
                return;
            }
            root.hidden = false;
            const visible = new Set(panelSections({ tool, kinds, styles, selectionCount }));
            for (const [id, node] of sections) {
                node.hidden = !visible.has(id);
            }
            // The two actions that belong to one kind of single selection are
            // hidden inside the Actions fieldset, the way `Actions.tsx` gates
            // them with `predicates.cropEditor` and `predicates.lineEditor`.
            const only = selectionCount === 1 ? kinds[0] : null;
            const crop = built.get("actions")?.get("cropArm");
            if (crop !== undefined) crop.hidden = only !== "image";
            // The line editor's row is the semantic verb's, not Enter's: it is
            // up for a lone line or a lone arrow the kernel does not bend, and
            // its rule is the double click's own, read without the pointer
            // (`vertex-edit.mjs`). A stale id that answers no kind is no
            // selection to edit: the row hides itself.
            const editor = built.get("actions")?.get("editLinearPoints");
            if (editor !== undefined) {
                let editable = false;
                if (selectionCount === 1) {
                    try {
                        editable = linearPointsEditable(session, ids[0]);
                    } catch {
                        editable = false;
                    }
                }
                editor.hidden = !editable;
            }
            // Grouping takes two; a single element has nothing to group or
            // ungroup, and upstream's action predicates hide both there.
            for (const id of ["group", "ungroup"]) {
                const button = built.get("actions")?.get(id);
                if (button !== undefined) button.hidden = selectionCount <= 1;
            }
            // Distribution needs a third member: with two there is no gap to
            // share out, so the two buttons sit this frame out.
            for (const id of ["distributeHorizontally", "distributeVertically"]) {
                const button = built.get("align")?.get(id);
                if (button !== undefined) button.hidden = selectionCount <= 2;
            }
            place();
        },
    };
}
