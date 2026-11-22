// The drawing preferences: the style a NEW element is born with.
//
// Upstream keeps this state beside the tool (`appState.currentItemStrokeColor` and
// friends, `actionProperties.tsx`): picking a colour with nothing selected writes the
// default, and arming another tool never touches it. The port had no such state — the
// pickers only ever wrote the selection, so with an empty selection a colour click
// crossed to a kernel that answered nothing, and the panel hid itself.
//
// The store is a plain object closed over by one factory call: O(1) reads and writes,
// no WASM crossing, no event bus, no storage. It lives **per app instance** because it
// is per-instance state: two editors on one page draw with different colours and must
// not know about each other. `create-app.mjs` mints one per mount and hands it to the
// binders; the gesture pipeline (S2/S3) reads `snapshot()` once per gesture.
//
// The seed values are the kernel's birth defaults, not the toolbar's first button:
// `DEFAULT_STROKE_COLOR`/`DEFAULT_BACKGROUND_COLOR`/`DEFAULT_OPACITY` (`element.rs`),
// `FillStyle::Solid`, `StrokeStyle::Solid`, `stroke_width::DEFAULT` ("medium"),
// `Roughness::default()` ("artist") and the adaptive radius ("round"). A preference the
// user has never touched has to name exactly what the kernel would give the element
// anyway, or the panel lies.

/** The style a creation carries before anyone has chosen anything. */
export const DEFAULT_STYLE_PREFERENCES = Object.freeze({
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    fill: "solid",
    stroke: "solid",
    lineWidth: "medium",
    roughness: "artist",
    edges: "round",
    opacity: 100,
    // The heads of a new arrow (TASK-297): the kernel's own birth answer,
    // `startArrowhead: null` (which it reads back as `"none"`) and
    // `endArrowhead: DEFAULT_END_ARROWHEAD` (`element.rs:1327`, `"arrow"`). The
    // arrow's *shape* — sharp, round, elbow — is not here on purpose: it lives
    // in the tool state (`toolState.arrowType`), which is the one truth the key
    // that reaches the arrow tool already walks and the press already reads.
    startArrowhead: "none",
    endArrowhead: "arrow",
    // The type a new text is born with (TASK-297): the kernel's `default_text_font_size`
    // is 20 (`element.rs:627-629`) and `DEFAULT_FONT_FAMILY` is index 5
    // (`font.rs:106-109`), whose published name is `"NextDraw Script"` — the name the
    // type panel's buttons carry, so the store speaks the frontier's words and
    // `birthTextFor` resolves it to the document's number. A text's ink is the
    // stroke colour above: upstream types a text in `currentItemStrokeColor`, and so
    // does the kernel.
    fontSize: 20,
    fontFamily: "NextDraw Script",
});

/**
 * Mint one instance's drawing preferences.
 *
 * `adopt(styles)` is the selection→default direction: a style the whole selection
 * shares becomes the new default, because upstream's pickers write both. `"mixed"` and
 * `null` are not values and never land in the store — a disagreement in the selection
 * does not adulterate a preference.
 *
 * @param {object} [seed] the starting values; defaults to the kernel's birth style.
 * @returns {{get: (key: string) => unknown, set: (key: string, value: unknown) => void,
 *   snapshot: () => object, adopt: (styles: object|null) => void}}
 */
export function createStylePreferences(seed = DEFAULT_STYLE_PREFERENCES) {
    const values = { ...seed };
    return {
        get(key) {
            return values[key];
        },
        set(key, value) {
            values[key] = value;
        },
        snapshot() {
            return { ...values };
        },
        adopt(styles) {
            if (styles === null || styles === undefined) {
                return;
            }
            for (const key of Object.keys(values)) {
                const value = styles[key];
                if (value === undefined || value === null || value === "mixed") {
                    continue;
                }
                values[key] = value;
            }
        },
    };
}
