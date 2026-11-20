// The typed semantic facade: the door readers, the keyboard and agents share.
//
// It is narrow on purpose. The caller never receives the Session: it asks for
// a summary, a filtered query, one element, its connections or a selection,
// and every answer is the same shape `{status, affectedIds, changes, undoable,
// reason}`. Arguments are validated here, fail-closed: a bad id, a filter the
// contract does not have, too many ids — each is a typed refusal with no side
// effect, not an exception and not a partial write.
//
// Mutating operations are declared and refused with `not_implemented` (the
// next increment, TASK-186, adds them over the same domain operations); this
// module must never grow a second copy of the editing rules.

import { summarizeScene } from "./semantic-description.mjs";

const MAX_IDS = 1000;
const MAX_LIMIT = 200;
const MAX_TEXT = 200;
const RELATIONS = new Set([
    "next", "previous", "parent", "children", "incoming", "outgoing",
    "left", "right", "up", "down",
]);
const PLACE_KINDS = new Set(["rectangle", "ellipse", "diamond"]);
const PLACE_SIDES = new Set(["right", "left", "above", "below"]);
const ALIGNMENTS = new Set(["start", "center", "end"]);

const ok = (extra = {}) => ({
    status: "ok", affectedIds: [], changes: null, undoable: false, reason: null, ...extra,
});
const refused = (reason) => ({
    status: "refused", affectedIds: [], changes: null, undoable: false, reason,
});

const isText = (value) => typeof value === "string" && value.length > 0 && value.length <= MAX_TEXT;

/**
 * Build the facade over a session.
 *
 * @param {{session: object, viewOnly?: () => boolean}} options
 * @returns {{getSceneSummary: Function, queryElements: Function, getElement: Function,
 *            getConnections: Function, navigate: Function, selectElements: Function,
 *            moveElement: Function, deleteElement: Function, setElementMeta: Function}}
 */
