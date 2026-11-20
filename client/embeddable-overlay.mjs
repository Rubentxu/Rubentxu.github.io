// The DOM layer that carries a web embed's page.
//
// The frame's *box* and the policy's answer both come from the kernel, in the
// pixels of the frame that was just painted — the client positions, it does not
// project. This module is the reconciliation between that answer and a set of
// DOM children: one `<iframe>` per frame the policy allows, nothing for a frame
// it refuses (the canvas draws that frame's placeholder words), and a style
// update for the rest.
//
// Why reconcile by id instead of rebuilding: an `<iframe>` whose `src` is
// untouched is a page that does not reload, and a page that reloads on every
// pan is not an embedded page but a flickering one. The box moves with the
// viewport every frame; the document inside it must not notice.

/**
 * The sandbox the reference gives an embeddable's frame.
 *
 * `allow-same-origin` leads only when the policy grants it — the string is
 * spelled the way upstream spells it
 * (`packages/excalidraw/components/App.tsx:2064-2068`) — and the rest is the
 * fixed grant, identical either way.
 */
export function sandboxFor(sameOrigin) {
    return `${sameOrigin ? "allow-same-origin " : ""}allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-presentation allow-downloads`;
}

/**
 * Lay the embeddable pages out over the canvas.
 *
 * @param {Element} layer the layer element the pages live in.
 * @param {Array<{id: string, x: number, y: number, width: number, height: number,
 *   angle: number, src: string|null, render: boolean, sameOrigin: boolean}>} views
 *   one row per embeddable, in the scene's own z-order, as the kernel's
 *   `embeddablesView` answered for the frame that was just painted. The
 *   address is the kernel's canonical spelling of the address it judged, so
 *   the browser loads the very address the policy decided about.
 * @param {Document} [owner] the document to build elements in; a test passes a
 *   fake. Defaults to the global document.
 */
export function syncEmbeddableLayer(layer, views, owner = globalThis.document) {
    const wanted = new Map(views.map((view) => [view.id, view]));
    // The frames the scene no longer holds go first, so a delete is a delete
    // even when a later view reuses nothing about the old row.
    for (const child of [...layer.children]) {
        if (!wanted.has(child.dataset.embeddableId)) {
            child.remove();
        }
    }
    for (const view of views) {
        // The lookup walks the children rather than asking a selector: an id
        // is a document's own string, and a lookup that had to escape it would
        // be a second place where the id's spelling mattered.
        let child =
            [...layer.children].find(
                (candidate) => candidate.dataset.embeddableId === view.id,
            ) ?? null;
        if (!view.render || !view.src) {
            // The policy refused this address: the words on the canvas are the
            // answer, and a frame with nothing in it would be a white sheet
            // over them. A frame with no address is the same answer — an
            // empty `src` loads this page's own URL inside the frame.
            child?.remove();
            continue;
        }
        if (!child) {
            child = owner.createElement("iframe");
            child.dataset.embeddableId = view.id;
            // The reference's own frame attributes: no scrolling inside the
            // box, no referrer, the media grants, and the sandbox the policy
            // spelled. The `src` is set below, once, when the frame is born.
            child.setAttribute("scrolling", "no");
            child.setAttribute("referrerPolicy", "no-referrer-when-downgrade");
            child.setAttribute("title", "NextDraw Embedded Content");
            child.setAttribute(
                "allow",
                "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture",
            );
            child.setAttribute("allowFullScreen", "true");
            // The fence goes up before the address goes in. A frame that is
            // born already sandboxed has no moment in which a page loads
            // inside a frame that is not fenced yet.
            child.setAttribute("sandbox", sandboxFor(view.sameOrigin));
            // The address is the kernel's canonical spelling of the address
            // it judged — never the text the document carried.
            child.src = view.src;
            layer.appendChild(child);
        } else {
            // The policy may have changed its mind about the origin since the
            // frame was born, and the fence is cheap to re-apply.
            child.setAttribute("sandbox", sandboxFor(view.sameOrigin));
        }
        child.style.left = `${view.x}px`;
        child.style.top = `${view.y}px`;
        child.style.width = `${view.width}px`;
        child.style.height = `${view.height}px`;
        // The frame turns about its own centre, the way the canvas ink does:
        // the transform puts the origin at the middle before the rotation, so
        // a turned frame and its outline cannot disagree about where that
        // middle is.
        child.style.transformOrigin = "center";
        child.style.transform =
            view.angle === 0 ? "none" : `rotate(${view.angle}rad)`;
    }
}
