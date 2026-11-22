// The client's link to the collaboration room.
//
// # What this is
//
// The browser half of ADR-007. The relay (`scripts/relay.mjs`) holds the
// room's truth; this module is everything a page needs to be one of the
// clients around it: it records what the user does, hands the relay batches
// of actions, takes the room's document back whenever the room knows
// something the page does not, and carries the presence pointers that
// `client/presence.mjs` rules and `paintPresence` draws.
//
// # The recording, and why it is a Proxy
//
// The contract says clients send *actions* — but the page's edits go through
// ~40 different session methods, and wrapping each by hand is a second list
// waiting to drift. So the link instruments the session once, generically:
// every call that moves `documentRevision()` was a mutation, and only five
// of those travel as precise verbs (`insert`, `delete`, `translateAll`,
// `group`, `setStyle` — the relay's own vocabulary; `deleteAll` means the
// caller's selection, which no argument-less action can say, so it rides
// the fallback like `clearScene` does — TASK-271). Anything else
// records the **whole document** as one `{ op: "document" }` action — the
// decision's "last batch wins", honest about its granularity. A precise verb
// from each of two clients lands twice, because actions compose; a document
// fallback wins the room and tells the other client to converge.
//
// # The echo, and why bytes decide
//
// The relay answers every batch with the whole document, and a poll returns
// the document again. The link therefore keeps the last bytes it *knew*
// — sent or loaded — and calls the page back only when the room's bytes
// differ from them: our own echo is recognised and dropped, a peer's work
// is adopted. Nothing compares revisions or timestamps; the document is the
// revision (TASK-35's no-op test pins that), so bytes are the whole story.
//
// # What this deliberately is not
//
// Not scheduled. The link answers `sync()` and `pollPresence()`; the page
// decides when to call them (a polling interval in production, the test's
// own clock in the suite). And not encrypted: ADR-007 says the relay sees
// the document in clear, and TASK-45 owns what that means.

/** The verbs that travel as themselves, in the relay's own words. */
const PRECISE_VERBS = new Set(["insert", "delete", "translateAll", "group", "setStyle"]);

/**
 * Wrap a session so every mutation reports itself.
 *
 * The wrapper is transparent: reads pass through untouched, and a call that
 * does not move the document never reports. `documentRevision` itself goes
 * through the same trap, which costs one extra redirect per call and
 * reports nothing — a read cannot be a mutation.
 *
 * @param {object} real The session the factory owns.
 * @param {(verb: string, args: unknown[]) => void} onMutation The link's recorder.
 * @returns {object} The session as the page uses it.
 */
export function instrumentSession(real, onMutation) {
    return new Proxy(real, {
        get(target, property) {
            const value = Reflect.get(target, property, target);
            if (typeof value !== "function") {
                return value;
            }
            return (...args) => {
                const before = target.documentRevision();
                const answer = value.apply(target, args);
                if (target.documentRevision() !== before) {
                    onMutation(String(property), args);
                }
                return answer;
            };
        },
    });
}

/**
 * Create the link for one page in one room.
 *
 * @param {object} deps
 * @param {string} deps.roomUrl The relay's base, `http://host:port` — the
 *   link appends `/room/:id/...`.
 * @param {string} deps.roomId The room's name.
 * @param {string} deps.clientId This page's stable id in the room.
 * @param {(path: string, body?: object) => Promise<object>} deps.post The POST door.
 * @param {(path: string) => Promise<object>} deps.get The GET door.
 * @param {{seal: (value: object) => Promise<string>, open: (sealed: string) => Promise<object>}} [deps.presenceCodec]
 *   The room key's codec, when the room has a key. Presence is the one
 *   channel the relay only re-forwards, so it is the one channel that can
 *   cross as ciphertext: with a codec, this page's pointer posts as an
 *   opaque blob and every peer's blob is opened on arrival — a blob that
 *   refuses to open is a peer of another key, and it is dropped, not
 *   reported.
 * @returns {object} The link.
 */
