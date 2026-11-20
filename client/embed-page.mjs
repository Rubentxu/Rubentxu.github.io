// The embeddable page's own half.
//
// The page carries the box; this module mounts the editor in it. The markup
// inside the box is the demo page's own body, fetched and mounted — one
// template, two consumers.
//
// Why this is a file and not a script inside the page: the page's policy
// forbids inline scripts, and a policy that allows them would allow every
// injected one too.

import { createNextDrawApp } from "./create-app.mjs";

// The embeddable interface, exercised the way a page would exercise it:
// fetch the app's own markup, mount it in this page's container, and
// listen. The template is the demo page — the one place the editor's
// markup lives — so an embedder cannot drift from it by construction.
const mount = document.getElementById("mount");
const source = await (await fetch("./index.html")).text();
const template = new DOMParser().parseFromString(source, "text/html");
// The editor's own styles come with the template: the sheet the demo
// page carries is the sheet the editor needs, and copying it here is
// the same rule as copying the markup — one template, two consumers.
// A host that wants to re-style a piece of the editor names its own
// box, and specificity does the rest.
for (const style of [...template.head.querySelectorAll("style")]) {
    document.head.append(style);
}
// The demo body's scripts stay behind: its entry mounts the editor into
// the whole page, and this page mounts it into the box — the same
// factory, called once, by the page that owns the mount.
for (const node of [...template.body.childNodes]) {
    if (node.tagName === "SCRIPT") {
        continue;
    }
    mount.append(node);
}

window.__events = [];
window.__app = await createNextDrawApp(mount, {
    onChange: (document_) => {
        window.__events.push(document_);
    },
});
window.dispatchEvent(new Event("nextdraw-mounted"));
