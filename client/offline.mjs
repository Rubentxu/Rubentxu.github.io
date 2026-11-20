// The offline mode's own arithmetic, kept pure.
//
// A service worker that names, keeps and discards caches is making decisions
// about *generations*: which cache belongs to the build that is running, and
// which ones are the past. Those decisions are rules, and the kernel-owns-the-
// rules habit does not stop at the wasm boundary — the rules live here as
// functions a test can drive, and `sw.js` is the hand that applies them. The
// worker reads its facts and calls the rule; it never improvises one.
//
// # What names a generation
//
// A generation is named for the identity of the WHOLE build — the kernel and
// the client together — and not for the kernel's hash alone. The kernel's hash
// is a fact about one file of the build, and a release that changes only the
// client's JavaScript does not change it: a worker that named generations by
// that hash alone would serve yesterday's client under the name of today's
// kernel, and no visit would ever notice. The identity the build stamps
// (`buildSha256`) commits to every file the client carries, so a change in
// any of them names a new generation.

/** Every cache this application owns starts with the prefix. */
export const CACHE_PREFIX = "nextdraw-";

/**
 * The cache name one build owns: the prefix and the build's own identity.
 *
 * @param {string} identity the build's `buildSha256`.
 * @returns {string} the cache name for that build.
 */
export function generationNameFor(identity) {
    return `${CACHE_PREFIX}${identity}`;
}

/**
 * The identity a build-info body carries.
 *
 * A body that is not the document the build stamps — a proxy's error page, a
 * truncated response, a stamp from before builds were identified as a whole
 * — names no generation, and pretending otherwise would name one at random.
 * `null` is the answer for "nothing usable arrived".
 *
 * @param {object} body the parsed build-info document.
 * @returns {string|null} the build's identity, or null.
 */
export function buildIdentityOf(body) {
    const identity = body?.buildSha256;
    return typeof identity === "string" && identity.length > 0 ? identity : null;
}

/**
 * The caches of the builds that are gone.
 *
 * A name belongs to this application only when it carries the prefix — a
 * same-origin page may share the storage with caches that are nobody's
 * business here, and deleting those would be deletion without ownership.
 * Of the ones that are ours, every name except the running build's is a
 * past generation, and a past generation is disk the user pays for.
 *
 * @param {string[]} names every cache name there is.
 * @param {string} current the running build's full cache name.
 * @returns {string[]} the names to delete, oldest and newest alike.
 */
export function staleCacheNames(names, current) {
    return names.filter((name) => name.startsWith(CACHE_PREFIX) && name !== current);
}

/**
 * The generation this worker is serving, as far as the disk knows.
 *
 * A worker that was restarted — by a browser, by a crash — inherits no
 * variable and has to read the record the caches are. The network says which
 * build is running and the disk says what is there; the generation that
 * carries the running build's identity is the one to serve. Offline there is
 * no network to ask, and a single generation on the disk is the running one
 * by elimination. Several generations with no network to tell them apart are
 * not a question this rule can answer: `null` is the honest answer, and the
 * worker falls back to the network.
 *
 * @param {string[]} names every cache name there is.
 * @param {string|null} identity the identity the network reports, or null.
 * @returns {string|null} the cache name to serve, or null.
 */
export function runningGeneration(names, identity) {
    const own = names.filter((name) => name.startsWith(CACHE_PREFIX));
    if (identity !== null && identity !== undefined) {
        const exact = generationNameFor(identity);
        if (own.includes(exact)) return exact;
    }
    return own.length === 1 ? own[0] : null;
}

/**
 * The documents a fresh generation precaches, so that a visit is enough.
 *
 * The entry pages and the build's own identity: everything else the editor
 * needs (the module graph, the artifact) is fetched during that first visit
 * and lands in the generation's cache as it goes, which is what the fetch
 * rule stores. A precache list longer than this would be a second graph the
 * build would have to keep honest — the fetch rule already reads what the
 * page really asks for.
 */
export const SHELL_URLS = ["/", "/index.html", "/embed.html", "/collab.html", "/pkg/build-info.json"];

/**
 * The artifact itself, by its own path.
 *
 * The wasm and the glue that loads it are the two files the kernel's boot
 * cannot do without, and they are the reason an offline start is worth
 * having. The build-info document carries the build's identity; these two
 * are the build.
 */
export const ARTIFACT_URLS = ["/pkg/nextdraw_wasm.js", "/pkg/nextdraw_wasm_bg.wasm"];

/**
 * Every URL a generation carries.
 *
 * The shell and the artifact are the same in every build; the client's own
 * files are the ones the build stamped, and they are what makes a generation
 * specific to a build. The stamped paths are written without a leading
 * separator and the URLs are written with one: the same path, spelled the way
 * a URL spells it.
 *
 * @param {object} body the parsed build-info document.
 * @returns {string[]} the URLs, in the order they are precached.
 */
export function generationUrls(body) {
    const files = Array.isArray(body?.clientFiles) ? body.clientFiles : [];
    const client = files.map((path) => {
        const text = String(path);
        return `/${text.startsWith("/") ? text.slice(1) : text}`;
    });
    return [...SHELL_URLS, ...ARTIFACT_URLS, ...client];
}

/**
 * The digest of some bytes.
 *
 * The browser's own digest, and not a copy of one: the worker verifies the
 * artifact it is about to adopt against the hash the build stamped, and a
 * verification that used another implementation would be a second opinion
 * about the same bytes rather than a check of them.
 *
 * @param {ArrayBuffer | Uint8Array} bytes the bytes.
 * @returns {Promise<string>} the digest, in lower-case hexadecimal.
 */
export async function sha256Hex(bytes) {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Whether the artifact's bytes are the ones the build stamped.
 *
 * Three answers and not two: a stamp that names no hash is not a mismatch, it
 * is the absence of a claim, and a worker that refused to adopt because of
 * the absence of a claim would never adopt anything.
 *
 * @param {string|null} expected the hash the stamp declares.
 * @param {string|null} actual the digest of the bytes that arrived.
 * @returns {"match"|"mismatch"|"unknown"} the verdict.
 */
export function wasmVerdict(expected, actual) {
    if (typeof expected !== "string" || expected.length === 0) return "unknown";
    if (typeof actual !== "string" || actual.length === 0) return "unknown";
    return expected === actual ? "match" : "mismatch";
}

/**
 * Whether a request is a navigation.
 *
 * A navigation is the one request whose answer is a document, and it is the
 * one request that can tell the worker that a new build is here: the
 * documents the browser asks for are the ones a release changes most often,
 * and they are the ones the cache must not answer with yesterday's bytes.
 *
 * @param {Request} request the request the worker was handed.
 * @returns {boolean} whether the request navigates.
 */
export function isNavigationRequest(request) {
    return request.mode === "navigate";
}

/**
 * Whether a request is one the offline rule governs.
 *
 * Same-origin GETs only: the rule stores what the application fetches from
 * its own build, and a POST is not a fetch the next visit should answer
 * from yesterday.
 *
 * @param {Request} request the request the worker was handed.
 * @returns {boolean} whether the cache rule applies.
 */
export function isGoverendRequest(request) {
    return request.method === "GET" && new URL(request.url).origin === self.location.origin;
}
