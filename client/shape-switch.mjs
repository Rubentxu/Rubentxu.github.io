// The conversion switch: Tab turns the selected shapes into the next shape of
// their family, Shift+Tab into the previous one.
//
// Upstream's flow (`App.tsx`, the keydown's "Shape switching" block): the first
// Tab only opens the panel, every Tab while it is open steps the selection, and
// the panel shuts on Escape, on a press on the canvas, when a drawing tool is
// armed (which drops the selection) and when the selection stops holding
// something it can convert. A view-only page shuts it too, since its buttons
// edit.
//
// The panel offers two rows, as upstream's `ConvertElementTypePopup` does: the
// generic shapes (rectangle, diamond, ellipse) and the linear variants (line,
// sharp arrow, curved arrow, elbow arrow). Which row is up is the kernel's
// answer (`shapeSwitchState`) and the generic row wins whenever the selection
// holds a generic shape, even beside lines — upstream's
// `getConversionTypeFromElements`. The order and the conversion are the
// kernel's too (`cycleSelectedShape`, `switchSelectedShape`); this module holds
// whether the panel is up and draws the row it names.

import { CHROME_ICONS } from "./chrome-icons.mjs";
import { iconButton } from "./chrome.mjs";

/** The generic shapes the panel offers, in upstream's order. */
export const SWITCHABLE_SHAPES = Object.freeze(["rectangle", "diamond", "ellipse"]);

/** The linear variants the panel offers, in upstream's order. */
export const SWITCHABLE_LINEARS = Object.freeze([
    "line",
    "sharpArrow",
    "curvedArrow",
    "elbowArrow",
]);

/** The two rows, by the family word the kernel's state starts with. */
const FAMILIES = Object.freeze({
    generic: SWITCHABLE_SHAPES,
    linear: SWITCHABLE_LINEARS,
});

const SHAPE_ICONS = Object.freeze({
    rectangle: "RectangleIcon",
    diamond: "DiamondIcon",
    ellipse: "EllipseIcon",
    line: "LineIcon",
    sharpArrow: "sharpArrowIcon",
    curvedArrow: "roundArrowIcon",
    elbowArrow: "elbowArrowIcon",
});

/**
 * Read the kernel's `shapeSwitchState` answer.
 *
 * The wire word is `family:kind` — `generic:rectangle`, `linear:mixed`, and so
 * on — because a mix has to say which row of buttons it shows with none
 * pressed. Anything the family table does not name is nothing to draw.
 *
 * @returns {{ family: string, kind: string } | null}
 */
export function switchStateOf(raw) {
    if (typeof raw !== "string") return null;
    const at = raw.indexOf(":");
    if (at < 0) return null;
    const family = raw.slice(0, at);
    const kind = raw.slice(at + 1);
    if (!Object.hasOwn(FAMILIES, family) || kind === "") return null;
    return { family, kind };
}

/**
 * Upstream's gaps between the selection's corner and the panel
 * (`ConvertElementTypePopup.tsx`): 8 px to the left, and 10 + 8 scene units
 * below, which is why the vertical one follows the zoom.
 */
export const PANEL_GAP_LEFT_PX = 8;
export const PANEL_GAP_BELOW = 18;

/**
 * Whether the panel is up, and the Tab that opens or steps it.
 *
 * It holds no session and no DOM: the runner hands it the session a key
 * arrived for, and the panel reads `isOpen()` when it draws.
 *
 * @returns {{ isOpen: () => boolean, close: () => void,
 *            press: (session: object, backward: boolean) => string | null }}
 */
export function createShapeSwitch() {
    let open = false;
    return {
        isOpen: () => open,
        close() {
            open = false;
        },
        /**
         * One Tab. With the panel up the selection steps one shape; then the
         * panel is up exactly when the selection holds a shape it can switch.
         *
         * @returns {string | null} the shape the selection became, or `null`
         *   when the press only opened the panel or found nothing to switch.
         */
        press(session, backward) {
            if (!open) {
                // The kernel seeds the panel's per-subtype snapshots here, which is
                // upstream's "cache while the popup is mounted" lifetime. A session
                // that does not know the call (an older artifact) still opens.
                session.beginShapeSwitch?.();
                open = session.shapeSwitchState() !== undefined;
                return null;
            }
            const became = session.cycleSelectedShape(backward) ?? null;
            open = session.shapeSwitchState() !== undefined;
            return became;
        },
    };
}

