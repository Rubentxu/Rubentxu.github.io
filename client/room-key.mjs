// The room key: what a shared link means, and what it protects.
//
// # What this is
//
// The collaboration contract (ADR-007) says the relay sees the document in
// clear — that is the price of an authority that *applies* actions. But
// presence is the one channel the relay only ever re-forwards: it is an
// opaque upsert by id, and the authority needs none of its content. So the
// room key buys a true end-to-end secret for exactly that channel: pointers
// cross the relay as ciphertext, and only the pages holding the key can
// read them.
//
// # The key and the link
//
// The key is sixteen random bytes, written base64url, and it travels the
// way upstream's room keys travel: in the **URL fragment** (`#k=…`). The
// browser never sends a fragment to a server — it is the one part of a URL
// that stays on the page — so "who has the link" and "who can read the
// pointers" stay the same set of people, which is the whole model. The
// trade is upstream's own trade too: lose the link, lose the room; want a
// new key, open a new room (rooms are ephemeral, and the key's scope is
// the room).
//
// # The cipher, and why it is not homemade
//
// AES-GCM through WebCrypto (`crypto.subtle`) — the maintained library the
// browser ships and updates, and upstream's own choice
// (`packages/excalidraw/data/encryption.ts`: `crypto.subtle`, AES-GCM,
// key imported from its base64 `k`). This module writes no cipher: it
// formats keys, adds a fresh random IV per seal, and names the one failure
// the caller needs to know (`bad_key` — GCM refuses to open what it did
// not seal, and that refusal is the authentication).
//
// @param {SubtleCrypto} [subtle] The WebCrypto door; the platform's by default.
// @returns {{
//   create: () => Promise<string>,
//   seal: (keyBase64Url: string, value: object) => Promise<string>,
//   open: (keyBase64Url: string, sealed: string) => Promise<object>,
//   fragmentFor: (keyBase64Url: string) => string,
//   keyFromFragment: (fragment: string) => string | null,
// }}
export function createRoomKeyCodec(subtle = globalThis.crypto?.subtle) {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    /** base64url, no padding — the URL alphabet, not the mail one. */
    const toBase64Url = (bytes) => {
        let text = "";
        for (const byte of bytes) {
            text += String.fromCharCode(byte);
        }
        return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    };

    const fromBase64Url = (text) => {
        const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4);
        const raw = atob(padded);
        const bytes = new Uint8Array(raw.length);
        for (let index = 0; index < raw.length; index += 1) {
            bytes[index] = raw.charCodeAt(index);
        }
        return bytes;
    };

    const importKey = async (keyBase64Url) =>
        subtle.importKey("raw", fromBase64Url(keyBase64Url), { name: "AES-GCM" }, false, [
            "encrypt",
            "decrypt",
        ]);

    return {
        /** Sixteen fresh random bytes, base64url. */
        async create() {
            const bytes = new Uint8Array(16);
            globalThis.crypto.getRandomValues(bytes);
            return toBase64Url(bytes);
        },

        /**
         * Seal a value for the room.
         *
         * The answer is `v1.<iv>.<ciphertext>`, all base64url: the version
         * is one byte the reader can refuse before touching the cipher, and
         * the IV is fresh per seal — GCM's rule, not a preference — so two
         * seals of the same pointer never share a keystream.
         *
         * @param {string} keyBase64Url The room key.
         * @param {object} value The value to seal.
         * @returns {Promise<string>} The sealed string.
         */
        async seal(keyBase64Url, value) {
            const key = await importKey(keyBase64Url);
            const iv = new Uint8Array(12);
            globalThis.crypto.getRandomValues(iv);
            const sealed = await subtle.encrypt(
                { name: "AES-GCM", iv },
                key,
                encoder.encode(JSON.stringify(value)),
            );
            return `v1.${toBase64Url(iv)}.${toBase64Url(new Uint8Array(sealed))}`;
        },

        /**
         * Open a sealed value, or refuse by name.
         *
         * A wrong key is not an error to report upward — it is one peer
         * this page cannot read, and the caller drops it. The refusal is
         * named so a caller that cares can tell a wrong key from a broken
         * payload.
         *
         * @param {string} keyBase64Url The room key.
         * @param {string} sealed The sealed string.
         * @returns {Promise<object>} The opened value.
         * @throws {Error} `bad_key: …` when the payload was not sealed with this key.
         */
        async open(keyBase64Url, sealed) {
            const [version, ivText, blobText] = sealed.split(".");
            if (version !== "v1" || ivText === undefined || blobText === undefined) {
                throw new Error("bad_key: not a sealed payload");
            }
            const key = await importKey(keyBase64Url);
            try {
                const plain = await subtle.decrypt(
                    { name: "AES-GCM", iv: fromBase64Url(ivText) },
                    key,
                    fromBase64Url(blobText),
                );
                return JSON.parse(decoder.decode(plain));
            } catch {
                throw new Error("bad_key: the payload was not sealed with this key");
            }
        },

        /** The fragment that carries the key: `#k=…`, and nothing else. */
        fragmentFor(keyBase64Url) {
            return `#k=${keyBase64Url}`;
        },

        /**
         * The key a URL fragment carries, or `null`.
         *
         * @param {string} fragment The location hash, `#` included.
         * @returns {string | null}
         */
        keyFromFragment(fragment) {
            if (typeof fragment !== "string" || !fragment.startsWith("#")) {
                return null;
            }
            const match = fragment.slice(1).match(/(?:^|&)k=([^&]+)/);
            return match === null ? null : match[1];
        },
    };
}
