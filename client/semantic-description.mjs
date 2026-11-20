// Deterministic descriptions of a semantic scene, at three levels.
//
// The words come from the page's catalogue; the facts come from the snapshot
// and nowhere else. An arrow without a binding is not described as a
// connection, an image without author alt text is not given one, and a label
// keeps its provenance visible. Every string is built for `textContent`: a
// label that looks like markup is a label, not markup (TASK-184).

/** The longest author text a description repeats. */
export const LABEL_LIMIT = 80;
/** The longest description a live region receives. */
export const DESCRIPTION_LIMIT = 400;

const clip = (text, limit) => (text.length <= limit ? text : `${text.slice(0, limit - 1)}…`);

/** The counts of a scene, in the contract's order, for the summary sentence. */
export function summarizeScene(snapshot) {
    const elements = Array.isArray(snapshot?.elements) ? snapshot.elements : [];
    const counts = new Map();
    let labelled = 0;
    let locked = 0;
    let connected = 0;
    let freeArrows = 0;
    for (const element of elements) {
        counts.set(element.kind, (counts.get(element.kind) ?? 0) + 1);
        if (typeof element.label?.text === "string" && element.label.text.trim() !== "") {
            labelled += 1;
        }
        if (element.locked === true) {
            locked += 1;
        }
        if (element.directed === true) {
            if (element.bindings?.start !== null && element.bindings?.start !== undefined
                && element.bindings?.end !== null && element.bindings?.end !== undefined) {
                connected += 1;
            } else {
                freeArrows += 1;
            }
        }
    }
    return {
        total: elements.length,
        labelled,
        unlabelled: elements.length - labelled,
        locked,
        connected,
        freeArrows,
        byKind: [...counts.entries()].map(([kind, count]) => ({ kind, count })),
    };
}

/**
 * Describe `element` at `level` ("brief" | "normal" | "detailed").
 *
 * @param {object} element one contract-v1 element.
 * @param {{level?: "brief"|"normal"|"detailed", say: (key: string, fallback: string) => string}} options
 * @returns {string}
 */
export function describeElement(element, { level = "normal", say }) {
    const text = (key, fallback) => say(key, fallback);
    const kind = text(`ui.kind.${element.kind}`, element.kind);
    const hasLabel = typeof element.label?.text === "string" && element.label.text.trim() !== "";
    const label = hasLabel ? clip(element.label.text.trim(), LABEL_LIMIT) : text("ui.describe.untitled", "sin nombre");
    if (level === "brief") {
        return clip(`${kind}: ${label}`, DESCRIPTION_LIMIT);
    }
    const parts = [];
    parts.push(`${kind} «${label}»`);
    if (level === "detailed" && hasLabel) {
        parts.push(text(
            `ui.describe.source.${element.label.source}`,
            element.label.source === "text" ? "texto del autor"
                : element.label.source === "bound-text" ? "texto enlazado"
                    : element.label.source === "name" ? "nombre del autor"
                        : element.label.source === "alt" ? "texto alternativo del autor"
                            : "sin texto de autor",
        ));
    }
    if (element.locked === true) {
        parts.push(text("ui.describe.locked", "bloqueado"));
    }
    const frame = element.frame ?? null;
    if (frame !== null) {
        parts.push(`${text("ui.describe.inside", "dentro de")} ${frame}`);
    }
    if (Array.isArray(element.groups) && element.groups.length > 0) {
        parts.push(`${text("ui.describe.group", "grupo")} ${element.groups.join(", ")}`);
    }
    const outgoing = Array.isArray(element.bindings?.attached) ? element.bindings.attached.length : 0;
    const start = element.bindings?.start ?? null;
    const end = element.bindings?.end ?? null;
    if (level !== "brief" && element.directed === true) {
        if (start === null || end === null) {
            parts.push(text("ui.describe.free-arrow", "flecha con un extremo libre"));
        } else {
            parts.push(`${text("ui.describe.connects", "conecta")} ${start} → ${end}`);
        }
    }
    if (level !== "brief" && outgoing > 0) {
        parts.push(`${text("ui.describe.attached", "con flechas")}: ${outgoing}`);
    }
    if (level === "detailed") {
        const { x, y, width, height } = element.bounds ?? {};
        parts.push(`${text("ui.describe.at", "en")} (${Math.round(x)}, ${Math.round(y)}) ${Math.round(width)}×${Math.round(height)}`);
    }
    return clip(parts.join("; "), DESCRIPTION_LIMIT);
}

/**
 * The extra facts about an element, without repeating its name.
 *
 * The tree item already announces the kind and the label; a focus move that
 * repeated them would be the same name heard twice. This returns only what the
 * item cannot say — locked, its frame, its groups, an arrow's free end, the
 * arrows attached — and an empty string when there is nothing to add.
 *
 * @param {object} element one contract-v1 element.
 * @param {{say: (key: string, fallback: string) => string}} options
 * @returns {string}
 */
export function describeExtras(element, { say }) {
    const text = (key, fallback) => say(key, fallback);
    const parts = [];
    if (element.locked === true) {
        parts.push(text("ui.describe.locked", "bloqueado"));
    }
    if (element.frame !== null && element.frame !== undefined) {
        parts.push(`${text("ui.describe.inside", "dentro de")} ${element.frame}`);
    }
    if (Array.isArray(element.groups) && element.groups.length > 0) {
        parts.push(`${text("ui.describe.group", "grupo")} ${element.groups.join(", ")}`);
    }
    if (element.directed === true && ((element.bindings?.start ?? null) === null || (element.bindings?.end ?? null) === null)) {
        parts.push(text("ui.describe.free-arrow", "flecha con un extremo libre"));
    }
    const attached = Array.isArray(element.bindings?.attached) ? element.bindings.attached.length : 0;
    if (attached > 0) {
        parts.push(`${text("ui.describe.attached", "con flechas")}: ${attached}`);
    }
    return clip(parts.join("; "), DESCRIPTION_LIMIT);
}

/**
 * Describe the scene at `level`.
 *
 * @param {{version: number, elements: object[]}} snapshot
 * @param {{level?: "brief"|"normal"|"detailed", say: (key: string, fallback: string) => string}} options
 * @returns {string}
 */
export function describeScene(snapshot, { level = "normal", say } = { say: (_key, fallback) => fallback }) {
    const text = (key, fallback) => say(key, fallback);
    const summary = summarizeScene(snapshot);
    if (summary.total === 0) {
        return text("ui.describe.empty-scene", "El dibujo no tiene elementos");
    }
    const pieces = [text("ui.describe.scene", "El dibujo tiene") + ` ${summary.total} ` + text("ui.describe.elements", "elementos")];
    if (level !== "brief") {
        pieces.push(summary.byKind
            .map(({ kind, count }) => `${count} ${text(`ui.kind.${kind}`, kind)}`)
            .join(", "));
    }
    if (summary.connected > 0) {
        pieces.push(`${text("ui.describe.connected", "conexiones")}: ${summary.connected}`);
    }
    if (summary.freeArrows > 0) {
        pieces.push(`${text("ui.describe.free-arrows", "flechas con extremo libre")}: ${summary.freeArrows}`);
    }
    if (summary.locked > 0) {
        pieces.push(`${text("ui.describe.locked-count", "bloqueados")}: ${summary.locked}`);
    }
    return clip(pieces.join("; "), DESCRIPTION_LIMIT);
}
