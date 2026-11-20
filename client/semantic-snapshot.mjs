// The semantic snapshot adapter: one crossing per document change.
//
// The kernel can project the whole scene on demand (TASK-179). The question
// the page asks is not "what is in the scene" but "has the document changed
// since the snapshot I hold" — and the kernel already answers that with
// `documentRevision`, a counter of the document alone. Selection and viewport
// movements do not move it, so a reader that walks the scene while the user
// clicks around must not reserialize it.
//
// The cache is the adapter's, not the kernel's: the projection stays a pure
// function of the scene, and this module is the one place that decides when to
// ask again. Its key is the session **identity and its revision**, not the
// revision alone: two sessions can share a revision number (a fresh session
// starts at the same counter) and they are different documents.

/**
 * Build the snapshot adapter.
 *
 * @param {{ read?: (session: object) => string }} [options]
 * @returns {{ snapshot: (session: object) => string, clear: () => void }}
 */
export function createSemanticSnapshots({ read = (session) => session.semanticSnapshot() } = {}) {
    let cached = null;
    return {
        /**
         * The snapshot for `session`, read once per (session, revision).
         *
         * A read that throws caches nothing: the next ask tries again, so a
         * transient failure is not remembered as an empty scene.
         */
        snapshot(session) {
            const revision = session.documentRevision();
            if (cached !== null && cached.session === session && cached.revision === revision) {
                return cached.json;
            }
            const json = read(session);
            cached = { session, revision, json };
            return json;
        },
        /** Drop the cache: a destroyed or recovered session leaves nothing behind. */
        clear() {
            cached = null;
        },
    };
}