export function createCollabLink({ roomUrl, roomId, clientId, post, get, presenceCodec }) {
    const base = `${roomUrl}/room/${encodeURIComponent(roomId)}`;
    // The doors are the paths and nothing else. The room's capability is not
    // one of their parts: a path is what survives in an access log, in the
    // page's own network panel and in a copied link, and a credential must
    // not. The transport (`client/room-wiring.mjs`) carries it on the
    // `x-room-token` header the relay reads first, and a guarded room answers
    // a request without it with the 403 the round handles like any refusal.
    const door = (name) => `${base}/${name}`;
    /**
     * The document door with the revision this link knows, when it knows one:
     * the room answers a read whose revision still stands without its
     * document.
     *
     * @returns {string} The path, `?rev=` included as it applies.
     */
    const documentDoor = () =>
        roomRevision === null ? door("document") : `${door("document")}?rev=${encodeURIComponent(roomRevision)}`;
    /** The action descriptors waiting for the next batch. */
    let queue = [];
    /** Whether a mutation fell outside the precise verbs. */
    let documentFallback = false;
    /** The last bytes this link knew — sent or loaded. */
    let knownBytes = null;
    /**
     * The room's document revision, exactly as the authority spells it.
     *
     * The kernel counts its document with a revision that moves only when a
     * mutation is effective, and the relay rides it on every answer. A read
     * that carries the revision it knows is a poll the room answers without
     * repeating its document — the whole economy of the idle round
     * (TASK-113). A room that does not speak revisions (an older relay, a
     * test's fake) is answered the old way: the door carries no `rev` and the
     * read takes the document.
     */
    let roomRevision = null;
    let seq = 0;
    // The batch that has left and is not yet acknowledged, with the seq
    // reserved for it. It stays here across a failed attempt — the next
    // round re-sends the same actions under the same identifier, which the
    // relay's own redelivery rule answers without applying them twice — and
    // `attempting` says whether an await is literally in the air, so two
    // rounds never fire the same POST and a read never runs while our batch
    // is unaccounted for (the room's answer could not include it, and
    // adopting it would flash the page back to before its own edits).
    let sentBatch = null;
    let sentSeq = null;
    let attempting = false;
    /**
     * The open conflict, when a whole-document snapshot was refused because
     * the room had moved past the revision it was edited over.
     *
     * While it is open the link holds the room's documents at arm's length:
     * an idle read still runs (presence, the revision itself) but nothing is
     * adopted over the user's head — the local edit stays exactly what the
     * user made of it, until their next drawing lands a fresh snapshot (keep
     * local, said by the act of drawing) or the page decides otherwise
     * through `record`'s own doors. `null` is no conflict.
     */
    let conflict = null;

    /**
     * The room's presence rows, opened when the room has a key.
     *
     * A row without a blob is already clear (a page without a key, in a
     * demo room); a blob that refuses to open is a peer sealed under
     * another key — not an error this page reports, just someone it
     * cannot read.
     *
     * @param {Array<object>} rows The rows as the relay stores them.
     * @returns {Promise<Array<{id: string, x: number, y: number, name: string}>>}
     */
    const openPeers = async (rows) => {
        if (presenceCodec === undefined) {
            return rows;
        }
        const opened = [];
        for (const row of rows) {
            if (row.blob === undefined) {
                opened.push(row);
                continue;
            }
            try {
                const value = await presenceCodec.open(row.blob);
                opened.push({
                    id: row.id,
                    x: value.x,
                    y: value.y,
                    name: value.name,
                    ...(Array.isArray(value.selectedIds) ? { selectedIds: value.selectedIds } : {}),
                });
            } catch (error) {
                if (!String(error.message).startsWith("bad_key:")) {
                    throw error;
                }
            }
        }
        return opened;
    };

    return {
        /**
         * Whether work awaits the room (the page's "should I sync?" probe).
         *
         * An unacked batch counts: if the wire went down, the probe is what
         * keeps the page's round loop calling `sync` until the batch is
         * home — forgetting it would strand the user's edits until the next
         * one happened to be drawn.
         */
        get pending() {
            return queue.length > 0 || documentFallback || sentBatch !== null;
        },

        /**
         * The open conflict, or `null`: the named refusal of a whole-document
         * snapshot the room refused as stale, with the base that was refused
         * and the revision the room holds now.
         */
        get conflict() {
            return conflict;
        },

        /**
         * Record one mutation, as the instrumented session reports it.
         *
         * @param {string} verb The method's name.
         * @param {unknown[]} args The call's arguments.
         * @param {() => object} documentOf The session's current document, for the fallback.
         * @returns {void}
         */
        record(verb, args, documentOf) {
            if (verb === "insert") {
                queue.push({ op: "insert", json: JSON.parse(args[0]) });
                return;
            }
            if (verb === "delete") {
                queue.push({ op: "delete", id: args[0] });
                return;
            }
            if (verb === "translateAll") {
                queue.push({ op: "translateAll", ids: args[0], dx: args[1], dy: args[2] });
                return;
            }
            if (verb === "group") {
                queue.push({ op: "group", ids: args[0], groupId: args[1] });
                return;
            }
            if (verb === "setStyle") {
                // The patch arrives as the JSON text `stylePatch()` minted
                // (only a call the kernel accepted moves the revision, so the
                // text is valid here by construction); re-parsing keeps the
                // batch plain JSON all the way to the relay, which strings it
                // back for the same wasm door. Absolute values, no coordinates
                // — a re-applied patch converges (TASK-271).
                queue.push({ op: "setStyle", ids: args[0], patch: JSON.parse(args[1]) });
                return;
            }
            // Anything else the kernel can mutate with is still *this
            // client's* edit, and the room will not lose it: the whole
            // document rides as one action, the decision's last-batch-wins
            // with its granularity said out loud. The revision it was edited
            // over rides with it — the room refuses a snapshot that no
            // longer sits on the revision it names, instead of taking it
            // over a room that has moved on (TASK-114). A client that has
            // never heard a revision rides without one, and the legacy
            // relay takes it as the old relays always have.
            documentFallback = true;
            queue.push({ op: "document", json: documentOf(), ...(roomRevision === null ? {} : { base: roomRevision }) });
        },

        /**
         * One round: send what is queued, then take the room's document if
         * the room knows different bytes.
         *
         * A batch stays the caller's until the relay's answer is in hand: a
         * failed attempt leaves it here with its seq, and the next round
         * re-sends it unchanged — the relay answers the redelivery without
         * applying it twice. The room's answer must carry a document for the
         * batch's round and a document-or-null for a read: anything else is
         * malformed, and malformed is a thrown error, never an `undefined`
         * the page would load.
         *
         * @param {() => string} localBytes The page's current document, as bytes.
         * @param {(document: string) => void} adopt Takes the room's document.
         * @param {(refusals: string[]) => void} onRefusals The batch's named answers.
         * @returns {Promise<void>}
         */
        async sync(localBytes, adopt, onRefusals) {
            if (attempting) {
                // The attempt that owns the air is the one whose answer
                // settles the batch; a second round must not fire another
                // POST of it, and must not read the room either — the room's
                // answer cannot include the batch that is still unaccounted
                // for, and adopting it would flash the page back.
                return;
            }
            if (sentBatch !== null || queue.length > 0) {
                if (sentBatch === null) {
                    sentSeq = seq + 1;
                    sentBatch = queue;
                    queue = [];
                }
                attempting = true;
                try {
                    const answer = await post(door("actions"), {
                        clientId,
                        seq: sentSeq,
                        actions: sentBatch,
                    });
                    if (typeof answer.document !== "string") {
                        throw new Error("the answer carries no document");
                    }
                    // The ACK: from here the batch is the relay's problem —
                    // applied, or refused by name with the answer that says
                    // so. What the user drew while this batch flew is already
                    // in `queue`, and it rides the next one.
                    // The batch's own answer opens and closes the conflict: a
                    // whole-document snapshot the room refused as stale opens
                    // it; a whole-document snapshot the room took closes it —
                    // keep-local, said by the act of drawing. The batch is
                    // still the link's here: the conflict reads it before the
                    // ACK lets go of it.
                    sentBatch.forEach((action, index) => {
                        if (action.op !== "document") {
                            return;
                        }
                        if (answer.refused[index] === "stale_document") {
                            conflict = { tag: "stale_document", base: action.base ?? null, room: answer.revision ?? null };
                        } else if (answer.refused[index] === null) {
                            conflict = null;
                        }
                    });
                    seq = sentSeq;
                    sentBatch = null;
                    sentSeq = null;
                    documentFallback = false;
                    if (typeof answer.revision === "string") {
                        roomRevision = answer.revision;
                    }
                    knownBytes = answer.document;
                    if (conflict === null && answer.document !== localBytes()) {
                        adopt(answer.document);
                    }
                    if (answer.refused.some((tag) => tag !== null)) {
                        onRefusals(answer.refused);
                    }
                } finally {
                    attempting = false;
                }
                return;
            }
            const answer = await get(documentDoor());
            if (answer.document !== null && typeof answer.document !== "string") {
                throw new Error("the answer carries no document");
            }
            // A read the room answered without its document (the revision it
            // knows still stood) has nothing to compare and nothing to adopt:
            // the whole idle round is one small question and a small answer.
            // With a conflict open the room's documents are held at arm's
            // length — the user's edit is the thing a refusal protected, and
            // a read must not finish what the room refused to do.
            if (typeof answer.revision === "string") {
                roomRevision = answer.revision;
            }
            if (conflict === null && answer.document !== null && answer.document !== knownBytes && answer.document !== localBytes()) {
                knownBytes = answer.document;
                adopt(answer.document);
            }
        },

        /**
         * Say where this page's pointer is, and hear back who else is here.
         *
         * @param {number} x Screen x.
         * @param {number} y Screen y.
         * @param {string} name The name the room shows beside the pointer.
         * @returns {Promise<Array<{id: string, x: number, y: number, name: string}>>} The alive peers.
         */
        async presence(x, y, name, selectedIds) {
            const state = {
                x,
                y,
                name,
                ...(Array.isArray(selectedIds) ? { selectedIds } : {}),
            };
            const body = presenceCodec === undefined
                ? { id: clientId, ...state }
                : { id: clientId, blob: await presenceCodec.seal(state) };
            const answer = await post(door("presence"), body);
            return openPeers(answer.peers);
        },

        /**
         * Hear who is here without saying anything (the poll's other half).
         *
         * @returns {Promise<Array<{id: string, x: number, y: number, name: string}>>}
         */
        async who() {
            const answer = await get(door("presence"));
            return openPeers(answer.peers);
        },

        /**
         * Join the room with this page's document, if the room is empty.
         *
         * The first client plants its drawing; a joiner into an occupied
         * room **adopts the room's document on the spot** — remembering the
         * bytes without loading them would leave the page empty while the
         * link believed it was in step. The call answers `false` for a
         * joiner, which is a normal outcome and not an error.
         *
         * @param {() => string} localBytes The page's current document.
         * @param {(document: string) => void} adopt Takes the room's document.
         * @returns {Promise<boolean>} Whether the room took the document.
         */
        async plant(localBytes, adopt) {
            const probe = await get(documentDoor());
            if (probe.document !== null && typeof probe.document !== "string") {
                throw new Error("the answer carries no document");
            }
            if (typeof probe.revision === "string") {
                roomRevision = probe.revision;
            }
            conflict = null;
            if (probe.document !== null) {
                knownBytes = probe.document;
                if (probe.document !== localBytes()) {
                    adopt(probe.document);
                }
                return false;
            }
            const answer = await post(door("document"), { document: localBytes() });
            if (typeof answer.document !== "string") {
                throw new Error("the answer carries no document");
            }
            if (typeof answer.revision === "string") {
                roomRevision = answer.revision;
            }
            knownBytes = answer.document;
            return true;
        },
    };
}
