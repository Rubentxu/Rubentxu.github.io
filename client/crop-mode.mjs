const HANDLE_NAMES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const HANDLE_RADIUS = 9;

/** Start an editable crop preview over the currently displayed image bounds. */
export function start(id) {
    return { id, region: { left: 0, top: 0, right: 1, bottom: 1 } };
}

function screenRect(box, region) {
    const width = box.right - box.left;
    const height = box.bottom - box.top;
    return {
        left: box.left + region.left * width,
        top: box.top + region.top * height,
        right: box.left + region.right * width,
        bottom: box.top + region.bottom * height,
    };
}

function handles(rect) {
    const cx = (rect.left + rect.right) / 2;
    const cy = (rect.top + rect.bottom) / 2;
    return {
        nw: { x: rect.left, y: rect.top },
        n: { x: cx, y: rect.top },
        ne: { x: rect.right, y: rect.top },
        e: { x: rect.right, y: cy },
        se: { x: rect.right, y: rect.bottom },
        s: { x: cx, y: rect.bottom },
        sw: { x: rect.left, y: rect.bottom },
        w: { x: rect.left, y: cy },
    };
}

function normalized(box, point) {
    return {
        x: Math.min(1, Math.max(0, (point.x - box.left) / (box.right - box.left))),
        y: Math.min(1, Math.max(0, (point.y - box.top) / (box.bottom - box.top))),
    };
}

/** Choose whether a press moves the crop, resizes a handle, or starts a new region. */
export function begin(mode, box, point) {
    const rect = screenRect(box, mode.region);
    const points = handles(rect);
    const handle = HANDLE_NAMES.find((name) => {
        const at = points[name];
        return Math.hypot(point.x - at.x, point.y - at.y) <= HANDLE_RADIUS;
    });
    const at = normalized(box, point);
    if (handle !== undefined) {
        return { mode, box, start: at, region: mode.region, kind: "resize", handle };
    }
    if (point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom) {
        return { mode, box, start: at, region: mode.region, kind: "move" };
    }
    return { mode, box, start: at, region: { left: at.x, top: at.y, right: at.x, bottom: at.y }, kind: "new" };
}

/** Update the persistent region as the pointer moves, without writing to the document. */
export function move(interaction, box, point) {
    const at = normalized(box, point);
    const dx = at.x - interaction.start.x;
    const dy = at.y - interaction.start.y;
    const original = interaction.region;
    let region;
    if (interaction.kind === "move") {
        const width = original.right - original.left;
        const height = original.bottom - original.top;
        const left = Math.min(1 - width, Math.max(0, original.left + dx));
        const top = Math.min(1 - height, Math.max(0, original.top + dy));
        region = { left, top, right: left + width, bottom: top + height };
    } else {
        const minimumX = Math.min(1, 1 / (box.right - box.left));
        const minimumY = Math.min(1, 1 / (box.bottom - box.top));
        let { left, top, right, bottom } = original;
        if (interaction.kind === "new") {
            left = Math.min(interaction.start.x, at.x);
            right = Math.max(interaction.start.x, at.x);
            top = Math.min(interaction.start.y, at.y);
            bottom = Math.max(interaction.start.y, at.y);
        } else {
            if (interaction.handle.includes("w")) left = Math.min(at.x, right - minimumX);
            if (interaction.handle.includes("e")) right = Math.max(at.x, left + minimumX);
            if (interaction.handle.includes("n")) top = Math.min(at.y, bottom - minimumY);
            if (interaction.handle.includes("s")) bottom = Math.max(at.y, top + minimumY);
        }
        region = { left, top, right, bottom };
    }
    return { ...interaction.mode, region };
}

/** Map the normalized region into screen pixels for the crop overlay. */
export function preview(box, mode) {
    return screenRect(box, mode.region);
}

/** Screen positions of the eight visible handles. */
export function handlePoints(box, mode) {
    return handles(preview(box, mode));
}

/** Map the preview's normalized region into a bitmap crop region. */
export function regionOf(mode, span) {
    return {
        x: span.x + mode.region.left * span.width,
        y: span.y + mode.region.top * span.height,
        width: (mode.region.right - mode.region.left) * span.width,
        height: (mode.region.bottom - mode.region.top) * span.height,
        naturalWidth: span.naturalWidth,
        naturalHeight: span.naturalHeight,
    };
}
