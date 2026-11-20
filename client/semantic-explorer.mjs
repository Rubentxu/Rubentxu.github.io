// The accessible explorer: the scene as a tree a reader can walk.
//
// The canvas stays the renderer; this panel is a view built on demand from the
// semantic snapshot (TASK-179). It does not represent the scene twice: every
// element appears in exactly one place — under its frame, under the group
// chain that holds it inside that frame, or in the flat list — and the tree
// nests as deeply as the scene does: a frame inside a frame, a group inside a
// group. A branch renders its children only when it is expanded, so a scene
// with thousands of elements is a handful of root nodes, not a DOM node per
// shape (TASK-180, TASK-192).
//
// Exploration focus is not the drawing's selection. Moving through the tree
// changes nothing in the document; selecting an element is an explicit action
// (Enter or Space) that the caller performs through its own door. That is why
// `open` takes an `onSelect` callback and not a session.

import { describeElement, describeExtras, describeScene } from "./semantic-description.mjs";
import { createAnnouncer } from "./semantic-announcer.mjs";

/** How many children one expanded branch (or one search) renders at once. */
export const PAGE_SIZE = 50;

/**
 * The tree model, pure: no DOM, no session, no selection.
 *
 * The scene is one hierarchy, not a list of roots: a frame inside a frame is a
 * child of the outer frame, and the membership chain `groups` (innermost
 * first, as the scene stores it) is a chain of nested group branches. Every
 * element is placed once — a frame is both a branch and its own treeitem, and
 * a member is a leaf of the innermost branch that holds it.
 *
 * `branches` is every branch, flattened in pre-order, for lookup and for the
 * model's callers; `roots` is the top of the hierarchy the panel renders.
 * `placements` carries the branch, the direct position and the branch path to
 * expand, so revealing a collapsed destination never guesses.
 *
 * @param {{version: number, elements: object[]}} snapshot the contract v1 JSON, parsed.
 * @param {{query?: string, limit?: number, limits?: Record<string, number>|null}} [options]
 * @returns {{query: string, roots: object[], branches: object[], search: object|null, placements: object}}
 */
