// Remote presence: who else is here, and where their pointers are.
//
// # What this is
//
// The ephemeral half of collaboration. The document has an authority and a
// contract (ADR-007); presence has neither — it is a client-side map of the
// other people in the room, and every fact in it is a *claim about right
// now* that dies on silence. Upstream draws its collaborators' pointers on
// the interactive canvas (`interactiveScene.ts:70`) and their laser trails
// with the very same `AnimatedTrail` the local laser uses
// (`laserTrails.ts`, `collabTrails`), which is the confirmation that
// presence and the laser are the same shape of thing: state that lives in
// the client, fades with the clock, and never reaches the kernel.
//
// # The rule the module follows
//
// **Silence is departure.** A peer is alive while its updates keep coming
// and for `PRESENCE_TIMEOUT_MS` after the last one; the next read prunes
// whatever outlived that. There is no ack, no retry and no queue, which is
// why a lost message cannot block anyone: presence has nothing to
// acknowledge, and the next update simply overwrites the map. An explicit
// `peerLeft` is the fast path — the peer is gone *now*, without waiting out
// its clock.
//
// The prune happens on read, exactly as `client/laser.mjs` prunes its
// trail: the map stays bounded by the clock without a timer to cancel, and
// a room nobody asks about costs nothing.
//
// # What this deliberately is not
//
// Not wired. The transport that feeds `peerUpdate` is TASK-13's; until a
// socket calls in, the room is empty and stays empty — wiring the paint
// today would ship a branch nothing can fill. The kernel never hears about
// any of this: no `Scene` entry, no history entry, no byte of the document
// changes because a cursor moved, which is the contract the task card
// states and this module makes true by construction.

/**
 * How long a peer stays on the map after its last update.
 *
 * Upstream delegates the number to yjs awareness (the mechanism — expire on
 * silence — is upstream's; the value lives in that dependency, not in the
 * pinned source), so the port declares its own: thirty seconds, the value
 * the awareness default carries, slow enough not to blink on a laggy link
 * and fast enough that a closed tab does not haunt the room.
 *
 * @type {number}
 */
export const PRESENCE_TIMEOUT_MS = 30_000;

/**
 * A presence room: the other pointers, and nothing else.
 *
 * @returns {object} The room.
 */
export function createPresenceRoom() {
    /** @type {Map<string, {x: number, y: number, at: number, name?: string, selectedIds: string[]}>} */
    const peers = new Map();
    return {
        /**
         * A peer's pointer moved, or was first seen.
         *
         * The update is the whole truth about that peer: there is no delta
         * to apply and no state to reconcile, so a peer that reconnects
         * after a gap just overwrites its own row.
         *
         * @param {string} id The peer's stable id.
         * @param {number} x Screen x.
         * @param {number} y Screen y.
         * @param {number} nowMs The clock, in milliseconds.
         * @param {{name?: string, selectedIds?: string[]}} [details] Ephemeral peer UI state.
         * @returns {void}
         */
        peerUpdate(id, x, y, nowMs, details = {}) {
            peers.set(id, {
                x,
                y,
                at: nowMs,
                ...(typeof details.name === "string" ? { name: details.name } : {}),
                ...(Array.isArray(details.selectedIds)
                    ? { selectedIds: details.selectedIds.filter((selectedId) => typeof selectedId === "string") }
                    : {}),
            });
        },

        /**
         * A peer said goodbye, or the transport saw the connection close.
         *
         * The peer is gone immediately — the fast path next to the clock's
         * slow one.
         *
         * @param {string} id The peer's stable id.
         * @returns {void}
         */
        peerLeft(id) {
            peers.delete(id);
        },

        /**
         * The peers still alive at `nowMs`, pruned in place.
         *
         * @param {number} nowMs The clock, in milliseconds.
         * @returns {Array<{id: string, x: number, y: number}>} Oldest first.
         */
        peers(nowMs) {
            for (const [id, peer] of peers) {
                if (nowMs - peer.at >= PRESENCE_TIMEOUT_MS) {
                    peers.delete(id);
                }
            }
             return [...peers.entries()].map(([id, peer]) => ({
                id,
                x: peer.x,
                y: peer.y,
                ...(peer.name === undefined ? {} : { name: peer.name }),
                ...(peer.selectedIds === undefined ? {} : { selectedIds: [...peer.selectedIds] }),
            }));
        },

        /**
         * Whether anyone is alive at `nowMs`.
         *
         * The question the paint loop asks to decide whether to keep the
         * presence frames coming — the same self-stopping question the
         * laser's trail answers, and a room with nobody in it costs one
         * prune and nothing else.
         *
         * @param {number} nowMs The clock, in milliseconds.
         * @returns {boolean}
         */
        alive(nowMs) {
            return this.peers(nowMs).length > 0;
        },
    };
}

/**
 * The colour a peer's pointer draws with, upstream's own derivation.
 *
 * `getClientColor` (`packages/excalidraw/clients.ts`): hash the id, take
 * `hue = (hash % 37) * 10` — thirty-seven hues at step ten — and answer
 * `hsl(hue, 100%, 83%)`. The hash is this port's own (which peer lands on
 * which hue is not the contract; that every peer lands on one of the same
 * thirty-seven *is*), so a peer's colour is stable for the whole session
 * and two peers in one room can share a hue only by landing on the same
 * bucket — the same chance upstream has.
 *
 * @param {string} id The peer's stable id.
 * @returns {string} An `hsl()` colour.
 */
export function peerColor(id) {
    let hash = 0;
    for (let index = 0; index < id.length; index += 1) {
        hash = (hash * 31 + id.charCodeAt(index)) | 0;
    }
    const hue = (Math.abs(hash) % 37) * 10;
    return `hsl(${hue}, 100%, 83%)`;
}
