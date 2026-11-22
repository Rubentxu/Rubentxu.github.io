// The optional WebMCP adapter: the read half of the semantic facade, offered to
// a compatible host only when the host asks and the user consents.
//
// Nothing here is part of the core. The app works without a WebMCP browser; the
// adapter is constructed by whoever wants it, registers only the four read
// tools (never a write, never the Session), and unregisters cleanly. Its
// contract is experimental and lives in this file, not in the domain.

import { createSemanticFacade } from "./semantic-facade.mjs";

/** The read tools. Always offered when the host has a WebMCP context. */
export const WEBMCP_TOOL_NAMES = Object.freeze(["getSceneSummary", "queryElements", "getElement", "getConnections"]);
/** The write tools. Offered only with the `write` scope and host authorization. */
export const WEBMCP_WRITE_TOOLS = Object.freeze(["selectElements", "placeRelative", "connectElements", "undo"]);

/**
 * The host's model context, when it speaks a registration API we know.
 *
 * The anchor moved: the host Chrome 157 exposes (TASK-278 s2, evidence
 * `docs/evidence/task-278-webmcp-host.md`) is `document.modelContext`, not the
 * `navigator.modelContext` of the early dev preview. The navigator is still
 * asked first so a host that anchors there keeps working; `document` is only
 * consulted when the caller is asking about the live page (no fake `nav`).
 *
 * @param {object} [nav] the navigator to read.
 * @returns {object|null}
 */
export function detectModelContext(nav = globalThis.navigator) {
    const context = nav?.modelContext
        ?? (nav === globalThis.navigator ? globalThis.document?.modelContext : undefined);
    if (context === undefined || context === null) {
        return null;
    }
    return typeof context.registerTool === "function" || typeof context.provideContext === "function"
        ? context
        : null;
}

/**
 * Build the adapter.
 *
 * @param {{session: object, modelContext?: object|null, consent?: () => boolean}} options
 *        `consent` is the user's decision; without it every enable is denied.
 * @returns {{supported: boolean, isEnabled: () => boolean, enable: Function,
 *            disable: Function, toolNames: () => string[]}}
 */
