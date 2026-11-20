// The statistics panel: what the document holds, counted, and nothing more.
//
// # What this file is
//
// `Alt+/` opens a small panel that says what the drawing holds: how many
// elements of each kind, and the kernel's own revision of the document.
// Upstream's panel (`components/Stats/`) is richer — it shows a chosen
// element's dimensions and position, and the panels are draggable inputs —
// and this one is the document-level half of it, which is the half that
// answers "what is in this drawing".
//
// # The one rule about the numbers
//
// Every render derives its answer from **one** `toJson` crossing. There is no
// cache, no dirty flag, and no per-element question: the document is asked
// once, parsed once, and counted once, and the panel shows what that answer
// said. A panel that cached its counts would be a second truth about the
// document — the same shape as a cached frame, with the difference that
// nothing here decides when the document changed, so nothing here could know
// when to let a cache go. Asking is one walk the kernel already does for the
// save, and the panel is opened a handful of times a minute.
//
// The unmodelled carriers are counted with everything else: a document this
// build does not fully model still *holds* its elements, and the panel says
// what the document holds — by the type the document itself names — rather
// than what this build can draw.

// The panel does not import the catalogs: the application root hands it a `text` function, and
// with none the words are the English written below.
const keepSource = (_key, source) => source;

/**
 * Count a document's elements by kind.
 *
 * The document is the `.excalidraw` envelope the kernel writes (`toJson`), and
 * the elements are read off its `elements` key. A document without the key —
 * which no file the kernel writes can be, but a caller may hand over anything —
 * counts as holding nothing, because "the caller lied" is not a fact the panel
 * can display and an empty panel is the honest answer to an unreadable claim.
 *
 * @param {string} text The document, as the kernel wrote it.
 * @returns {{ total: number, byType: Record<string, number> }} The count.
 */
export function statsFromJson(text) {
    let file = null;
    try {
        file = JSON.parse(text);
    } catch {
        // A document that is not JSON holds nothing countable. The panel shows
        // an empty answer rather than a half-parsed one: the caller hands the
        // kernel's own `toJson` in production, so reaching here is a defect
        // elsewhere, and the next render says what the next answer says.
        return { total: 0, byType: {} };
    }
    return statsFromDocument(file);
}

function statsFromDocument(file) {
    const elements = Array.isArray(file?.elements) ? file.elements : [];
    const byType = {};
    let total = 0;
    for (const element of elements) {
        const type = typeof element?.type === "string" ? element.type : "unknown";
        byType[type] = (byType[type] ?? 0) + 1;
        total += 1;
    }
    return { total, byType };
}

/**
 * The panel's rows, from a count.
 *
 * One row per kind the document holds, busiest first and alphabetical among
 * equals, plus the total first. The order is derived rather than stored: a
 * row list written beside a count would fall out of step with it on the
 * first document that counted differently, and the panel is the one place
 * the reader looks, so the reading order is a fact about the numbers.
 *
 * @param {{ total: number, byType: Record<string, number> }} stats The count.
 * @returns {Array<{ label: string, value: number }>} The rows, in panel order.
 */
export function statsRows(stats, text = (_key, source) => source) {
    const kinds = Object.keys(stats.byType).sort((a, b) => {
        const difference = stats.byType[b] - stats.byType[a];
        return difference !== 0 ? difference : (a < b ? -1 : a > b ? 1 : 0);
    });
    return [{ label: text("stats.total", "Elements"), value: stats.total }].concat(
        kinds.map((kind) => ({ label: kind, value: stats.byType[kind] })),
    );
}

/**
 * Build the panel and its door.
 *
 * The panel is built, not fetched: the dialogs the markup carries
 * (`#chart-dialog`, `#link-dialog`) hold forms worth spelling in HTML, and
 * this panel is two rows and a close button — markup for its own sake would
 * be a second place a row could be spelled. It is appended to `host` on
 * `show` and removed on `close`, so a closed panel is out of the page
 * entirely rather than hidden in it.
 *
 * The `source` is the panel's one question about the world: "what does the
 * document say right now?". It is asked once per refresh and never kept —
 * see the rule at the top of the file.
 *
 * @param {object} deps
 * @param {(tag: string) => Element} deps.createElement The browser's builder.
 * @param {Element} deps.host The element the panel mounts in.
 * @param {() => { json: string, revision: number }} deps.source The document, once per render.
 * @param {(key: string, source: string) => string} [deps.text] The words the panel writes, by
 *   key; the English here is the source and the default. The kinds of element are the
 *   document's own type names and are shown as it names them.
 * @param {AbortSignal} [deps.signal] When it aborts the panel closes and its button stops listening.
 * @returns {object} The door: `toggle`, `refresh`, `close`, `isOpen`.
 */
