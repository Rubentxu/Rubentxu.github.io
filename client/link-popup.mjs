// The small, non-modal preview of a linked element.
//
// The scene owns both hit testing and the stored address. This binder only
// presents the address and its safe navigation door; it never takes focus.

/**
 * Show the link under the pointer and dismiss it when the pointer leaves both
 * the linked element and the popup.
 *
 * @param {object} options
 * @param {Element} options.canvas The surface whose coordinates the kernel tests.
 * @param {Element} options.host The fixed popup container.
 * @param {(tag: string) => Element} options.createElement
 * @param {() => object} options.currentSession The current kernel session.
 * @param {object} options.canvasRect The canvas bounds cache.
 * @param {object} options.window The mounted window.
 * @param {(key: string, source: string) => string} [options.text]
 * @param {AbortSignal} [options.signal]
 * @returns {{ close: () => void }}
 */
export function bindLinkPopup({
    canvas,
    host,
    createElement,
    currentSession,
    canvasRect,
    window,
    text = (_key, source) => source,
    signal,
}) {
    let shownLink = null;

    function close() {
        if (shownLink === null) return;
        shownLink = null;
        host.replaceChildren();
        host.hidden = true;
    }

    function show(link, event) {
        if (shownLink !== link) {
            host.setAttribute("role", "group");
            host.setAttribute("aria-label", text("aria.link-popup", "Link preview"));
            host.replaceChildren();
            const address = createElement("span");
            address.dataset.linkAddress = "true";
            address.textContent = link;
            const anchor = createElement("a");
            anchor.href = link;
            anchor.target = "_blank";
            anchor.rel = "noopener noreferrer";
            anchor.textContent = text("link-popup.open", "Open link");
            anchor.setAttribute("aria-label", text("link-popup.open", "Open link"));
            host.append(address, anchor);
            shownLink = link;
        }
        const margin = 12;
        const width = host.offsetWidth || 240;
        const height = host.offsetHeight || 44;
        host.style.left = `${Math.max(0, Math.min(event.clientX + margin, window.innerWidth - width - margin))}px`;
        host.style.top = `${Math.max(0, Math.min(event.clientY + margin, window.innerHeight - height - margin))}px`;
        host.hidden = false;
    }

    function onPointerMove(event) {
        // Moving over the popup itself must not make its own link disappear.
        if (host.contains(event.target)) return;
        const rect = canvasRect.get();
        const hits = currentSession().hitTestAtScreen(event.clientX - rect.left, event.clientY - rect.top, 0);
        const id = hits.length > 0 ? hits[0] : null;
        const link = id === null ? null : currentSession().linkOf(id);
        if (typeof link === "string" && link.length > 0) {
            show(link, event);
        } else {
            close();
        }
    }

    function onCanvasLeave(event) {
        if (event.relatedTarget !== null && host.contains(event.relatedTarget)) return;
        close();
    }

    function onHostLeave(event) {
        if (event.relatedTarget !== null && canvas.contains(event.relatedTarget)) return;
        close();
    }

    canvas.addEventListener("pointermove", onPointerMove, { signal });
    canvas.addEventListener("pointerleave", onCanvasLeave, { signal });
    host.addEventListener("pointerleave", onHostLeave, { signal });
    signal?.addEventListener("abort", close, { once: true });
    return { close };
}