export function createWebMcpAdapter({
    session,
    modelContext = detectModelContext(),
    consent = () => false,
    scopes = ["read"],
    authorize = () => false,
    confirm = () => false,
    viewOnly = () => false,
}) {
    const facade = createSemanticFacade({ session, viewOnly });
    let active = false;
    // The default is read: a host that says nothing gets no write tool. The
    // writes are the four justified primitives, never a generic mutation.
    const wantsWrite = scopes.includes("write") && authorize("write") === true;
    const writes = [
        {
            name: "selectElements",
            description: "Select elements by id in the session; it does not change the document.",
            inputSchema: {
                type: "object",
                properties: { ids: { type: "array", maxItems: 1000, items: { type: "string", minLength: 1, maxLength: 200 } } },
                required: ["ids"],
                additionalProperties: false,
            },
            execute: async (args) => {
                if (consent() !== true) {
                    return { status: "refused", reason: "consent_revoked" };
                }
                if (authorize("write") !== true || authorize("selectElements") !== true) {
                    return { status: "refused", reason: "not_authorized" };
                }
                return facade.selectElements(args?.ids);
            },
        },
        {
            name: "placeRelative",
            description: "Place a new shape beside an existing element, by relation and gap (a visible edit).",
            inputSchema: {
                type: "object",
                properties: {
                    anchorId: { type: "string", minLength: 1, maxLength: 200 },
                    kind: { type: "string", enum: ["rectangle", "ellipse", "diamond"] },
                    relation: { type: "string", enum: ["right", "left", "above", "below"] },
                    gap: { type: "number", minimum: 0, maximum: 1000 },
                    alignment: { type: "string", enum: ["start", "center", "end"] },
                },
                required: ["anchorId"],
                additionalProperties: false,
            },
            execute: async (args) => {
                if (consent() !== true) {
                    return { status: "refused", reason: "consent_revoked" };
                }
                if (authorize("write") !== true || authorize("placeRelative") !== true) {
                    return { status: "refused", reason: "not_authorized" };
                }
                if (confirm("placeRelative", args) !== true) {
                    return { status: "refused", reason: "confirmation_required" };
                }
                return facade.placeRelative(args ?? {});
            },
        },
        {
            name: "connectElements",
            description: "Create a bound arrow between two existing elements (a visible edit).",
            inputSchema: {
                type: "object",
                properties: {
                    sourceId: { type: "string", minLength: 1, maxLength: 200 },
                    targetId: { type: "string", minLength: 1, maxLength: 200 },
                },
                required: ["sourceId", "targetId"],
                additionalProperties: false,
            },
            execute: async (args) => {
                if (consent() !== true) {
                    return { status: "refused", reason: "consent_revoked" };
                }
                if (authorize("write") !== true || authorize("connectElements") !== true) {
                    return { status: "refused", reason: "not_authorized" };
                }
                if (confirm("connectElements", args) !== true) {
                    return { status: "refused", reason: "confirmation_required" };
                }
                return facade.connectElements(args ?? {});
            },
        },
        {
            name: "undo",
            description: "Take back the last history entry (a destructive action: it needs confirmation).",
            inputSchema: { type: "object", properties: {}, additionalProperties: false },
            execute: async () => {
                if (consent() !== true) {
                    return { status: "refused", reason: "consent_revoked" };
                }
                if (authorize("write") !== true || authorize("undo") !== true) {
                    return { status: "refused", reason: "not_authorized" };
                }
                if (confirm("undo", {}) !== true) {
                    return { status: "refused", reason: "confirmation_required" };
                }
                return facade.undo();
            },
        },
    ];
    const offered = wantsWrite ? [...WEBMCP_TOOL_NAMES, ...WEBMCP_WRITE_TOOLS] : [...WEBMCP_TOOL_NAMES];
    const definitions = [
        {
            name: "getSceneSummary",
            description: "The drawing's counts by kind, its connections, free arrows and locked elements.",
            inputSchema: { type: "object", properties: {}, additionalProperties: false },
            execute: async () => {
                if (consent() !== true) {
                    return { status: "refused", reason: "consent_revoked" };
                }
                // The facade already answers the summary; it carries no
                // elements, so there is nothing to summarize again.
                return facade.getSceneSummary();
            },
        },
        {
            name: "queryElements",
            description: "Search the drawing's semantic elements by kind, with offset and a bounded limit.",
            inputSchema: {
                type: "object",
                properties: {
                    kind: { type: "string", maxLength: 200 },
                    offset: { type: "integer", minimum: 0 },
                    limit: { type: "integer", minimum: 1, maximum: 200 },
                },
                additionalProperties: false,
            },
            execute: async (args) => {
                if (consent() !== true) {
                    return { status: "refused", reason: "consent_revoked" };
                }
                return facade.queryElements(args ?? {});
            },
        },
        {
            name: "getElement",
            description: "One element by id: its kind, label with provenance, bounds, frame, groups, lock and bindings.",
            inputSchema: {
                type: "object",
                properties: { id: { type: "string", minLength: 1, maxLength: 200 } },
                required: ["id"],
                additionalProperties: false,
            },
            execute: async (args) => {
                if (consent() !== true) {
                    return { status: "refused", reason: "consent_revoked" };
                }
                return facade.getElement(args?.id);
            },
        },
        {
            name: "getConnections",
            description: "The arrows into and out of one element, with free-end flags.",
            inputSchema: {
                type: "object",
                properties: { id: { type: "string", minLength: 1, maxLength: 200 } },
                required: ["id"],
                additionalProperties: false,
            },
            execute: async (args) => {
                if (consent() !== true) {
                    return { status: "refused", reason: "consent_revoked" };
                }
                return facade.getConnections(args?.id);
            },
        },
    ];

    // The Chrome 157 host knows no `unregisterTool` and no `provideContext`
    // (TASK-278 s2): the door to leaving nothing behind is the `signal` the
    // registration takes and an abort closes. The other dialects keep theirs.
    let registration = null;

    const stop = () => {
        if (typeof modelContext.unregisterTool === "function") {
            for (const name of offered) {
                modelContext.unregisterTool(name);
            }
        } else if (typeof modelContext.provideContext === "function") {
            modelContext.provideContext({ tools: [] });
        }
        registration?.abort();
        registration = null;
        active = false;
    };

    return {
        supported: modelContext !== null,
        isEnabled: () => active,
        toolNames: () => [...offered],
        enable() {
            if (modelContext === null) {
                return { status: "unsupported", tools: [] };
            }
            if (consent() !== true) {
                return { status: "denied", tools: [] };
            }
            if (active) {
                return { status: "enabled", tools: [...offered] };
            }
            const registering = wantsWrite ? [...definitions, ...writes] : definitions;
            if (typeof modelContext.registerTool === "function") {
                registration = typeof AbortController === "function" ? new AbortController() : null;
                for (const definition of registering) {
                    // A second argument a dialect does not know is dropped; the
                    // Chrome 157 host honours this one and forgets the tool on
                    // abort (the only clean exit it offers).
                    modelContext.registerTool(definition, registration === null ? undefined : { signal: registration.signal });
                }
            } else {
                modelContext.provideContext({ tools: registering });
            }
            active = true;
            return { status: "enabled", tools: [...offered] };
        },
        disable() {
            if (!active) {
                return { status: "disabled", tools: [] };
            }
            stop();
            return { status: "disabled", tools: [] };
        },
    };
}
