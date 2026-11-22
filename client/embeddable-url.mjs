// Whether a pasted line is a web embed, and the size it would land at.
//
// # Where the rule lives, and why nothing here keeps a copy of it
//
// The paste's third road (`App.clipboard.ts:236-279`, the pinned clone) is
// "Pure embeddable URLs": when every non-empty line of the pasted text is a
// URL the policy admits, the paste becomes one web embed per line instead of
// a text. Which URLs those are is a rule, and the rule has one authority: the
// kernel (`crates/nextdraw-core/src/embeddable.rs`), which answers it for a
// frame at render time (`embeddablesView`) and publishes the same answer at
// the boundary as `embeddable_policy` (`crates/nextdraw-wasm/src/lib.rs`).
// This module reads that answer instead of keeping a second copy of the list:
// the table it used to carry, and the wildcard family it used to re-derive
// from it, are gone. A classifier that re-derives the rule is the drift
// waiting to happen, and the drift stays invisible until a paste does the
// wrong thing.
//
// The answer crosses as an argument (`p-pure`): nothing here imports the glue,
// so the classifier stays loadable by a reader that holds no WASM instance,
// and a caller that supplies no answer gets no embed road at all. What stays
// here is the browser's own half of the reference: the shapes the regular
// expressions read (`packages/element/src/embeddable.ts`, the pinned clone),
// the size each provider measures, and the embed code an address travels
// inside.
//
// The element's size is the reference's `getEmbedLink` answer too: the
// creation call takes `embedLink.intrinsicSize` for its width and height
// (`components/App.tsx:8423-8424`) while storing the pasted URL itself as
// the `link` (`:8425`) — the embed's rewritten src lives in the renderer's
// data, not in the element. This module answers the size and the kind and
// nothing more: the rewritten embed URLs and the sandbox documents are the
// iframe's own work, and no receipt measures them yet.
//
// The kernel owns what a stored link may name — the write frontier refuses
// schemes a tab cannot open (`crates/nextdraw-core/src/link.rs`) — so the
// classifier hands the URL over as it was pasted and lets the kernel judge
// it, exactly as the drag road does.

const RE_YOUTUBE =
    /^(?:http(?:s)?:\/\/)?(?:www\.)?youtu(?:be\.com|\.be)\/(embed\/|watch\?v=|shorts\/|live\/|playlist\?list=|embed\/videoseries\?list=)?([a-zA-Z0-9_-]+)/;

const RE_VIMEO =
    /^(?:http(?:s)?:\/\/)?(?:(?:w){3}\.)?(?:player\.)?vimeo\.com\/(?:video\/)?([^?\s]+)(?:\?.*)?$/;
const RE_FIGMA = /^https:\/\/(?:www\.)?figma\.com/;

