// The service worker: the offline mode's hand, and nothing else.
//
// The rules it applies live in `client/offline.mjs`, where a test can drive
// them; this file is the wiring the browser asks for. Its whole job in one
// sentence: one generation of cache per build — named for the identity of the
// WHOLE build that `pkg/build-info.json` stamps — filled with what that build
// carries, and the generations of the builds that are gone deleted the moment
// the running build sees their name.
//
// # How a new build reaches the user
//
// The worker is not re-installed when a release changes only the client's
// JavaScript: its own bytes did not change, so the browser keeps the worker
// it has. The worker therefore has to *notice* the new build, and the place
// it notices it is the navigation: the build-info document is read from the
// network, and a build whose identity is not the one this worker serves is
// adopted — the artifact's bytes are checked against the hash the stamp
// declares, the generation is filled with the build's own files, and the past
// generation is deleted. Only then is the document answered.
//
// The document itself is answered from the network, with the cache as the
// fallback: a document that changed is usually the change the user came for,
// and the cache is what answers when the network is not there.
//
// Everything else the page fetches is answered from the generation and not
// from the whole storage: a cache that is not this build's is not this
// build's answer, and the storage of an origin is shared with pages that are
// nobody's business here.
//
// # How the worker itself is replaced
//
// The build's identity, stamped into the worker when the build was made. The
// import is here so that the bytes of the worker change with the build: the
// browser compares a worker's script AND the modules it imports when it looks
// for an update, and it installs the worker again only when those bytes
// differ. A worker whose own bytes never change is never installed again — so
// the rules it runs stay the ones of the build that wrote it, and no page is
// ever told that a new build exists.
//
// The identity travels as a JavaScript module because that is what the
// browser compares. Measured in Chromium: a worker whose JavaScript import
// changed is installed again, and a worker whose JSON import changed is not.
//
// It also has to be served without a cache of its own: measured in Chromium,
// a server that answers it with `max-age` gives the browser back the copy it
// already had, and the update is invisible. `no-cache` is enough. That is
// also the case in which the worker reads the value it was stamped with: the
// build it was written for, and the build the network is serving, are two
// builds, and the worker says so out loud.

import { BUILD_IDENTITY } from "./pkg/build-identity.js";
import {
    ARTIFACT_URLS,
    CACHE_PREFIX,
    SHELL_URLS,
    buildIdentityOf,
    generationNameFor,
    generationUrls,
    isGoverendRequest,
    isNavigationRequest,
    runningGeneration,
    sha256Hex,
    staleCacheNames,
    wasmVerdict,
} from "./client/offline.mjs";

/** The build-info document, the one answer that must be fresh. */
const BUILD_INFO_URL = "/pkg/build-info.json";

/** The artifact whose bytes are checked before a generation is adopted. */
const WASM_URL = "/pkg/nextdraw_wasm_bg.wasm";

/** The name of the generation this worker is currently serving. */
let generation = null;

/**
 * Read the build-info document from the network.
 *
 * The document is the one answer that must be fresh: it is how a new build is
 * ever seen. The network failing is the ordinary offline case, and `null` is
 * what says so.
 *
 * @returns {Promise<{response: Response, body: object}|null>} the document, or null.
 */
async function fetchStamp() {
    try {
        const response = await fetch(BUILD_INFO_URL, { cache: "reload" });
        if (!response.ok) return null;
        // The body is read from a clone: a Response's body streams once, and
        // the answer has to carry the document itself.
        const body = await response.clone().json().catch(() => null);
        if (body === null || typeof body !== "object") return null;
        return { response, body };
    } catch {
        return null;
    }
}

