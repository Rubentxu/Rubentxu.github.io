/**
 * The layer that holds the picture the document already decided.
 *
 * A paint reads three kinds of thing. The document's own picture — the paper,
 * the grid, the holes cut for web embeds, the items the static section carries —
 * changes when that section changes. A selection-only delta composes a new frame
 * while retaining the same static-section identity. The gesture's furniture —
 * ghosts, guides, trails — changes on every paint of a drag without changing the
 * static payload. Painting both at once re-paints the picture sixty times a drag
 * to place furniture the picture does not hold. This layer splits them: the
 * picture goes onto an offscreen glass once per key, and each paint carries the
 * glass over with one `drawImage` before the furniture draws on top.
 *
 * ## The key
 *
 * The static section's identity is half of it — the same object means the same
 * picture, which is the frame cache's contract. The other half is everything
 * outside that payload that the picture answers to: the canvas's size and device
 * pixel ratio (a resize rescales the glass), the theme's filter (it painted
 * *into* the glass), the embeddable rows (their holes are cut into the paper),
 * and the image version (a decode makes a picture appear inside a static section
 * that did not move — without this the image stayed invisible behind a reused
 * glass).
 *
 * ## The bridges
 *
 * Three situations hand the caller the real canvas and step aside, and none of
 * them throws:
 *
 * 1. **A translucent paper** (PAINT-008) composes per element and cannot live
 *    on a glass that is copied afterwards — the copy composes a second time.
 * 2. **An eraser preview** fades elements that are still in the picture; the
 *    faded set is a fact about the gesture, not the frame.
 * 3. **A failure anywhere in the layer** — a canvas the page refuses to make,
 *    a context that comes back null, a blit that throws — stands the layer
 *    down and paints on the real glass instead. A cache that can fail its way
 *    into a blank canvas is a cache that must not exist.
 *
 * The caller keeps painting the same painters either way: `begin` answers with
 * the context to paint on and whether to paint it, and the static block's
 * literals — the ones the wiring guards read — run unchanged in both paths.
 */

/**
 * The static layer for one canvas.
 *
 * @param {{ createCanvas: (w: number, h: number) => object }} deps the page's
 *   canvas factory, injected so a test hands a fake and a hostile page cannot
 *   surprise the paint path with a global.
 */
export function createStaticLayer({ createCanvas }) {
    // The glass and its context, made on the first take that is allowed to use
    // one. A failure in either stands the layer down for the rest of the
    // session: the bridge below is cheap, and a layer that half-works is worse
    // than no layer.
    let glass = null;
    let glassCtx = null;
    let stoodDown = false;
    // The key the glass answers to, `null` when the glass is not on offer —
    // cold, bypassed, or stood down. The frame object is part of the key by
    // identity, the rest field by field.
    let held = null;
    let heldStaticSection = null;

    /**
     * The caller's own glass: paint there, repaint every time, blit nothing.
     *
     * A plain bypass keeps the key it held: the bypass painted on the real
     * glass and left the offscreen untouched, so the picture it holds is still
     * the picture its key names — an eraser gesture that ends should not cost
     * a repaint the layer can answer for. A stood-down layer holds nothing.
     */
    function bridge(realCtx, keepKey) {
        if (!keepKey) {
            held = null;
            heldStaticSection = null;
        }
        return { ctx: realCtx, repaint: true, offscreen: false };
    }

    return {
        /**
         * Decide where this paint's static content goes.
         *
         * @param staticSection the frame's section containing the picture; identity is the key.
         * @param {{
         *   w: number, h: number, dpr: number, theme: string,
         *   embeddables: object[]|null, imageVersion: number, bypass: boolean,
         * }} key the frame-external half of the key, and the bypass flag.
         * @param realCtx the canvas the page shows, for the bridges.
         * @returns {{ctx: object, repaint: boolean, offscreen: boolean}}
         */
        begin(staticSection, { w, h, dpr, theme, embeddables, imageVersion, bypass }, realCtx) {
            if (bypass) {
                return bridge(realCtx, true);
            }
            if (stoodDown) {
                return bridge(realCtx, false);
            }
            try {
                if (glass === null) {
                    glass = createCanvas(w * dpr, h * dpr);
                    glassCtx = glass.getContext("2d");
                    if (glassCtx === null) {
                        stoodDown = true;
                        return bridge(realCtx, false);
                    }
                }
                const key = { w, h, dpr, theme, embeddables, imageVersion };
                const same =
                    !stoodDown &&
                    heldStaticSection === staticSection &&
                    held !== null &&
                    held.w === w &&
                    held.h === h &&
                    held.dpr === dpr &&
                    held.theme === theme &&
                    held.embeddables === embeddables &&
                    held.imageVersion === imageVersion;
                if (same) {
                    return { ctx: glassCtx, repaint: false, offscreen: true };
                }
                if (glass.width !== w * dpr || glass.height !== h * dpr) {
                    glass.width = w * dpr;
                    glass.height = h * dpr;
                }
                // The dpr scale, so the painters' logical coordinates land where
                // they land on the real canvas: the glass is the same picture the
                // direct path would have painted, pixel for pixel.
                glassCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
                held = key;
                heldStaticSection = staticSection;
                return { ctx: glassCtx, repaint: true, offscreen: true };
            } catch {
                // A factory that throws, a context that refuses — the layer has
                // no answer and the paint must go on. The bridge is the answer.
                stoodDown = true;
                return bridge(realCtx, false);
            }
        },

        /**
         * Carry the glass onto the canvas the page shows, unfiltered.
         *
         * The glass already carries the theme's filter in its pixels; the blit
         * runs with the filter off or the page would filter twice in dark mode.
         * The caller sets the filter back for the furniture it draws after.
         *
         * @param realCtx the canvas the page shows.
         * @param {number} w logical width, for the blit's destination box.
         * @param {number} h logical height.
         * @returns {boolean} whether the glass landed; `false` stands the layer
         *   down, and the caller repaints the static block on the real canvas.
         */
        blit(realCtx, w, h) {
            if (glass === null || glassCtx === null) {
                return false;
            }
            try {
                realCtx.filter = "none";
                realCtx.drawImage(glass, 0, 0, w, h);
                return true;
            } catch {
                stoodDown = true;
                held = null;
                heldStaticSection = null;
                return false;
            }
        },
    };
}