const RE_GH_GIST = /^https:\/\/gist\.github\.com\/([\w_-]+)\/([\w_-]+)/;
const RE_GH_GIST_EMBED =
    /^<script[\s\S]*?\ssrc=["'](https:\/\/gist\.github\.com\/.*?)\.js["']/i;

// not anchored to start to allow <blockquote> twitter embeds
const RE_TWITTER =
    /(?:https?:\/\/)?(?:(?:w){3}\.)?(?:twitter|x)\.com\/[^/]+\/status\/(\d+)/;
const RE_TWITTER_EMBED =
    /^<blockquote[\s\S]*?\shref=["'](https?:\/\/(?:twitter|x)\.com\/[^"']*)/i;

const RE_GENERIC_EMBED =
    /^<(?:iframe|blockquote)[\s\S]*?\s(?:src|href)=["']([^"']*)["'][\s\S]*?>$/i;

const RE_GIPHY =
    /giphy.com\/(?:clips|embed|gifs)\/[a-zA-Z0-9]*?-?([a-zA-Z0-9]+)(?:[^a-zA-Z0-9]|$)/;

const RE_REDDIT =
    /^(?:http(?:s)?:\/\/)?(?:www\.)?reddit\.com\/r\/([a-zA-Z0-9_]+)\/comments\/([a-zA-Z0-9_]+)\/([a-zA-Z0-9_]+)\/?(?:\?[^#\s]*)?(?:#[^\s]*)?$/;
const RE_REDDIT_EMBED =
    /^<blockquote[\s\S]*?\shref=["'](https?:\/\/(?:www\.)?reddit\.com\/[^"']*)/i;

/**
 * The hostname an address names, against one hostname the caller supplied.
 *
 * This is the caller's own law, not the kernel's: `validateEmbeddable` is a
 * list the application hands in (`packages/element/src/embeddable.ts:505-552`),
 * and the comparison is the reference's — the `www.` prefix is read away from
 * both sides and the two bare spellings are asked whether they are the same.
 * There is no wildcard here on purpose: the family rule (`*.simplepdf.eu`)
 * belongs to the kernel's allowlist, the kernel publishes its answer already
 * expanded, and a JS reader that expanded it again would be the second copy
 * of the rule this module exists to stop being.
 *
 * @param {string} url the address to name.
 * @param {string} allowedHostname the one hostname the caller named.
 * @returns {string | null} the hostname that answered, or `null`.
 */
function matchHostname(url, allowedHostname) {
    try {
        const { hostname } = new URL(url);
        const bareDomain = hostname.replace(/^www\./, "");
        const bareAllowedHostname = allowedHostname.replace(/^www\./, "");
        if (bareDomain === bareAllowedHostname) {
            return bareAllowedHostname;
        }
    } catch {
        // ignore
    }
    return null;
}

/**
 * What the injected policy answered about one address.
 *
 * The policy is the kernel's answer, handed in by the caller: a function from
 * a link to `{render, sameOrigin}` — the shape `embeddable_policy` answers with
 * (`crates/nextdraw-wasm/src/lib.rs:271`). A policy that is absent, that is not
 * a function, that throws, or that answers with something whose `render` is not
 * `true`, is a refusal: the road fails closed rather than falling back to a list
 * this module no longer holds. The caller adapting the boundary's JSON to this
 * shape is the caller's marshalling, and this module stays loadable without a
 * live instance.
 *
 * @param {((link: string) => ({render?: boolean} | boolean) | null | undefined) | null | undefined} policy the injected answer.
 * @param {string} url the address to ask about.
 * @returns {boolean} whether the policy admits the address.
 */
function policyAdmits(policy, url) {
    if (typeof policy !== "function") {
        return false;
    }
    let answer;
    try {
        answer = policy(url);
    } catch {
        return false;
    }
    if (typeof answer === "boolean") {
        return answer;
    }
    return answer?.render === true;
}

/**
 * The address an embed code carries, or the text itself.
 *
 * `maybeParseEmbedSrc`, `packages/element/src/embeddable.ts:477-503`,
 * verbatim: a copied `<iframe>` or `<blockquote>` snippet is read for the
 * address it embeds, provider by provider, and a text that names no embed
 * code is returned as it is — the paste road's classifier then judges it
 * like any other line.
 *
 * @param {string} str the pasted line.
 * @returns {string} the address to judge.
 */
export function maybeParseEmbedSrc(str) {
    const twitterMatch = str.match(RE_TWITTER_EMBED);
    if (twitterMatch && twitterMatch.length === 2) {
        return twitterMatch[1];
    }

    const redditMatch = str.match(RE_REDDIT_EMBED);
    if (redditMatch && redditMatch.length === 2) {
        return redditMatch[1];
    }

    const gistMatch = str.match(RE_GH_GIST_EMBED);
    if (gistMatch && gistMatch.length === 2) {
        return gistMatch[1];
    }

    if (RE_GIPHY.test(str)) {
        return `https://giphy.com/embed/${RE_GIPHY.exec(str)[1]}`;
    }

    const match = str.match(RE_GENERIC_EMBED);
    if (match && match.length === 2) {
        return match[1];
    }

    return str;
}

/**
 * Whether the address is one the page may embed.
 *
 * `embeddableURLValidator`, `packages/element/src/embeddable.ts:505-552`, with
 * the reference's one difference: the law behind the answer is not kept here.
 * The app-provided `validateEmbeddable` is read first, exactly as the reference
 * reads it (a boolean, a function, a regular expression or a list of hostnames
 * the caller wrote down — a parameter of the caller, not a copy of the kernel's
 * table). With no app-provided law, the answer is the injected policy's: the
 * kernel decides, and this module only relays. No policy, no admission.
 *
 * @param {string | null | undefined} url the address to judge.
 * @param {undefined} validateEmbeddable the app's own law, unused here.
 * @param {((link: string) => ({render?: boolean} | boolean) | null | undefined)} [policy] the kernel's answer, injected.
 * @returns {boolean} whether the address may be embedded.
 */
export function embeddableURLValidator(url, validateEmbeddable, policy) {
    if (!url) {
        return false;
    }
    if (validateEmbeddable != null) {
        if (typeof validateEmbeddable === "function") {
            const ret = validateEmbeddable(url);
            if (typeof ret === "boolean") {
                return ret;
            }
        } else if (typeof validateEmbeddable === "boolean") {
            return validateEmbeddable;
        } else if (validateEmbeddable instanceof RegExp) {
            return validateEmbeddable.test(url);
        } else if (Array.isArray(validateEmbeddable)) {
            for (const domain of validateEmbeddable) {
                if (domain instanceof RegExp) {
                    if (url.match(domain)) {
                        return true;
                    }
                } else if (matchHostname(url, domain)) {
                    return true;
                }
            }
            return false;
        }
    }

    return policyAdmits(policy, url);
}

/**
 * The size and kind the reference measures for the address.
 *
 * `getEmbedLink`, `packages/element/src/embeddable.ts:185-404`, reduced to
 * what an element stores: the intrinsic size each provider answers and the
 * kind it names — `video`, `document`, or `generic` — with the generic
 * 560×840 the reference starts from (`:190`). The link rewriting and the
 * sandbox documents stay upstream's; an element's `link` is the pasted URL
 * itself (`components/App.tsx:8425`), so no rewrite belongs to this answer.
 *
 * @param {string} url the address to measure.
 * @returns {{width: number, height: number, type: "video" | "document" | "generic"}} the element's size and kind.
 */
export function embedShapeFor(url) {
    const ytLink = url.match(RE_YOUTUBE);
    if (ytLink?.[2]) {
        const isPortrait = url.includes("shorts");
        return {
            width: isPortrait ? 315 : 560,
            height: isPortrait ? 560 : 315,
            type: "video",
        };
    }

    if (url.match(RE_VIMEO)?.[1]) {
        return { width: 560, height: 315, type: "video" };
    }

    if (driveVideoFor(url)) {
        return { width: 560, height: 315, type: "video" };
    }

    if (RE_FIGMA.test(url)) {
        return { width: 550, height: 550, type: "generic" };
    }

    if (RE_TWITTER.test(url)) {
        return { width: 480, height: 480, type: "document" };
    }

    if (RE_REDDIT.test(url)) {
        return { width: 480, height: 480, type: "document" };
    }

    if (RE_GH_GIST.test(url)) {
        return { width: 550, height: 720, type: "document" };
    }

    return { width: 560, height: 840, type: "generic" };
}

/**
 * The file a Drive address names, when it names one.
 *
 * `parseGoogleDriveVideoLink`, `packages/element/src/embeddable.ts:88-130`,
 * reduced to the part the size asks: only a `drive.google.com` address whose
 * path or `id` query carries a file id is a Drive video, and the rest of the
 * table's generic answer stands. The preview URL the reference builds is the
 * renderer's work, not the element's.
 *
 * @param {string} url the address to read.
 * @returns {boolean} whether the address names a Drive file.
 */
function driveVideoFor(url) {
    try {
        const parsed = new URL(url.startsWith("http") ? url : `https://${url}`);
        const hostname = parsed.hostname.replace(/^www\./, "");
        if (hostname !== "drive.google.com") {
            return false;
        }

        let fileId = null;
        const pathMatch = parsed.pathname.match(/^\/file\/d\/([^/]+)(?:\/|$)/);
        if (pathMatch?.[1]) {
            fileId = pathMatch[1];
        } else if (parsed.pathname === "/open" || parsed.pathname === "/uc") {
            fileId = parsed.searchParams.get("id");
        }

        return !!fileId && /^[a-zA-Z0-9_-]+$/.test(fileId);
    } catch {
        return false;
    }
}

/**
 * The embeds a paste would become, or `null` when it would stay a paste.
 *
 * The reference's road, `App.clipboard.ts:236-279`: the text's non-empty
 * lines are read one by one — embed codes for the address they carry — and
 * the road answers only when *every* line is an embeddable URL, in the
 * reference's own double condition (`:251-253`): at least one, and no line
 * left over. One line that is not an embeddable URL and the whole paste
 * falls through to the text road, because a user who copied a URL and a
 * note asked for both.
 *
 * Whether a line's address is embeddable is the kernel's answer, injected as
 * `policy`: the same `{render, sameOrigin}` the frame reads before it shows a
 * page, so a paste cannot open a road the render would refuse. With no policy
 * injected the road answers `null` for any text — a page whose kernel never
 * answered is a page that embeds nothing, and it never falls back to a list
 * kept here.
 *
 * @param {string | null} text the pasted text, or `null` when the system said nothing.
 * @param {((link: string) => ({render?: boolean} | boolean) | null | undefined)} [policy] the kernel's answer, injected.
 * @returns {Array<{url: string, width: number, height: number}> | null} the embeds to create, or `null`.
 */
export function embeddableRoadFor(text, policy) {
    if (typeof text !== "string") {
        return null;
    }
    const nonEmptyLines = text
        .replace(/\r\n/g, "\n")
        .split(/\n+/)
        .map((line) => line.trim())
        .filter(Boolean);
    if (nonEmptyLines.length === 0) {
        return null;
    }
    const urls = nonEmptyLines
        .map((line) => maybeParseEmbedSrc(line))
        .filter(
            (url) =>
                embeddableURLValidator(url, undefined, policy) &&
                (/^(http|https):\/\/[^\s/$.?#].[^\s]*$/.test(url) ||
                    embedShapeFor(url).type === "video"),
        );
    if (urls.length === 0 || urls.length !== nonEmptyLines.length) {
        return null;
    }
    return urls.map((url) => {
        const shape = embedShapeFor(url);
        return { url, width: shape.width, height: shape.height };
    });
}