export function buildTree(snapshot, { query = "", limit = PAGE_SIZE, limits = null } = {}) {
    if (snapshot === null || typeof snapshot !== "object" || snapshot.version !== 1 || !Array.isArray(snapshot.elements)) {
        throw new Error("semantic_tree_invalid: the snapshot is not contract version 1");
    }
    const elements = snapshot.elements;
    const labelOf = (element) => element.label?.text ?? `${element.kind} ${element.id}`;
    const entry = (element) => ({ id: element.id, kind: element.kind, label: labelOf(element) });
    const needle = query.trim().toLowerCase();
    if (needle !== "") {
        const hits = elements.filter((element) =>
            labelOf(element).toLowerCase().includes(needle) || String(element.kind).toLowerCase().includes(needle));
        const page = limits?.search ?? limit;
        return {
            query,
            roots: [],
            branches: [],
            search: {
                total: hits.length,
                items: hits.slice(0, page).map(entry),
                truncated: hits.length > page,
            },
            placements: {},
        };
    }
    // Drawing order, used only to keep siblings in the scene's order. The
    // contract's `order` is the scene's own; an element without it falls back
    // to its position in the snapshot.
    const order = new Map(elements.map((element, index) =>
        [element.id, typeof element.order === "number" ? element.order : index]));
    const position = (element) => order.get(element.id) ?? 0;
    const frames = elements.filter((element) => element.container === true);
    const frameIds = new Set(frames.map((frame) => frame.id));
    // Membership by frame: a frame is never a child of another frame *in the
    // engine*, but a snapshot from elsewhere may say it is, and the tree has
    // to show what the snapshot says. Cycles are broken into roots so a
    // malformed document cannot lose an element or loop forever.
    const frameParent = new Map();
    for (const frame of frames) {
        const parent = typeof frame.frame === "string" && frame.frame !== frame.id && frameIds.has(frame.frame)
            ? frame.frame
            : null;
        frameParent.set(frame.id, parent);
    }
    for (const frame of frames) {
        const seen = new Set();
        let current = frame.id;
        while (current !== null && current !== undefined) {
            if (seen.has(current)) {
                frameParent.set(current, null);
                break;
            }
            seen.add(current);
            current = frameParent.get(current) ?? null;
        }
    }
    for (const element of elements) {
        if (element.container === true) {
            continue;
        }
        frameParent.set(element.id, typeof element.frame === "string" && frameIds.has(element.frame)
            ? element.frame
            : null);
    }
    const frameChildren = new Map();
    for (const element of elements) {
        const parent = frameParent.get(element.id);
        if (parent === undefined || parent === null) {
            continue;
        }
        const children = frameChildren.get(parent) ?? [];
        children.push(element);
        frameChildren.set(parent, children);
    }
    // Groups: the stored chain is innermost first, so the tree grows it from
    // the last id (the outermost branch) down to the first. The branch id is
    // the whole path, including the scope it lives in: the same group id can
    // sit at two different depths or in two different frames (membership is
    // per element), and a path keeps the branches apart without giving a
    // member two homes.
    const chainOf = (groups) => {
        if (!Array.isArray(groups)) {
            return [];
        }
        const chain = [];
        for (const group of groups) {
            if (typeof group === "string" && group !== "" && !chain.includes(group)) {
                chain.push(group);
            }
        }
        return chain.reverse();
    };
    const groupNodes = new Map();
    const placeOfNode = (node) => {
        let place = node.members.reduce((lowest, member) => Math.min(lowest, position(member)), Infinity);
        for (const child of node.children) {
            place = Math.min(place, placeOfNode(child));
        }
        node.position = place;
        return place;
    };
    // Attach one scope's elements to its chains. A scope is the top level or
    // one frame; `prefix` is the branch id the groups hang from, so a group
    // inside a frame is nested under that frame and not at the root.
    const attach = (parent, prefix, members) => {
        for (const element of members) {
            const chain = chainOf(element.groups);
            if (chain.length === 0) {
                parent.members.push(element);
                continue;
            }
            let current = parent;
            let path = prefix;
            for (const group of chain) {
                path = path === "" ? `group:${group}` : `${path}/group:${group}`;
                let node = groupNodes.get(path);
                if (node === undefined) {
                    node = {
                        id: path,
                        type: "group",
                        title: group,
                        elementId: null,
                        members: [],
                        children: [],
                        position: Infinity,
                    };
                    groupNodes.set(path, node);
                    current.children.push(node);
                }
                current = node;
            }
            current.members.push(element);
        }
    };
    // A frame branch is its own treeitem and the branch of what it contains,
    // including the groups its children belong to.
    const frameNode = (frame, parent) => {
        const node = {
            id: parent === null ? `frame:${frame.id}` : `${parent.id}/frame:${frame.id}`,
            type: "frame",
            title: labelOf(frame),
            elementId: frame.id,
            members: [],
            children: [],
            position: position(frame),
        };
        const children = frameChildren.get(frame.id) ?? [];
        for (const child of children) {
            if (child.container === true) {
                node.children.push(frameNode(child, node));
            }
        }
        attach(node, node.id, children.filter((child) => child.container !== true));
        return node;
    };
    const rootFrames = frames
        .filter((frame) => (frameParent.get(frame.id) ?? null) === null)
        .map((frame) => frameNode(frame, null));
    const topLevel = elements.filter((element) =>
        !frameIds.has(element.id) && (frameParent.get(element.id) ?? null) === null);
    const topScope = { members: [], children: [] };
    attach(topScope, "", topLevel);
    for (const node of groupNodes.values()) {
        node.position = placeOfNode(node);
    }
    const loose = topScope.members;
    const elementsNode = {
        id: "elements",
        type: "elements",
        title: "elements",
        elementId: null,
        members: loose,
        children: [],
        position: loose.length === 0 ? Infinity : Math.min(...loose.map(position)),
    };
    const rawRoots = [...rootFrames, ...topScope.children, elementsNode]
        .sort((left, right) => left.position - right.position);
    const branches = [];
    const placements = {};
    const finalize = (node, ancestors, depth, posinset, setsize) => {
        const branch = {
            id: node.id,
            type: node.type,
            title: node.title,
            depth,
            posinset,
            setsize,
            count: 0,
            members: [],
            items: [],
            truncated: false,
            children: [],
            childSetsize: 0,
            ...(node.elementId === null ? {} : { elementId: node.elementId }),
        };
        branches.push(branch);
        const children = [...node.children].sort((left, right) => left.position - right.position);
        branch.childSetsize = children.length + node.members.length;
        const nested = [...ancestors, node.id];
        branch.children = children.map((child, index) =>
            finalize(child, nested, depth + 1, index + 1, branch.childSetsize));
        branch.members = node.members.map((element, index) => ({
            ...entry(element),
            depth: depth + 1,
            setsize: branch.childSetsize,
            posinset: children.length + index + 1,
        }));
        const page = limits?.[node.id] ?? limit;
        branch.items = branch.members.slice(0, page);
        branch.truncated = branch.members.length > page;
        // A nested frame is an element under its parent *and* a branch with
        // its own content, so the container counts it once this way.
        branch.count = node.members.length + branch.children.reduce(
            (sum, child) => sum + child.count + (child.type === "frame" ? 1 : 0),
            0,
        );
        if (node.elementId !== null) {
            // A frame's treeitem is its own element; expanding its ancestors
            // is enough to mount it. Its content still has placements of its
            // own, set below.
            placements[node.elementId] = { branch: node.id, index: 0, depth, path: ancestors, isBranch: true };
        }
        node.members.forEach((element, index) => {
            placements[element.id] = {
                branch: node.id,
                index,
                depth: depth + 1,
                path: nested,
                isBranch: false,
            };
        });
        return branch;
    };
    const roots = rawRoots.map((node, index) => finalize(node, [], 1, index + 1, rawRoots.length));
    return { query: "", roots, branches, search: null, placements };
}

