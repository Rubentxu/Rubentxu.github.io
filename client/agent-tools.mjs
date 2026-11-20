// The page's WebMCP lifecycle: one controller for the current session, consent
// in storage, and a destroy that leaves nothing registered.
//
// The adapter is built from the session the page already has (never a raw
// Session crossing a boundary); the consent is the user's, stored where the
// page can revoke it; replacing the session tears the old registration down
// before the new one exists (TASK-195).

import { createWebMcpAdapter } from "./webmcp-adapter.mjs";

/** Where the user's consent lives. Absent or not "1" means no consent. */
export const WEBMCP_CONSENT_KEY = "nextdraw.webmcp.consent";

let installed = null;

/**
 * The controller for `session`, building a new one when the session changed.
 *
 * @param {{session: object, storage?: object, modelContext?: object|null,
 *          say?: (key: string, fallback: string) => string}} options
 * @returns {{adapter: object, status: Function, enable: Function,
 *            revoke: Function, destroy: Function}}
 */
export function ensureAgentTools({ session, storage = globalThis.localStorage, modelContext = undefined }) {
    if (installed !== null && installed.session === session) {
        return installed.tools;
    }
    installed?.tools.destroy();
    const adapterOptions = {
        session,
        consent: () => storage.getItem(WEBMCP_CONSENT_KEY) === "1",
    };
    if (modelContext !== undefined) {
        adapterOptions.modelContext = modelContext;
    }
    const adapter = createWebMcpAdapter(adapterOptions);
    const tools = {
        adapter,
        status() {
            if (!adapter.supported) {
                return "unsupported";
            }
            return adapter.isEnabled() ? "enabled" : "available";
        },
        enable() {
            if (!adapter.supported) {
                return { status: "unsupported", tools: [] };
            }
            storage.setItem(WEBMCP_CONSENT_KEY, "1");
            const answer = adapter.enable();
            if (answer.status !== "enabled") {
                storage.removeItem(WEBMCP_CONSENT_KEY);
            }
            return answer;
        },
        revoke() {
            adapter.disable();
            storage.removeItem(WEBMCP_CONSENT_KEY);
            return { status: "revoked", tools: [] };
        },
        destroy() {
            adapter.disable();
            storage.removeItem(WEBMCP_CONSENT_KEY);
        },
    };
    installed = { session, tools };
    return tools;
}

/** Tear the controller down (the page or a test that wants a clean slate). */
export function resetAgentTools() {
    installed?.tools.destroy();
    installed = null;
}
