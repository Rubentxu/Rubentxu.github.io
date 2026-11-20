// The shared room's wiring: the link, the join, the sync round and the pointer's presence.
//
// # What this file is
//
// Everything collaboration is, for a page that was handed `options.room`. Without a room
// the page never calls this file and runs exactly as it always did: one editor, one
// kernel, no network. The policy lives in `client/collab.mjs` (the link) and
// `client/presence.mjs` (who is where); what is here is the wiring between them and the
// page's session, status line and canvas.
//
// # The two sessions
//
// The page keeps using the **instrumented** session, so every user edit reports itself
// to the link. The room's documents are adopted through the **raw** one, because a
// document the room sent is not this client's edit: loaded through the wrapper it would
// record itself as a mutation and the next batch would re-send the page's own view, the
// echo eating the room. The raw session is a thunk (`currentRawSession`) because a panic
// rebuilds it and the round must drive the new one.
//
// The canvas context is a thunk for another reason: the page makes it after the room is
// joined, and every use here happens later than that.
//
// # What it hands back
//
// `{ collabLink, record, session }`: the link (the idle waiter reads it), the recorder
// (the panic recovery instruments the session it rebuilds with it) and the instrumented
// session the page goes on with.

import { createCollabLink, instrumentSession } from "./collab.mjs";
import { createRoomKeyCodec } from "./room-key.mjs";
import { createPresenceRoom } from "./presence.mjs";

/** The least gap between two presence posts, in ms: a 120 Hz mouse must not be a 120 Hz relay load. */
const PRESENCE_THROTTLE_MS = 60;

/**
 * Join the room the embedder named.
 *
 * @param {object} deps what the page owns, by name.
 * @returns {{ collabLink: object, record: Function, session: object }}
 */
export function joinRoom(deps) {
    const {
        room, session: kernelSession, currentRawSession, currentCtx, canvas, lifecycle,
        paint, statusLine, renderStatus, nowMs, setPresencePeers, setLocalPeerId, fetch,
    } = deps;
    const clientId = room.client ?? `peer-${crypto.randomUUID().slice(0, 8)}`;
    setLocalPeerId?.(clientId);
    // The relay's answer, read the way HTTP means it: a status outside 2xx is
    // a refusal said by name, and a body the parser cannot read is another
    // one. Both reach the link as thrown errors — never as an object with an
    // `undefined` document that the link would load as if it were the room.
    const asAnswer = async (answer) => {
        if (!answer.ok) {
            throw new Error(`the relay refused with ${answer.status ?? "an unknown status"}`);
        }
        try {
            return await answer.json();
        } catch {
            throw new Error("the relay's answer does not parse as JSON");
        }
    };
    // The room key, when the link carried one: presence crosses as ciphertext the relay
    // cannot read. The document channel stays in clear — the authority applies actions,
    // and that is the trade ADR-007 wrote down.
    const roomKey = room.key ?? null;
    const roomKeyCodec = roomKey === null ? null : createRoomKeyCodec();
    const collabLink = createCollabLink({
        roomUrl: room.url,
        roomId: room.name,
        clientId,
        ...(room.token === undefined ? {} : { token: room.token }),
        post: (path, body) =>
            fetch(path, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(body),
            }).then(asAnswer),
        get: (path) => fetch(path).then(asAnswer),
        ...(roomKeyCodec === null ? {} : {
            presenceCodec: {
                seal: (value) => roomKeyCodec.seal(roomKey, value),
                open: (sealed) => roomKeyCodec.open(roomKey, sealed),
            },
        }),
    });
    const record = (verb, args) => {
        const rawSession = currentRawSession();
        collabLink.record(verb, args, () => JSON.parse(rawSession.toJson()));
    };
    const session = instrumentSession(kernelSession, record);
    // Join: plant this page's drawing if the room is empty; otherwise adopt the room's.
    // Either way the sync loop takes it from here.
    collabLink
        .plant(
            () => currentRawSession().toJson(),
            (doc) => currentRawSession().loadJson(doc),
        )
        .then(() => paint(currentRawSession(), currentCtx()))
        .catch((error) => {
            statusLine.setProblem(`collab: ${error.message ?? error}`);
            renderStatus();
        });
    // The round: send what the user drew, take what the room knows. A refusal comes back
    // named (the frontier's own vocabulary) and lands on the status line — the drawing is
    // never blocked by it. One round at a time: a round whose answer is slow
    // is not started again by the interval — a second round would read the
    // room without the batch it is still sending, and the presence poll
    // behind it would double its steps.
    let roundInFlight = false;
    const syncRound = async () => {
        if (roundInFlight) {
            return;
        }
        roundInFlight = true;
        try {
            await collabLink.sync(
                () => currentRawSession().toJson(),
                (doc) => {
                    const rawSession = currentRawSession();
                    rawSession.loadJson(doc);
                    paint(rawSession, currentCtx());
                },
                (refusals) => {
                    const named = refusals.find((tag) => tag !== null);
                    statusLine.setNotice(`collab: un cambio no pudo aplicarse (${named}).`, true);
                    renderStatus();
                },
            );
            const peers = await collabLink.who();
            const presence = createPresenceRoom();
            setPresencePeers(presence);
            for (const peer of peers) {
                if (peer.id !== clientId) {
                    presence.peerUpdate(peer.id, peer.x, peer.y, nowMs(), {
                        name: peer.name,
                        selectedIds: peer.selectedIds,
                    });
                }
            }
        } catch {
            // The relay is down. Local-first is the contract (ADR-006): the page keeps
            // editing, the loop keeps trying, and there is nothing to report that the user
            // has to act on.
        } finally {
            roundInFlight = false;
        }
    };
    const roundTimer = setInterval(syncRound, room.pollMs ?? 700);
    lifecycle.onDestroy(() => clearInterval(roundTimer));
    // This page's pointer, said where it is.
    let lastPresenceAt = 0;
    canvas.addEventListener("pointermove", (event) => {
        const at = nowMs();
        if (at - lastPresenceAt < PRESENCE_THROTTLE_MS) {
            return;
        }
        lastPresenceAt = at;
        collabLink
            .presence(
                event.clientX,
                event.clientY,
                room.user ?? clientId,
                session.selectedIds?.() ?? [],
            )
            .catch(() => {});
    }, { signal: lifecycle.signal });
    return { collabLink, record, session };
}