/**
 * The panel: a lazily built region with a search box, a `role=tree` and a live
 * status line.
 *
 * @param {{document: Document, say: (key: string, fallback: string) => string}} options
 * @returns {{open: (snapshot: string, onSelect: (id: string) => void) => void,
 *            close: () => void, isOpen: () => boolean}}
 */
export function createSemanticExplorer({ document, say }) {
    const text = (key, fallback) => say(key, fallback);
    const state = { query: "", snapshot: null, expanded: new Set(), pages: new Map(), focused: null, previousFocus: null };
    let panel = null;
    let tree = null;
    let search = null;
    let status = null;
    let alert = null;
    let panelAbort = null;
    let onSelect = null;
    let onNavigate = null;
    let onEdit = null;
    let form = null;
    let abort = null;
    let announcer = null;
    // A navigation announces where it goes and then moves the focus there; the
    // focus event must not announce the same element again.
    let suppressNextFocus = false;

    function ensurePanel() {
        if (panel !== null) {
            return;
        }
        panel = document.createElement("section");
        panel.setAttribute("data-semantic-explorer", "");
        panel.setAttribute("role", "region");
        panel.setAttribute("aria-labelledby", "semantic-explorer-title");
        panel.hidden = true;
        panel.style.cssText = "position:fixed;left:16px;top:96px;width:320px;max-height:60vh;overflow:auto;z-index:40;padding:8px;background:var(--island-bg-color);border:1px solid var(--default-border-color);border-radius:var(--border-radius-lg);box-shadow:var(--shadow-island)";
        const heading = document.createElement("h2");
        heading.id = "semantic-explorer-title";
        heading.textContent = text("explorer.title", "Explorador accesible");
        heading.style.cssText = "font-size:14px;margin:0 0 6px";
        const close = document.createElement("button");
        close.setAttribute("type", "button");
        close.setAttribute("data-explorer-close", "");
        close.setAttribute("aria-label", text("explorer.close", "Cerrar el explorador"));
        close.textContent = "\u00d7";
        close.style.cssText = "float:right;margin-left:8px";
        panelAbort = new AbortController();
        const signal = panelAbort.signal;
        close.addEventListener("click", () => closePanel(), { signal });
        search = document.createElement("input");
        search.setAttribute("type", "search");
        search.setAttribute("data-explorer-search", "");
        search.setAttribute("aria-label", text("explorer.search", "Buscar elementos"));
        search.placeholder = text("explorer.search", "Buscar elementos");
        search.addEventListener("input", () => {
            state.query = search.value;
            render();
        }, { signal });
        tree = document.createElement("div");
        tree.setAttribute("role", "tree");
        tree.setAttribute("aria-label", text("explorer.tree", "Elementos del dibujo"));
        tree.setAttribute("data-explorer-tree", "");
        tree.setAttribute("tabindex", "0");
        tree.addEventListener("keydown", onTreeKey, { signal });
        status = document.createElement("p");
        status.setAttribute("role", "status");
        status.setAttribute("aria-live", "polite");
        status.setAttribute("data-explorer-status", "");
        status.style.cssText = "font-size:12px;margin:6px 0 0";
        alert = document.createElement("p");
        alert.setAttribute("role", "alert");
        alert.setAttribute("data-explorer-alert", "");
        alert.style.cssText = "position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap";
        panel.appendChild(heading);
        panel.appendChild(close);
        panel.appendChild(search);
        panel.appendChild(tree);
        panel.appendChild(status);
        panel.appendChild(alert);
        panel.addEventListener("keydown", (event) => {
            // Escape closes from anywhere in the panel, including the search
            // box and the editing forms; the tree's own handler closes too.
            if (event.key === "Escape") {
                event.preventDefault();
                closePanel();
            }
        }, { signal });
        document.body.appendChild(panel);
        announcer = createAnnouncer({ region: status, alertRegion: alert });
        // A focus move announces the element briefly; the coalescer keeps a
        // reader walking with the arrows from hearing every item it passes.
        tree.addEventListener("focusin", (event) => {
            if (suppressNextFocus) {
                suppressNextFocus = false;
                return;
            }
            const target = event.target?.getAttribute?.("data-element-id") ?? null;
            if (target === null) {
                return;
            }
            const element = state.snapshot?.elements?.find((candidate) => candidate.id === target);
            if (element !== undefined) {
                // The item's own name is the tree's; a focus move adds only
                // what the item cannot say.
                const extras = describeExtras(element, { say: text });
                if (extras !== "") {
                    announce(extras);
                }
            }
        }, { signal });
    }

    function visibleItems() {
        return [...tree.querySelectorAll("[role='treeitem']")];
    }

    function onTreeKey(event) {
        const items = visibleItems();
        const index = items.indexOf(document.activeElement);
        const elementId = document.activeElement?.getAttribute?.("data-element-id") ?? null;
        // The navigation relations (TASK-182): reading order, the declared
        // connections and the spatial neighbours, all from the same element.
        // `d` asks for the full description of the focused element: an
        // explicit request may repeat the name; a focus move may not.
        if (elementId !== null && event.key === "d" && !event.altKey && !event.ctrlKey && !event.metaKey) {
            event.preventDefault();
            const element = state.snapshot?.elements?.find((candidate) => candidate.id === elementId);
            if (element !== undefined) {
                announce(describeElement(element, { level: "detailed", say: text }));
            }
            return;
        }
        // The guided editing forms (TASK-186): the two operations the facade
        // exposes, reachable by keyboard from the focused element.
        if (elementId !== null && event.altKey && ["i", "I", "c", "C", "m", "M"].includes(event.key)) {
            event.preventDefault();
            const operation = event.key.toLowerCase() === "i" ? "place" : event.key.toLowerCase() === "c" ? "connect" : "meta";
            openForm(operation, elementId);
            return;
        }
        const plain = { n: "next", p: "previous", o: "outgoing", i: "incoming" };
        if (elementId !== null && !event.altKey && !event.ctrlKey && !event.metaKey && plain[event.key] !== undefined) {
            event.preventDefault();
            navigateFrom(elementId, plain[event.key]);
            return;
        }
        if (elementId !== null && event.altKey && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
            event.preventDefault();
            navigateFrom(elementId, { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" }[event.key]);
            return;
        }
        if (event.key === "Escape") {
            event.preventDefault();
            closePanel();
            return;
        }
        if (event.key === "Home" || event.key === "End") {
            event.preventDefault();
            const target = event.key === "Home" ? items[0] : items[items.length - 1];
            target?.focus();
            return;
        }
        if (event.key === "Enter" || event.key === " ") {
            const item = document.activeElement;
            if (item?.getAttribute?.("role") === "treeitem" && item.getAttribute("data-more") !== null) {
                event.preventDefault();
                const key = item.getAttribute("data-more");
                const previous = state.pages.get(key) ?? PAGE_SIZE;
                const page = previous + PAGE_SIZE;
                state.pages.set(key, page);
                render();
                // The members of the branch, in DOM order: nested branches
                // render before them, so the page boundary is an index over
                // members, not over every treeitem of the group.
                const scope = key === "search" ? "[data-element-id]" : `[data-within="${key}"][data-member]`;
                const nodes = [...tree.querySelectorAll(scope)];
                const total = Number(item.getAttribute("data-total"));
                const shown = Math.min(page, total);
                nodes[previous]?.focus();
                announce(`${text("explorer.showing", "Mostrando")} ${shown} ${text("explorer.of", "de")} ${total}`);
                return;
            }
            if (item?.getAttribute("role") === "treeitem" && item.getAttribute("data-element-id") !== null) {
                event.preventDefault();
                // The action decides: a refusal must not paint the item as
                // selected or tell the reader it happened.
                const answer = onSelect?.(item.getAttribute("data-element-id"));
                if (answer !== null && typeof answer === "object" && answer.status !== "ok") {
                    announce(
                        `${text("explorer.edit.refused", "No se pudo")}: ${answer?.reason ?? "refused"}`,
                        "assertive",
                    );
                    return;
                }
                for (const node of tree.querySelectorAll("[aria-selected='true']")) {
                    node.setAttribute("aria-selected", "false");
                }
                item.setAttribute("aria-selected", "true");
                announce(text("explorer.selected", "Seleccionado"));
            }
            return;
        }
        if (!["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft"].includes(event.key)) {
            return;
        }
        event.preventDefault();
        const current = items[index];
        if (event.key === "ArrowDown") {
            items[Math.min(items.length - 1, index + 1)]?.focus();
        } else if (event.key === "ArrowUp") {
            items[Math.max(0, index - 1)]?.focus();
        } else if (event.key === "ArrowRight") {
            const branchId = current?.getAttribute("data-branch");
            if (branchId !== null && current?.getAttribute("aria-expanded") === "false") {
                state.expanded.add(branchId);
                render();
                // The tree pattern: opening a branch moves to its first child.
                const first = firstChildOf(branchId);
                if (first !== null) {
                    first.focus();
                } else {
                    focusFirst(`[data-branch="${branchId}"]`);
                }
            } else if (branchId !== null) {
                firstChildOf(branchId)?.focus();
            }
        } else {
            const branchId = current?.getAttribute("data-branch");
            if (branchId !== null && current?.getAttribute("aria-expanded") === "true") {
                state.expanded.delete(branchId);
                render();
                focusFirst(`[data-branch="${branchId}"]`);
            } else {
                const parent = current?.getAttribute("data-within");
                if (parent) {
                    focusFirst(`[data-branch="${parent}"]`);
                }
            }
        }
    }

    function firstChildOf(branchId) {
        const group = tree.querySelector(`[data-branch-group="${branchId}"]`);
        return group?.querySelector("[role='treeitem']") ?? null;
    }

    function focusFirst(selector) {
        tree.querySelector(selector)?.focus();
    }

    function announce(message, priority = "polite") {
        if (announcer !== null) {
            announcer.announce(message, { priority });
            return;
        }
        if (status !== null) {
            status.textContent = message;
        }
    }

    function labelOfId(target) {
        const found = state.snapshot?.elements?.find((element) => element.id === target);
        return found?.label?.text ?? found?.kind ?? target;
    }

    function navigateFrom(elementId, relation) {
        let answer = null;
        try {
            answer = onNavigate?.(elementId, relation) ?? null;
        } catch (error) {
            announce(String(error?.message ?? error));
            return;
        }
        if (answer === null) {
            return;
        }
        const targets = Array.isArray(answer.targets) ? answer.targets : [];
        if (targets.length === 0) {
            announce(answer.freeEnd === true
                ? text("explorer.free-end", "La flecha tiene un extremo libre")
                : text("explorer.no-connection", "Sin conexión"));
            return;
        }
        announce(`${text("explorer.navigated", "Va a")}: ${targets.map(labelOfId).join(", ")}`);
        revealTarget(targets[0]);
    }

    function revealTarget(target) {
        const placed = tree.querySelector(`[data-element-id="${target}"]`);
        if (placed !== null) {
            suppressNextFocus = true;
            placed.focus();
            return;
        }
        // It exists in the snapshot but not in the DOM: its branch chain is
        // collapsed or its page does not reach it. Expand every ancestor, page
        // the branch that holds it, then focus — with nested branches the
        // destination can be several groups deep.
        const model = buildTree(state.snapshot, { query: state.query });
        const placement = model.placements?.[target];
        if (placement === undefined) {
            return;
        }
        for (const branchId of placement.path ?? []) {
            state.expanded.add(branchId);
        }
        if (placement.isBranch !== true) {
            const page = Math.max(PAGE_SIZE, Math.ceil((placement.index + 1) / PAGE_SIZE) * PAGE_SIZE);
            state.pages.set(placement.branch, page);
        }
        render();
        const node = tree.querySelector(`[data-element-id="${target}"]`);
        if (node !== null) {
            suppressNextFocus = true;
            node.focus();
        }
    }

    function moreRow(key, shown, total, level, setsize, posinset) {
        const node = item(
            `${text("explorer.more", "más elementos…")} (${shown} ${text("explorer.of", "de")} ${total})`,
            {
                "aria-level": String(level),
                "aria-setsize": String(setsize),
                "aria-posinset": String(posinset),
                "data-more": key,
                "data-total": String(total),
            },
        );
        node.setAttribute("aria-disabled", "false");
        return node;
    }

    function item(label, attributes) {
        const node = document.createElement("div");
        node.setAttribute("role", "treeitem");
        node.setAttribute("tabindex", "-1");
        node.textContent = label;
        for (const [name, value] of Object.entries(attributes)) {
            node.setAttribute(name, value);
        }
        return node;
    }

    function branchTitle(branch) {
        return branch.type === "frame" ? branch.title
            : branch.type === "group" ? `${text("explorer.group", "Grupo")} ${branch.title}`
                : text("explorer.elements", "Elementos");
    }

    function renderBranch(branch, parentId, container, posinset, setsize) {
        const title = branchTitle(branch);
        const hasChildren = branch.children.length + branch.members.length > 0;
        const expanded = state.expanded.has(branch.id);
        const node = item(`${title} (${branch.count})`, {
            "aria-level": String(branch.depth),
            "aria-setsize": String(setsize),
            "aria-posinset": String(posinset),
            "data-branch": branch.id,
            "data-label": title,
            ...(parentId === null ? {} : { "data-within": parentId }),
            ...(branch.elementId === undefined ? {} : { "data-element-id": branch.elementId }),
        });
        if (hasChildren) {
            node.setAttribute("aria-expanded", expanded ? "true" : "false");
        }
        container.appendChild(node);
        if (!expanded || !hasChildren) {
            return;
        }
        // The children of a branch are a group of their own, nested at their
        // real depth: the pattern a reader walks with the arrows.
        const group = document.createElement("div");
        group.setAttribute("role", "group");
        group.setAttribute("data-branch-group", branch.id);
        container.appendChild(group);
        branch.children.forEach((child, index) =>
            renderBranch(child, branch.id, group, index + 1, branch.childSetsize));
        branch.items.forEach((child) => {
            group.appendChild(item(child.label, {
                "aria-level": String(child.depth),
                "aria-selected": "false",
                "aria-setsize": String(branch.childSetsize),
                "aria-posinset": String(child.posinset),
                "data-within": branch.id,
                "data-element-id": child.id,
                "data-label": child.label,
                "data-kind": child.kind,
                "data-member": "",
            }));
        });
        if (branch.truncated) {
            group.appendChild(moreRow(
                branch.id,
                branch.items.length,
                branch.members.length,
                branch.depth + 1,
                branch.childSetsize,
                branch.children.length + branch.items.length + 1,
            ));
        }
    }

    function render() {
        tree.replaceChildren();
        const treeModel = state.snapshot === null
            ? null
            : buildTree(state.snapshot, { query: state.query, limits: Object.fromEntries(state.pages) });
        if (treeModel === null) {
            return;
        }
        if (treeModel.search !== null) {
            if (treeModel.search.items.length === 0) {
                tree.appendChild(item(text("explorer.no-results", "Sin resultados"), {}));
                announce(text("explorer.no-results", "Sin resultados"));
                return;
            }
            treeModel.search.items.forEach((hit, index) => {
                tree.appendChild(item(hit.label, {
                    "aria-level": "1",
                    "aria-selected": "false",
                    "aria-setsize": String(treeModel.search.total),
                    "aria-posinset": String(index + 1),
                    "data-element-id": hit.id,
                    "data-label": hit.label,
                    "data-kind": hit.kind,
                }));
            });
            if (treeModel.search.truncated) {
                tree.appendChild(moreRow(
                    "search",
                    treeModel.search.items.length,
                    treeModel.search.total,
                    2,
                    treeModel.search.total,
                    treeModel.search.items.length + 1,
                ));
            }
            announce(treeModel.search.truncated
                ? text("explorer.results-truncated", `${treeModel.search.total} resultados; se muestran los primeros`)
                : text("explorer.results", `${treeModel.search.total} resultados`));
            return;
        }
        const visibleRoots = treeModel.roots.filter((branch) => branch.id !== "elements" || branch.count > 0);
        if (visibleRoots.length === 0) {
            tree.appendChild(item(text("explorer.empty", "El dibujo no tiene elementos"), {}));
            return;
        }
        visibleRoots.forEach((branch, index) =>
            renderBranch(branch, null, tree, index + 1, visibleRoots.length));
        const first = tree.querySelector("[role='treeitem'][data-branch]");
        if (first !== null) {
            first.tabIndex = 0;
        }
    }

    function closePanel() {
        if (panel === null || panel.hidden) {
            return;
        }
        abort?.abort();
        abort = null;
        panel.hidden = true;
        const previous = state.previousFocus;
        state.previousFocus = null;
        if (previous !== null && previous.isConnected === true) {
            previous.focus();
        } else {
            document.body.focus?.();
        }
    }

    function closeForm() {
        form?.remove();
        form = null;
        tree.focus();
    }

    function field(labelText, control) {
        const wrapper = document.createElement("label");
        wrapper.style.cssText = "display:flex;flex-direction:column;font-size:12px;margin:4px 0";
        wrapper.textContent = labelText;
        wrapper.appendChild(control);
        return wrapper;
    }

    function option(value, label) {
        const node = document.createElement("option");
        node.value = value;
        node.textContent = label;
        return node;
    }

    function openForm(operation, elementId) {
        closeForm();
        const anchor = state.snapshot?.elements?.find((element) => element.id === elementId);
        if (anchor === undefined) {
            return;
        }
        form = document.createElement("form");
        form.setAttribute("data-explorer-form", operation);
        form.setAttribute("aria-label", operation === "place"
            ? text("explorer.edit.place", "Insertar junto al elemento")
            : operation === "connect"
                ? text("explorer.edit.connect", "Conectar elementos")
                : text("explorer.edit.meta", "Editar metadatos del elemento"));
        form.style.cssText = "margin-top:8px;border-top:1px solid var(--default-border-color);padding-top:6px";
        const anchorLine = document.createElement("p");
        anchorLine.textContent = `${text("explorer.edit.anchor", "Desde")}: ${anchor.label?.text ?? anchor.kind} ${elementId}`;
        anchorLine.style.cssText = "font-size:12px;margin:0 0 4px";
        form.appendChild(anchorLine);
        let kindSelect = null;
        let relationSelect = null;
        let gapInput = null;
        let alignSelect = null;
        let targetSelect = null;
        let nameInput = null;
        let altInput = null;
        let descriptionInput = null;
        let nameInitial = "";
        let altInitial = "";
        let descriptionInitial = "";
        if (operation === "place") {
            kindSelect = document.createElement("select");
            kindSelect.name = "kind";
            for (const [value, label] of [["rectangle", text("ui.kind.rectangle", "rectángulo")], ["ellipse", text("ui.kind.ellipse", "elipse")], ["diamond", text("ui.kind.diamond", "rombo")]]) {
                kindSelect.appendChild(option(value, label));
            }
            relationSelect = document.createElement("select");
            relationSelect.name = "relation";
            for (const [value, label] of [["right", text("explorer.edit.right", "a la derecha")], ["left", text("explorer.edit.left", "a la izquierda")], ["above", text("explorer.edit.above", "encima")], ["below", text("explorer.edit.below", "debajo")]]) {
                relationSelect.appendChild(option(value, label));
            }
            gapInput = document.createElement("input");
            gapInput.name = "gap";
            gapInput.type = "number";
            gapInput.min = "0";
            gapInput.max = "1000";
            gapInput.value = "24";
            alignSelect = document.createElement("select");
            alignSelect.name = "alignment";
            for (const [value, label] of [["start", text("explorer.edit.start", "al principio")], ["center", text("explorer.edit.center", "centrado")], ["end", text("explorer.edit.end", "al final")]]) {
                alignSelect.appendChild(option(value, label));
            }
            form.appendChild(field(text("explorer.edit.kind", "Figura"), kindSelect));
            form.appendChild(field(text("explorer.edit.relation", "Dónde"), relationSelect));
            form.appendChild(field(text("explorer.edit.gap", "Separación"), gapInput));
            form.appendChild(field(text("explorer.edit.alignment", "Alineación"), alignSelect));
        } else if (operation === "meta") {
            nameInitial = anchor.meta?.name ?? "";
            altInitial = anchor.meta?.alt ?? "";
            descriptionInitial = anchor.meta?.description ?? "";
            nameInput = document.createElement("input");
            nameInput.name = "name";
            nameInput.type = "text";
            nameInput.value = nameInitial;
            altInput = document.createElement("input");
            altInput.name = "alt";
            altInput.type = "text";
            altInput.value = altInitial;
            descriptionInput = document.createElement("input");
            descriptionInput.name = "description";
            descriptionInput.type = "text";
            descriptionInput.value = descriptionInitial;
            form.appendChild(field(text("explorer.edit.name", "Nombre"), nameInput));
            form.appendChild(field(text("explorer.edit.alt", "Texto alternativo"), altInput));
            form.appendChild(field(text("explorer.edit.description", "Descripción"), descriptionInput));
        } else {
            targetSelect = document.createElement("select");
            targetSelect.name = "target";
            for (const element of state.snapshot?.elements ?? []) {
                if (element.id === elementId) {
                    continue;
                }
                targetSelect.appendChild(option(element.id, element.label?.text ?? `${element.kind} ${element.id}`));
            }
            form.appendChild(field(text("explorer.edit.target", "Conectar con"), targetSelect));
        }
        const submit = document.createElement("button");
        submit.type = "submit";
        submit.textContent = text(
            "explorer.edit.submit",
            operation === "place" ? "Insertar" : operation === "connect" ? "Conectar" : "Guardar",
        );
        const cancel = document.createElement("button");
        cancel.type = "button";
        cancel.textContent = text("explorer.edit.cancel", "Cancelar");
        cancel.addEventListener("click", () => {
            closeForm();
            announce(text("explorer.edit.cancelled", "Edición cancelada"));
        });
        const row = document.createElement("div");
        row.style.cssText = "display:flex;gap:6px;margin-top:4px";
        row.appendChild(submit);
        row.appendChild(cancel);
        form.appendChild(row);
        form.addEventListener("submit", (event) => {
            event.preventDefault();
            const args = operation === "place"
                ? { anchorId: elementId, kind: kindSelect.value, relation: relationSelect.value, gap: Number(gapInput.value), alignment: alignSelect.value }
                : operation === "connect"
                    ? { sourceId: elementId, targetId: targetSelect.value }
                    // The fields show what is stored; sending all three makes
                    // "empty this field" mean "clear it", not "guess".
                    : {
                        id: elementId,
                        name: nameInput.value,
                        alt: altInput.value,
                        description: descriptionInput.value,
                    };
            let answer = null;
            try {
                answer = onEdit?.(operation, args) ?? null;
            } catch (error) {
                answer = { status: "refused", reason: String(error?.message ?? error) };
            }
            if (answer === null || answer.status !== "ok") {
                announce(`${text("explorer.edit.refused", "No se pudo")}: ${answer?.reason ?? "refused"}`, "assertive");
                return;
            }
            if (typeof answer.snapshot === "string") {
                try {
                    state.snapshot = JSON.parse(answer.snapshot);
                } catch {
                    // The old snapshot stays; the announcement still says it landed.
                }
            }
            closeForm();
            render();
            announce(text("explorer.edit.done", "Hecho"));
        });
        panel.appendChild(form);
        (kindSelect ?? targetSelect ?? nameInput)?.focus();
    }

    return {
        open(snapshotJson, select, navigate, edit) {
            ensurePanel();
            let snapshot;
            try {
                snapshot = JSON.parse(snapshotJson);
            } catch (error) {
                announce(text("explorer.invalid", "La instantánea no es JSON válido"));
                panel.hidden = false;
                return;
            }
            try {
                buildTree(snapshot, { query: state.query });
                state.snapshot = snapshot;
            } catch (error) {
                announce(error.message ?? String(error), "assertive");
                panel.hidden = false;
                return;
            }
            onSelect = select ?? null;
            onNavigate = navigate ?? null;
            onEdit = edit ?? null;
            state.previousFocus = document.activeElement;
            abort = new AbortController();
            panel.hidden = false;
            render();
            announce(describeScene(state.snapshot, { level: "brief", say: text }));
            search.focus();
        },
        close() {
            closePanel();
        },
        isOpen() {
            return panel !== null && panel.hidden === false;
        },
        /** Tear the panel down: no listeners, no timers, no DOM left behind. */
        destroy() {
            if (panel === null) {
                return;
            }
            abort?.abort();
            abort = null;
            panelAbort?.abort();
            panelAbort = null;
            panel.remove();
            panel = null;
            tree = null;
            search = null;
            status = null;
            alert = null;
            announcer = null;
            form = null;
            onSelect = null;
            onNavigate = null;
            onEdit = null;
            state.snapshot = null;
            state.expanded.clear();
            state.pages.clear();
        },
        /** Emit the pending announcement now; a caller that needs the region
         *  settled (a test, or a close) asks instead of waiting for the window. */
        flush() {
            announcer?.flush();
        },
    };
}