/**
 * Adopt a generation: check the artifact, fill the generation, make it the one
 * this worker serves, and delete the generations of the builds that are gone.
 *
 * The check comes first. The artifact's bytes are digested with the browser's
 * own digest and compared with the hash the stamp declares: a generation that
 * carries bytes nobody verified is a generation that claims a build it cannot
 * prove, and the stamp is a promise while the bytes are the fact. A mismatch
 * refuses the adoption and leaves the running generation alone — a build
 * whose artifact does not match its own stamp is not a build to serve.
 *
 * The fill comes with cache-busting reads: a past generation's copy of these
 * files must not seed the fresh one, and the browser's own cache must not
 * either.
 *
 * @param {string} identity the build's identity.
 * @param {object} body the build-info document the identity came from.
 * @returns {Promise<string|null>} the adopted generation's name, or null when
 *   the build was refused.
 */
async function adopt(identity, body) {
    const name = generationNameFor(identity);

    let artifact = null;
    try {
        artifact = await fetch(WASM_URL, { cache: "reload" });
    } catch {
        return null;
    }
    if (!artifact.ok) return null;
    const actual = await sha256Hex(await artifact.clone().arrayBuffer());
    if (wasmVerdict(body?.boundWasmSha256, actual) !== "match") {
        console.error(`the artifact does not match the stamp; not adopting ${identity}`);
        return null;
    }

    const cache = await caches.open(name);
    const urls = generationUrls(body);
    const present = new Set((await cache.keys()).map((request) => new URL(request.url).pathname));
    await Promise.all(
        urls.map(async (url) => {
            if (present.has(url)) return;
            try {
                // The artifact goes in with the bytes that were checked, not
                // with a second read of them.
                const response = url === WASM_URL ? artifact : await fetch(url, { cache: "reload" });
                if (response.ok) {
                    await cache.put(url, response);
                }
            } catch {
                // A file the cache could not take is a hole the offline boot
                // will find; refusing the whole generation for one miss would
                // trade a hole for nothing at all.
            }
        }),
    );

    const previous = generation;
    generation = name;
    if (previous !== null && previous !== name) {
        await caches.delete(previous);
    }
    const stale = staleCacheNames(await caches.keys(), name);
    await Promise.all(stale.map((staleName) => caches.delete(staleName)));
    return name;
}

/**
 * The generation this worker serves, recovered from the disk when it has no
 * memory of one.
 *
 * A worker that was restarted — by a browser, by a crash — inherits no
 * variable, and the caches on the disk are the record. The network says which
 * build is running; the disk says what is there. When the network cannot be
 * asked and several generations are on the disk, the complete one is the one
 * that can still answer a visit offline.
 *
 * @returns {Promise<string|null>} the generation's name, or null when there is
 *   none to serve.
 */
async function ensureGeneration() {
    if (generation !== null) return generation;
    const names = await caches.keys();
    const own = names.filter((name) => name.startsWith(CACHE_PREFIX));
    if (own.length === 0) return null;

    const stamp = await fetchStamp();
    const identity = stamp === null ? null : buildIdentityOf(stamp.body);
    const found = runningGeneration(names, identity);
    if (found !== null) {
        generation = found;
        return generation;
    }
    if (own.length > 1) {
        const complete = [];
        for (const name of own) {
            const cache = await caches.open(name);
            const paths = new Set((await cache.keys()).map((request) => new URL(request.url).pathname));
            if (SHELL_URLS.every((url) => paths.has(url))) complete.push(name);
        }
        if (complete.length === 1) {
            generation = complete[0];
            return generation;
        }
    }
    return null;
}

/**
 * Answer a navigation.
 *
 * The build-info document is read first, and a build that is not the one
 * this worker serves is adopted BEFORE the document is answered: the modules
 * the document asks for come from the generation, so a generation that was
 * not adopted in time would answer them with the past build's bytes.
 *
 * @param {Request} request the navigation request.
 * @returns {Promise<Response>} the document.
 */
