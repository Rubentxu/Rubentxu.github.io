// The drawing as text: a description a person (or a tool) can read and share.
//
// It is built from the semantic snapshot, not from `toJson`: the same model the
// explorer and the descriptions already use, so the export cannot disagree
// with what a reader hears. No image bytes, no embedded URLs, no HTML: every
// author label is untrusted text and is escaped before it enters the document.
// The existing `.excalidraw`, SVG and PNG exports are untouched (TASK-188).

import { describeElement, describeScene } from "./semantic-description.mjs";

/** The longest author text the export repeats, before escaping. */
export const EXPORT_LABEL_LIMIT = 200;

/** Escape the characters that would change the Markdown's structure. */
export function escapeMarkdown(value) {
    return String(value)
        .replace(/\r?\n/g, " ")
        .replace(/([\\`*_{}[\]()#+.!|<>-])/g, "\\$1");
}

/** Plain text keeps the words and drops the control characters. */
export function escapePlain(value) {
    return String(value).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\r?\n/g, " ");
}

/**
 * Export the scene (or a selection) as text.
 *
 * @param {{version: number, elements: object[]}} snapshot contract v1, parsed.
 * @param {{format?: "markdown"|"text", selection?: string[]|null,
 *          say?: (key: string, fallback: string) => string}} [options]
 * @returns {string}
 */
export function exportText(snapshot, { format = "markdown", selection = null, say = (_key, fallback) => fallback } = {}) {
    if (snapshot === null
        || typeof snapshot !== "object"
        || snapshot.version !== 1
        || !Array.isArray(snapshot.elements)) {
        throw new Error("semantic_export_invalid: the snapshot is not contract version 1");
    }
    const markdown = format === "markdown";
    const escape = markdown ? escapeMarkdown : escapePlain;
    const clip = (value) => (value.length <= EXPORT_LABEL_LIMIT ? value : `${value.slice(0, EXPORT_LABEL_LIMIT - 1)}…`);
    const elements = selection === null
        ? snapshot.elements
        : snapshot.elements.filter((element) => selection.includes(element.id));
    // The summary speaks about what the document exports, not the whole scene
    // when the author asked for a selection.
    const scoped = { version: snapshot.version, elements };
    const lines = [];
    lines.push(`# ${say("ui.export.title", "Descripción del dibujo")}`);
    lines.push("");
    lines.push(escape(describeScene(scoped, { level: "normal", say })));
    lines.push("");
    // A bound text is named by its container; listing the text row again would
    // read the same words twice.
    const boundTexts = new Set(elements.map((element) => element.bindings?.boundText).filter(Boolean));
    for (const element of elements.filter((candidate) => !boundTexts.has(candidate.id))) {
        const kind = say(`ui.kind.${element.kind}`, element.kind);
        const label = element.label?.text !== null && element.label?.text !== undefined && element.label.text.trim() !== ""
            ? escape(clip(element.label.text.trim()))
            : say("ui.describe.untitled", "sin nombre");
        const facts = [];
        if (element.locked === true) {
            facts.push(say("ui.describe.locked", "bloqueado"));
        }
        if (element.frame !== null && element.frame !== undefined) {
            facts.push(`${say("ui.describe.inside", "dentro de")} ${escape(element.frame)}`);
        }
        if (Array.isArray(element.groups) && element.groups.length > 0) {
            facts.push(`${say("ui.describe.group", "grupo")} ${element.groups.map(escape).join(", ")}`);
        }
        if (element.directed === true) {
            const start = element.bindings?.start ?? null;
            const end = element.bindings?.end ?? null;
            if (start === null || end === null) {
                facts.push(say("ui.describe.free-arrow", "flecha con un extremo libre"));
            } else {
                facts.push(`${say("ui.describe.connects", "conecta")} ${escape(start)} → ${escape(end)}`);
            }
        }
        if (element.kind?.startsWith?.("unknown") || (element.kind !== undefined && !["rectangle", "diamond", "ellipse", "line", "arrow", "image", "text", "frame", "magicframe", "embeddable", "stickynote", "freedraw"].includes(element.kind))) {
            facts.push(`${say("ui.export.unknown", "tipo no reconocido")}: ${escape(element.kind)}`);
        }
        const heading = markdown ? `- **${label}** (${kind})` : `- ${label} (${kind})`;
        lines.push(facts.length === 0 ? heading : `${heading} — ${facts.join("; ")}`);
    }
    return `${lines.join("\n")}\n`;
}