/**
 * Draw the panel beside the selection while the switch is up.
 *
 * The panel is a row of toggles at the selection's bottom-left corner — three
 * for the generic family, four for the linear one; the one that names the kind
 * every selected member shares is pressed, and none is for a mix. A click
 * converts to that kind and gives the focus to the panel, so the next Tab is
 * still the switch's (upstream focuses its panel the same way).
 *
 * @param {object} options
 * @param {object} options.shapeSwitch What `createShapeSwitch` returned.
 * @param {Document} options.document
 * @param {Element} options.parent Where the panel is mounted.
 * @param {Element} options.canvas A press on it shuts the panel.
 * @param {{ get: () => { left: number, top: number } }} options.canvasRect
 * @param {(session: object, ctx: object) => void} options.paint
 * @param {(message: string) => void} options.onProblem
 * @param {(key: string, source: string) => string} [options.text]
 * @param {() => boolean} [options.editable] Whether the page may edit now. A
 *   view-only page shuts the panel on its next frame, and a press on a button
 *   still on the screen until then converts nothing.
 * @param {AbortSignal} [options.signal]
 * @returns {{ sync: (session: object, ctx: object) => void, host: Element }}
 */
export function bindShapeSwitchPanel({
    shapeSwitch,
    document,
    parent,
    canvas,
    canvasRect,
    paint,
    onProblem,
    text = (_key, source) => source,
    editable = () => true,
    signal,
}) {
    const host = document.createElement("div");
    host.classList.add("ConvertElementTypePopup");
    host.setAttribute("role", "group");
    host.setAttribute("aria-label", text("ui.shape-switch.label", "Shape type"));
    host.setAttribute("tabindex", "-1");
    host.hidden = true;
    parent.appendChild(host);
    signal?.addEventListener("abort", () => host.remove(), { once: true });

    let drawn = null;
    let placedFor = null;
    let current = null;

    function hide() {
        if (drawn === null && host.hidden) return;
        drawn = null;
        placedFor = null;
        host.replaceChildren();
        host.hidden = true;
    }

    canvas.addEventListener("pointerdown", () => {
        shapeSwitch.close();
        hide();
    }, { signal });

    function draw(state) {
        const parsed = switchStateOf(state);
        if (parsed === null) return;
        if (drawn === state) return;
        host.replaceChildren();
        for (const shape of FAMILIES[parsed.family]) {
            const checked = parsed.kind === shape;
            const button = iconButton(document, {
                icon: CHROME_ICONS[SHAPE_ICONS[shape]],
                label: shape,
                type: "toggle",
                checked,
                attributes: { title: shape, "data-testid": `toolbar-${shape}`, "data-shape": shape },
            });
            button.addEventListener("click", () => {
                // Pressing the shape the selection already is changes nothing, and
                // neither does a press on a page that has turned view-only.
                if (checked || current === null || !editable()) return;
                const { session, ctx } = current;
                try {
                    session.switchSelectedShape(shape);
                } catch (error) {
                    onProblem(`switchSelectedShape failed: ${error.message ?? error}`);
                    return;
                }
                host.focus();
                paint(session, ctx);
            }, { signal });
            host.appendChild(button);
        }
        drawn = state;
    }

    function place(session) {
        const anchor = session.shapeSwitchAnchor();
        if (anchor === undefined) return;
        const rect = canvasRect.get();
        const zoom = session.zoom();
        // Upstream places the panel again only when the view or the selection
        // changes, not when the shapes move under it.
        const origin = session.sceneToScreen(0, 0);
        const key = `${zoom}|${origin[0]},${origin[1]}|${rect.left},${rect.top}|${session.selectedIds().join(",")}`;
        if (key === placedFor) return;
        placedFor = key;
        host.style.left = `${rect.left + anchor[0] - PANEL_GAP_LEFT_PX}px`;
        host.style.top = `${rect.top + anchor[1] + PANEL_GAP_BELOW * zoom}px`;
    }

    return {
        host,
        /** Called once per painted frame with the session it painted. */
        sync(session, ctx) {
            current = { session, ctx };
            if (!shapeSwitch.isOpen()) {
                hide();
                return;
            }
            const state = session.shapeSwitchState();
            if (state === undefined || !editable()) {
                shapeSwitch.close();
                hide();
                return;
            }
            draw(state);
            place(session);
            host.hidden = false;
        },
    };
}