async function respondNavigation(request) {
    const stamp = await fetchStamp();
    if (stamp !== null) {
        const identity = buildIdentityOf(stamp.body);
        if (identity !== null && generationNameFor(identity) !== generation) {
            await adopt(identity, stamp.body);
        }
    }

    try {
        const fresh = await fetch(request.url);
        const current = await ensureGeneration();
        if (fresh.ok && current !== null) {
            const cache = await caches.open(current);
            await cache.put(request.url, fresh.clone());
        }
        return fresh;
    } catch {
        const current = await ensureGeneration();
        if (current !== null) {
            const cache = await caches.open(current);
            const cached = await cache.match(request.url, { ignoreSearch: true });
            if (cached !== undefined) return cached;
        }
        return Response.error();
    }
}

/**
 * Answer the build-info document.
 *
 * Freshness first: this answer is how a new artifact is ever seen. The
 * network failing is the ordinary offline case, and the cached copy is
 * exactly what the offline case is for.
 *
 * @param {Request} request the request for the document.
 * @returns {Promise<Response>} the document.
 */
async function respondStamp(request) {
    const stamp = await fetchStamp();
    if (stamp !== null) {
        const identity = buildIdentityOf(stamp.body);
        if (identity !== null && generationNameFor(identity) !== generation) {
            await adopt(identity, stamp.body);
        } else if (generation !== null) {
            const cache = await caches.open(generation);
            await cache.put(request.url, stamp.response.clone());
        }
        return stamp.response;
    }
    const current = await ensureGeneration();
    if (current !== null) {
        const cache = await caches.open(current);
        const cached = await cache.match(request.url);
        if (cached !== undefined) return cached;
    }
    return Response.error();
}

/**
 * Answer one of the application's own files.
 *
 * The cache is the first answer, and the network fills the holes. The cache
 * that answers is this build's generation and not the whole storage: a cache
 * that is not this build's is not this build's answer.
 *
 * @param {Request} request the request for the file.
 * @returns {Promise<Response>} the file.
 */
async function respondFromGeneration(request) {
    const current = await ensureGeneration();
    if (current !== null) {
        const cache = await caches.open(current);
        const cached = await cache.match(request);
        if (cached !== undefined) return cached;
    }
    const fresh = await fetch(request);
    if (fresh.ok && current !== null) {
        const cache = await caches.open(current);
        await cache.put(request, fresh.clone());
    }
    return fresh;
}

self.addEventListener("install", (event) => {
    event.waitUntil(
        (async () => {
            // The worker cannot know the build's identity on its own: it
            // asks the document the build stamped. A visit without that
            // document is a visit the worker does not cache for — the next
            // one asks again.
            const stamp = await fetchStamp();
            if (stamp !== null) {
                const identity = buildIdentityOf(stamp.body);
                if (identity !== null) {
                    // The build this worker was written for, and the build the
                    // network is serving. They are the same build when the
                    // worker is current. They are not when the browser was
                    // handed a copy of the stamped module it had already
                    // cached — the case in which the update is invisible and
                    // the worker runs rules the build does not have.
                    if (identity !== BUILD_IDENTITY) {
                        console.warn(
                            `the worker of build ${BUILD_IDENTITY} is installing over build ${identity}`,
                        );
                    }
                    await adopt(identity, stamp.body);
                }
            }
            await self.skipWaiting();
        })(),
    );
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        (async () => {
            await self.clients.claim();
            await ensureGeneration();
        })(),
    );
});

self.addEventListener("fetch", (event) => {
    const request = event.request;
    if (!isGoverendRequest(request)) {
        return;
    }
    const url = new URL(request.url);
    // The response is the promise the event stays alive for, so the work
    // below is awaited inside it — a `waitUntil` after an await is not one
    // the event honours, and a put the browser may kill is a cache that
    // quietly stays empty.
    if (isNavigationRequest(request)) {
        event.respondWith(respondNavigation(request));
        return;
    }
    if (url.pathname === BUILD_INFO_URL) {
        event.respondWith(respondStamp(request));
        return;
    }
    event.respondWith(respondFromGeneration(request));
});