export function createSemanticFacade({ session, viewOnly = () => false, newId = () => crypto.randomUUID(), snapshots = null }) {
    // One crossing per (session, revision) when the page shares its cache;
    // the facade never asks the kernel twice for the same document.
    const read = () => JSON.parse(
        snapshots === null ? session.semanticSnapshot() : snapshots.snapshot(session),
    );
    const ask = (id, relation) => JSON.parse(session.semanticNavigate(id, relation));
    const mutationRefusal = (id) => {
        if (!isText(id)) {
            return refused("bad_id");
        }
        if (viewOnly()) {
            return refused("view_only");
        }
        const element = read().elements.find((candidate) => candidate.id === id);
        if (element === undefined) {
            return refused("unknown_id");
        }
        if (element.locked === true) {
            return refused("locked");
        }
        return refused("not_implemented");
    };

    return {
        getSceneSummary() {
            // The summary is counts, never the scene: a reader or an agent
            // gets the shape, and asks for elements one bounded page at a time.
            return ok({ data: summarizeScene(read()) });
        },
        queryElements(filter = {}) {
            if (filter === null || typeof filter !== "object" || Array.isArray(filter)) {
                return refused("bad_filter");
            }
            const keys = Object.keys(filter);
            if (!keys.every((key) => ["kind", "offset", "limit"].includes(key))) {
                return refused("bad_filter");
            }
            if (filter.kind !== undefined && !isText(filter.kind)) {
                return refused("bad_filter");
            }
            if (filter.offset !== undefined && (!Number.isInteger(filter.offset) || filter.offset < 0)) {
                return refused("bad_filter");
            }
            if (filter.limit !== undefined && (!Number.isInteger(filter.limit) || filter.limit < 1 || filter.limit > MAX_LIMIT)) {
                return refused("bad_filter");
            }
            const answer = JSON.parse(session.semanticQuery(JSON.stringify(filter)));
            return ok({ data: answer });
        },
        getElement(id) {
            if (!isText(id)) {
                return refused("bad_id");
            }
            const snapshot = read();
            const element = snapshot.elements.find((candidate) => candidate.id === id);
            return element === undefined ? refused("unknown_id") : ok({ data: element });
        },
        getConnections(id) {
            if (!isText(id)) {
                return refused("bad_id");
            }
            const elements = read().elements;
            const element = elements.find((candidate) => candidate.id === id);
            if (element === undefined) {
                return refused("unknown_id");
            }
            // The arrows already carry their bindings in the snapshot the
            // cache just gave us; asking the kernel twice would project the
            // scene twice for an answer we hold.
            const outgoing = { targets: [], freeEnd: false };
            const incoming = { targets: [], freeEnd: false };
            for (const candidate of elements) {
                if (candidate.directed !== true) {
                    continue;
                }
                const start = candidate.bindings?.start ?? null;
                const end = candidate.bindings?.end ?? null;
                if (start === id) {
                    outgoing.freeEnd = outgoing.freeEnd || end === null;
                    if (end !== null && !outgoing.targets.includes(end)) {
                        outgoing.targets.push(end);
                    }
                }
                if (end === id) {
                    incoming.freeEnd = incoming.freeEnd || start === null;
                    if (start !== null && !incoming.targets.includes(start)) {
                        incoming.targets.push(start);
                    }
                }
            }
            return ok({ data: { outgoing, incoming } });
        },
        navigate(id, relation) {
            if (!isText(id)) {
                return refused("bad_id");
            }
            if (!RELATIONS.has(relation)) {
                return refused("bad_relation");
            }
            if (!read().elements.some((candidate) => candidate.id === id)) {
                return refused("unknown_id");
            }
            const answer = ask(id, relation);
            return ok({ data: { targets: answer.targets, freeEnd: answer.freeEnd } });
        },
        selectElements(ids) {
            if (!Array.isArray(ids) || ids.length > MAX_IDS || !ids.every(isText)) {
                return refused("bad_ids");
            }
            const elements = read().elements;
            const unknown = ids.find((id) => !elements.some((element) => element.id === id));
            if (unknown !== undefined) {
                return refused("unknown_id");
            }
            // The kernel drops locked elements from the selection; saying "ok"
            // with them would make the reader hear a selection that never
            // happened. Only the selectable ids are reported.
            const selectable = ids.filter((id) => elements.find((element) => element.id === id)?.locked !== true);
            if (selectable.length === 0 && ids.length > 0) {
                return refused("not_selectable");
            }
            session.setSelection(selectable);
            return ok({ affectedIds: [...selectable], undoable: false });
        },
        // Declared, refused, and reserved for the next increment over the same
        // domain operations — not a second copy of the editing rules. The
        // validation a caller can rely on today is the one the answers share:
        // the id must exist, the element must not be locked and the page must
        // allow edits; a locked element is named, not silently accepted.
        /** Take the last history entry back; the one undo the guided flow uses. */
        undo() {
            if (viewOnly()) {
                return refused("view_only");
            }
            try {
                session.undo();
            } catch (error) {
                return refused(`rejected: ${error?.message ?? error}`);
            }
            return ok({ undoable: false });
        },
        /**
         * Place a new shape beside `anchorId`, by relation, without absolute
         * coordinates (TASK-186). Geometry comes from the anchor's scene box;
         * the insert is the kernel's one door, and its one undo entry.
         */
        placeRelative({ anchorId, kind = "rectangle", relation = "right", gap = 24, alignment = "start" } = {}) {
            if (!isText(anchorId) || !PLACE_KINDS.has(kind) || !PLACE_SIDES.has(relation)
                || !Number.isFinite(gap) || gap < 0 || gap > 1000 || !ALIGNMENTS.has(alignment)) {
                return refused("bad_arguments");
            }
            if (viewOnly()) {
                return refused("view_only");
            }
            const anchor = read().elements.find((element) => element.id === anchorId);
            if (anchor === undefined) {
                return refused("unknown_id");
            }
            if (anchor.locked === true) {
                return refused("locked");
            }
            if (anchor.capabilities?.editable === false) {
                return refused("not_editable");
            }
            const width = 120;
            const height = 80;
            const box = anchor.bounds;
            const aligned = (start, span, size) => start + (alignment === "start" ? 0 : alignment === "center" ? (span - size) / 2 : span - size);
            const placed = relation === "right"
                ? { x: box.x + box.width + gap, y: aligned(box.y, box.height, height) }
                : relation === "left"
                    ? { x: box.x - gap - width, y: aligned(box.y, box.height, height) }
                    : relation === "above"
                        ? { x: aligned(box.x, box.width, width), y: box.y - gap - height }
                        : { x: aligned(box.x, box.width, width), y: box.y + box.height + gap };
            const id = newId();
            const element = {
                id,
                type: kind,
                x: placed.x,
                y: placed.y,
                width,
                height,
                angle: 0,
                seed: 1,
                version: 1,
                groupIds: [],
                frameId: null,
                strokeColor: "#1e1e1e",
                backgroundColor: "transparent",
                fillStyle: "solid",
                strokeStyle: "solid",
                strokeWidth: 2,
                opacity: 100,
                locked: false,
            };
            try {
                session.insert(JSON.stringify(element), undefined);
            } catch (error) {
                return refused(`rejected: ${error?.message ?? error}`);
            }
            session.setSelection([id]);
            return ok({ affectedIds: [id], undoable: true });
        },
        /**
         * Connect two existing elements with an arrow whose two ends carry the
         * bindings (TASK-186). The ends are computed from the boxes; the domain
         * keeps the arrow, so the semantic graph sees the relation.
         */
        connectElements({ sourceId, targetId, label } = {}) {
            if (!isText(sourceId) || !isText(targetId)) {
                return refused("bad_arguments");
            }
            if (label !== undefined && label !== null && String(label).trim() !== "") {
                return refused("label_not_supported");
            }
            if (viewOnly()) {
                return refused("view_only");
            }
            const snapshot = read();
            const source = snapshot.elements.find((element) => element.id === sourceId);
            const target = snapshot.elements.find((element) => element.id === targetId);
            if (source === undefined || target === undefined || sourceId === targetId) {
                return refused("unknown_id");
            }
            if (source.locked === true || target.locked === true) {
                return refused("locked");
            }
            if (source.capabilities?.editable === false || target.capabilities?.editable === false) {
                return refused("not_editable");
            }
            const start = { x: source.bounds.x + source.bounds.width, y: source.bounds.y + source.bounds.height / 2 };
            const end = { x: target.bounds.x, y: target.bounds.y + target.bounds.height / 2 };
            const id = newId();
            const element = {
                id,
                type: "arrow",
                x: start.x,
                y: start.y,
                width: end.x - start.x,
                height: end.y - start.y,
                angle: 0,
                seed: 1,
                version: 1,
                groupIds: [],
                frameId: null,
                points: [[0, 0], [end.x - start.x, end.y - start.y]],
                startBinding: { elementId: sourceId, focus: 0, gap: 4 },
                endBinding: { elementId: targetId, focus: 0, gap: 4 },
                startArrowhead: null,
                endArrowhead: "arrow",
                elbowed: false,
                strokeColor: "#1e1e1e",
                backgroundColor: "transparent",
                fillStyle: "solid",
                strokeStyle: "solid",
                strokeWidth: 2,
                opacity: 100,
                locked: false,
            };
            try {
                session.insert(JSON.stringify(element), undefined);
            } catch (error) {
                return refused(`rejected: ${error?.message ?? error}`);
            }
            session.setSelection([id]);
            return ok({ affectedIds: [id], undoable: true });
        },
        moveElement(id) {
            return mutationRefusal(id);
        },
        deleteElement(id) {
            return mutationRefusal(id);
        },
        /**
         * Set the author's name, alternative text and description through the
         * domain action (TASK-187). Absent fields are left alone; an empty
         * string clears; third-party `customData` survives.
         */
        setElementMeta(id, meta = {}) {
            if (!isText(id)) {
                return refused("bad_id");
            }
            if (meta === null || typeof meta !== "object" || Array.isArray(meta)) {
                return refused("bad_meta");
            }
            const keys = Object.keys(meta);
            if (!keys.every((key) => ["name", "alt", "description"].includes(key))) {
                return refused("bad_meta");
            }
            for (const [key, value] of Object.entries(meta)) {
                const max = key === "description" ? 2000 : 500;
                if (typeof value !== "string" || value.length > max) {
                    return refused("bad_meta");
                }
            }
            if (viewOnly()) {
                return refused("view_only");
            }
            const element = read().elements.find((candidate) => candidate.id === id);
            if (element === undefined) {
                return refused("unknown_id");
            }
            if (element.locked === true) {
                return refused("locked");
            }
            if (element.capabilities?.editable === false) {
                return refused("not_editable");
            }
            try {
                session.setElementMeta([id], JSON.stringify(meta));
            } catch (error) {
                return refused(`rejected: ${error?.message ?? error}`);
            }
            return ok({ affectedIds: [id], undoable: true });
        },
    };
}
