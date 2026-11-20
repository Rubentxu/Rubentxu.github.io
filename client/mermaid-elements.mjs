// Mermaid skeletons to the literals the paste door reads.
//
// `mermaidToElements` answers skeletons: a label rides on its shape and an arrow names the
// ids it joins. The document spells both differently — a label is a text of its own whose
// `containerId` names the shape, and an arrow end is a binding — so this step is the
// translation and nothing else. It mints no identity that outlives the paste: the kernel
// replaces every id and remaps `containerId` and the bindings, so a diagram pasted twice is
// two diagrams.

import { MermaidError, mermaidToElements } from "./mermaid.mjs";
import { freshSeed } from "./tools.mjs";

/** The size a label draws at. */
const LABEL_FONT_SIZE = 16;
/** The air between an arrow end and the outline it is bound to. */
const BINDING_GAP = 1;

function stamped(element) {
    return { version: 1, seed: freshSeed(), angle: 0, ...element };
}

function bindingTo(id) {
    return { elementId: id, focus: 0, gap: BINDING_GAP };
}

/** The text bound to `container`, centred on the box it is given. */
function labelOf(container, text, box) {
    return stamped({
        id: `${container}__label`,
        type: "text",
        x: box.x,
        y: box.y,
        width: box.width,
        height: LABEL_FONT_SIZE * 1.25,
        fontSize: LABEL_FONT_SIZE,
        textAlign: "center",
        verticalAlign: "middle",
        containerId: container,
        text,
    });
}

/**
 * Resolve skeletons into literals.
 *
 * @param {object[]} skeletons what `mermaidToElements` answers.
 * @returns {object[]} shapes, arrows and the texts bound to them.
 */
export function skeletonsToLiterals(skeletons) {
    const out = [];
    for (const skeleton of skeletons) {
        const { label, start, end, ...own } = skeleton;
        if (own.type === "arrow") {
            const xs = own.points.map(([x]) => x);
            const ys = own.points.map(([, y]) => y);
            out.push(
                stamped({
                    ...own,
                    width: Math.max(...xs) - Math.min(...xs),
                    height: Math.max(...ys) - Math.min(...ys),
                    startArrowhead: null,
                    startBinding: bindingTo(start.id),
                    endBinding: bindingTo(end.id),
                }),
            );
            if (label) {
                const mid = own.points[Math.floor(own.points.length / 2)];
                out.push(
                    labelOf(own.id, label.text, {
                        x: own.x + mid[0] - 40,
                        y: own.y + mid[1] - LABEL_FONT_SIZE,
                        width: 80,
                    }),
                );
            }
            continue;
        }
        out.push(stamped(own));
        if (label) out.push(labelOf(own.id, label.text, own));
    }
    return out;
}

/**
 * A Mermaid flowchart as the literals a paste puts on the canvas.
 *
 * @param {string} source the Mermaid text.
 * @returns {object[]} the literals.
 * @throws {import("./mermaid.mjs").MermaidError} outside the supported subset.
 */
export function mermaidLiterals(source) {
    return skeletonsToLiterals(mermaidToElements(source));
}

/**
 * The paste door's question: is this text a diagram this build draws?
 *
 * A text that is no diagram at all is not a failure — it is an ordinary paste — so it
 * answers `null`. A diagram outside the subset answers the refusal, so the caller can say
 * why it fell back to pasting the text.
 *
 * @param {string} text what the clipboard carries.
 * @returns {{elements: object[]} | {refusal: MermaidError} | null}
 */
export function tryMermaidLiterals(text) {
    try {
        return { elements: mermaidLiterals(text) };
    } catch (error) {
        if (!(error instanceof MermaidError)) throw error;
        return error.code === "not-a-diagram" ? null : { refusal: error };
    }
}