export function openStatsPanel({
    createElement,
    host,
    source,
    text = keepSource,
    selection = () => [],
    onResize = () => {},
    onRotate = () => {},
    onFontSize = () => {},
    signal,
}) {
    const title = text("stats.title", "Statistics");
    const panel = createElement("div");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", title);
    panel.setAttribute("data-stats-panel", "true");
    // The panel floats over the drawing's corner: the drawing stays visible
    // behind it, which is the point — the panel is about what is on screen.
    panel.style.position = "fixed";
    panel.style.right = "12px";
    panel.style.bottom = "34px";
    panel.style.background = "var(--panel-bg, #ffffff)";
    panel.style.color = "var(--panel-fg, #1e1e1e)";
    panel.style.border = "1px solid var(--panel-border, #e0e0e0)";
    panel.style.borderRadius = "8px";
    panel.style.padding = "10px 14px";
    panel.style.font = "13px Helvetica, sans-serif";
    panel.style.boxShadow = "0 4px 16px rgba(0, 0, 0, 0.12)";
    panel.style.zIndex = "30";

    const heading = createElement("div");
    heading.textContent = title;
    heading.style.fontWeight = "bold";
    heading.style.marginBottom = "6px";
    heading.style.cursor = "grab";
    heading.style.touchAction = "none";
    heading.style.userSelect = "none";
    panel.appendChild(heading);

    let drag = null;
    heading.addEventListener("pointerdown", (event) => {
        if (event.button !== undefined && event.button !== 0) {
            return;
        }
        const bounds = panel.getBoundingClientRect?.();
        const left = Number.isFinite(bounds?.left)
            ? bounds.left
            : (Number.parseFloat(panel.style.left) || 0);
        const top = Number.isFinite(bounds?.top)
            ? bounds.top
            : (Number.parseFloat(panel.style.top) || 0);
        drag = {
            pointerId: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            left,
            top,
        };
        panel.style.left = `${left}px`;
        panel.style.top = `${top}px`;
        panel.style.right = "auto";
        panel.style.bottom = "auto";
        heading.style.cursor = "grabbing";
        heading.setPointerCapture?.(event.pointerId);
        event.preventDefault?.();
    }, signal ? { signal } : undefined);
    heading.addEventListener("pointermove", (event) => {
        if (drag === null || event.pointerId !== drag.pointerId) {
            return;
        }
        panel.style.left = `${drag.left + event.clientX - drag.x}px`;
        panel.style.top = `${drag.top + event.clientY - drag.y}px`;
    }, signal ? { signal } : undefined);
    const finishDrag = (event) => {
        if (drag === null || event.pointerId !== drag.pointerId) {
            return;
        }
        drag = null;
        heading.style.cursor = "grab";
        heading.releasePointerCapture?.(event.pointerId);
    };
    heading.addEventListener("pointerup", finishDrag, signal ? { signal } : undefined);
    heading.addEventListener("pointercancel", finishDrag, signal ? { signal } : undefined);

    const rows = createElement("div");
    rows.setAttribute("data-stats-rows", "true");
    panel.appendChild(rows);

    const geometry = createElement("div");
    geometry.setAttribute("data-selected-geometry", "true");
    panel.appendChild(geometry);

    const revision = createElement("div");
    revision.setAttribute("data-stats-revision", "true");
    revision.style.marginTop = "6px";
    revision.style.opacity = "0.7";
    panel.appendChild(revision);

    const closeButton = createElement("button");
    closeButton.type = "button";
    closeButton.textContent = text("stats.close", "Close");
    closeButton.setAttribute("data-stats-close", "true");
    closeButton.style.marginTop = "8px";
    panel.appendChild(closeButton);

    let open = false;

    closeButton.addEventListener("click", () => close(), { signal });

    function refresh() {
        // One crossing per render, and the numbers and selected geometry both
        // come off that answer rather than a client-side cache.
        const answer = source();
        let file = null;
        try {
            file = JSON.parse(answer.json);
        } catch {
            // statsFromDocument gives the same empty answer as statsFromJson.
        }
        const stats = statsFromDocument(file);
        rows.replaceChildren(
            ...statsRows(stats, text).map((row, index) => {
                const line = createElement("div");
                // The attribute is the stable name of the row (the total, or
                // the document's kind); the label is the locale's word and a
                // selector built from it would break on the first translation.
                line.setAttribute("data-stat-kind", index === 0 ? "total" : row.label);
                line.textContent = `${row.label}: ${row.value}`;
                return line;
            }),
        );

        const ids = [...(selection() ?? [])];
        const selected = ids.length === 1 && Array.isArray(file?.elements)
            ? file.elements.find((element) => element?.id === ids[0])
            : undefined;
        geometry.replaceChildren();
        geometry.hidden = selected === undefined;
        if (selected !== undefined) {
            const heading = createElement("div");
            heading.textContent = text("stats.selectedElement", "Selected element");
            geometry.appendChild(heading);
            const values = {
                x: selected.x,
                y: selected.y,
                width: selected.width,
                height: selected.height,
                angle: selected.angle ?? 0,
                ...(typeof selected.fontSize === "number" ? { fontSize: selected.fontSize } : {}),
            };
            for (const [field, value] of Object.entries(values)) {
                const label = createElement("label");
                label.textContent = text(`stats.geometry.${field}`, field);
                const input = createElement("input");
                input.type = "number";
                input.value = String(value);
                input.setAttribute("data-geometry-field", field);
                input.addEventListener("change", () => {
                    const next = Number(input.value);
                    if (!Number.isFinite(next)) {
                        input.value = String(value);
                        return;
                    }
                    if (field === "angle") {
                        onRotate(selected.id, next - values.angle);
                    } else if (field === "fontSize") {
                        onFontSize(selected.id, next);
                    } else {
                        onResize(selected.id, {
                            x: field === "x" ? next : values.x,
                            y: field === "y" ? next : values.y,
                            width: field === "width" ? next : values.width,
                            height: field === "height" ? next : values.height,
                        });
                    }
                }, signal ? { signal } : undefined);
                label.appendChild(input);
                geometry.appendChild(label);
            }
        }
        revision.textContent = `${text("stats.revision", "Revision")} ${answer.revision}`;
    }

    function show() {
        if (open) {
            return;
        }
        open = true;
        refresh();
        host.appendChild(panel);
    }

    function close() {
        if (!open) {
            return;
        }
        open = false;
        panel.remove();
    }
    signal?.addEventListener("abort", close, { once: true });

    return {
        toggle() {
            if (open) {
                close();
            } else {
                show();
            }
            return open;
        },
        refresh,
        close,
        isOpen: () => open,
    };
}
