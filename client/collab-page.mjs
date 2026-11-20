// The shared room's own half.
//
// The page carries the box; this module mounts the editor in it and joins the
// room the query string names.
//
// Why this is a file and not a script inside the page: the page's policy
// forbids inline scripts, and a policy that allows them would allow every
// injected one too.

import { createNextDrawApp } from "./create-app.mjs";
import { createRoomKeyCodec } from "./room-key.mjs";

// The markup is the demo page's own body, fetched and mounted — one
// template, three consumers, zero copies of the same. The styles come
// with it, the same way embed.html takes them.
const mount = document.getElementById("mount");
const source = await (await fetch("./index.html")).text();
const template = new DOMParser().parseFromString(source, "text/html");
for (const style of [...template.head.querySelectorAll("style")]) {
    document.head.append(style);
}
for (const node of [...template.body.childNodes]) {
    if (node.tagName === "SCRIPT") {
        continue;
    }
    mount.append(node);
}

// The room rides the query string: ?room=demo&relay=http://127.0.0.1:8090
// The relay is this repository's own file (scripts/relay.mjs) — start
// one and point two pages of this page at it.
const params = new URLSearchParams(location.search);
const room = params.get("room") ?? "demo";
const relay = params.get("relay") ?? "http://127.0.0.1:8090";
const user = params.get("user") ?? undefined;

// The room key lives in the FRAGMENT — the one part of a URL the
// browser never sends to a server. The first page of a room mints
// one and puts it in its own address; every page that opens the
// shared link inherits it, and the pointers cross the relay as
// ciphertext. A room without a fragment runs clear (demo mode).
const keys = createRoomKeyCodec();
let roomKey = keys.keyFromFragment(location.hash);
if (roomKey === null) {
    roomKey = await keys.create();
    history.replaceState(null, "", `#k=${roomKey}`);
}

// The probe the e2e reads: who this page believes is in the room.
// The factory keeps the painting; this window-level reader is the
// page's own.
window.__peers = [];

window.__app = await createNextDrawApp(mount, {
    room: { url: relay, name: room, user, key: roomKey },
});

// The poll loop paints the peers onto the canvas; this reader mirrors
// them for the probe. It reads through the link — the one door that
// opens the room's ciphertext — and never the relay's raw rows,
// which are blobs the page cannot read and should not pretend to.
const watch = setInterval(async () => {
    const link = window.__app?.link?.();
    if (!link) {
        clearInterval(watch);
        return;
    }
    try {
        window.__peers = await link.who();
    } catch {
        // the relay is down; the probe reads what the page last knew
    }
}, 400);
