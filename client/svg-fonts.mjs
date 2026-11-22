// Fonts inside an exported drawing.
//
// An SVG file that names `font-family="NextDraw Script, Xiaolai, sans-serif"` draws in
// that face only on a machine that has it installed; anywhere else the text falls back
// and the drawing no longer looks like itself. The export therefore carries the faces it
// uses, as `@font-face` rules whose source is a data URI, so the file is self-contained.
//
// Only what the drawing needs travels: the families its `<text>` elements name, and of
// each family only the subsets (`unicode-range`) holding a character the drawing really
// draws. The declarations come from `client/fonts/fonts.css`, the stylesheet the page
// itself paints with, so the file and the screen read one list of faces.
//
// The `font-family` of a text carries the whole **stack** the kernel resolved, and the
// face the browser draws with is its first member; the rest are the browser's own
// fallbacks, which this build does not ship and therefore does not embed.

/** One `@font-face` of the stylesheet, as `{family, file, ranges}`. */
const FACE = /font-family:\s*"([^"]+)";[^}]*?url\("([^"]+)"\)[^}]*?unicode-range:\s*([^;]+);/g;

/**
 * The faces a stylesheet declares.
 *
 * @param {string} css the text of `fonts.css`.
 * @returns {{family: string, file: string, ranges: [number, number][]}[]}
 */
export function parseFaces(css) {
    return [...css.matchAll(FACE)].map(([, family, file, range]) => ({
        family,
        file,
        ranges: range.split(",").map((part) => {
            const [low, high = low] = part.trim().replace(/^U\+/i, "").split("-");
            return [Number.parseInt(low, 16), Number.parseInt(high, 16)];
        }),
    }));
}

/** Decode the few entities the kernel's `escape` writes, so a character is a character. */
function unescapeXml(text) {
    return text
        .replaceAll("&lt;", "<")
        .replaceAll("&gt;", ">")
        .replaceAll("&quot;", '"')
        .replaceAll("&apos;", "'")
        .replaceAll("&amp;", "&");
}

/**
 * The face a `font-family` attribute names first.
 *
 * The attribute carries the whole **stack** — the family and the fallbacks behind it,
 * the way the kernel resolves it (`crates/nextdraw-core/src/font.rs`) — and the face the
 * browser will really draw with is the first member of it. The fallbacks are the
 * browser's own (the generic family, the emoji one): they are not faces this build
 * ships, so they are not the ones to embed.
 *
 * @param {string} stack the attribute's value.
 * @returns {string} the family name, without the quotes CSS may put around it.
 */
export function firstFamily(stack) {
    const first = stack.split(",")[0].trim();
    return first.replace(/^["']/, "").replace(/["']$/, "");
}

/**
 * The characters each family draws in a finished SVG document.
 *
 * The key is the family the text is drawn with — the first member of the stack, which
 * is the face the browser picks.
 *
 * @param {string} svg the document.
 * @returns {Map<string, Set<number>>} code points by family name.
 */
export function charactersByFamily(svg) {
    const used = new Map();
    for (const [, family, body] of svg.matchAll(
        /<text\b[^>]*\sfont-family="([^"]*)"[^>]*>([^<]*)<\/text>/g,
    )) {
        const name = firstFamily(unescapeXml(family));
        const points = used.get(name) ?? new Set();
        for (const char of unescapeXml(body)) {
            points.add(char.codePointAt(0));
        }
        used.set(name, points);
    }
    return used;
}

const within = (ranges, point) => ranges.some(([low, high]) => point >= low && point <= high);

/**
 * The faces a drawing needs: those of a used family whose range holds a drawn character.
 *
 * @param {string} svg the document.
 * @param {ReturnType<typeof parseFaces>} faces everything the stylesheet declares.
 */
export function facesFor(svg, faces) {
    const used = charactersByFamily(svg);
    return faces.filter(({ family, ranges }) => {
        const points = used.get(family);
        return points !== undefined && [...points].some((point) => within(ranges, point));
    });
}

function base64(bytes) {
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return globalThis.btoa(binary);
}

/**
 * The document with the faces it uses embedded.
 *
 * A drawing with no text, or whose families the stylesheet does not declare, comes back
 * unchanged. The `<style>` goes right after the root tag, so it precedes every element
 * it applies to.
 *
 * @param {string} svg the document.
 * @param {{css: () => Promise<string>, bytes: (file: string) => Promise<Uint8Array>}} source
 *   where the stylesheet and the face files come from.
 * @returns {Promise<string>}
 */
export async function embedFonts(svg, source) {
    if (!svg.includes("<text")) {
        return svg;
    }
    const needed = facesFor(svg, parseFaces(await source.css()));
    if (needed.length === 0) {
        return svg;
    }
    const rules = [];
    for (const { family, file, ranges } of needed) {
        const data = base64(await source.bytes(file));
        const range = ranges
            .map(([low, high]) => {
                const hex = (n) => n.toString(16).toUpperCase().padStart(4, "0");
                return low === high ? `U+${hex(low)}` : `U+${hex(low)}-${hex(high)}`;
            })
            .join(",");
        rules.push(
            `@font-face{font-family:"${family}";src:url(data:font/woff2;base64,${data}) format("woff2");unicode-range:${range};}`,
        );
    }
    const root = /<svg\b[^>]*>/.exec(svg);
    if (root === null) {
        return svg;
    }
    const at = root.index + root[0].length;
    return `${svg.slice(0, at)}<style>${rules.join("")}</style>${svg.slice(at)}`;
}

/**
 * Where the page's own faces are read from: the stylesheet and files beside this module.
 *
 * @param {typeof fetch} [fetchFn]
 */
export function pageFontSource(fetchFn = globalThis.fetch) {
    const base = new URL("./fonts/", import.meta.url);
    const get = async (name) => {
        const response = await fetchFn(new URL(name, base));
        if (!response.ok) {
            throw new Error(`font file ${name}: ${response.status}`);
        }
        return response;
    };
    return {
        css: async () => (await get("fonts.css")).text(),
        bytes: async (file) => new Uint8Array(await (await get(file)).arrayBuffer()),
    };
}
