import { embeddedApiUrl } from "./protocol";
import { createShellFetch, refreshParentSession } from "./sessionBridge";

// Install before importing the app: session recovery and source probes run at module initialization.
const originalFetch = window.fetch.bind(window);
window.fetch = createShellFetch({ fetch: originalFetch, origin: window.location.origin,
  tenant: () => document.documentElement.dataset.blocksTenant, refresh: refreshParentSession });

// Preview frames, image elements and downloads also use same-origin API paths.
const rewriteElement = (element: Element) => {
  for (const attr of ["src", "href", "action"]) {
    const raw = element.getAttribute(attr);
    if (!raw) continue;
    const proxied = embeddedApiUrl(raw, window.location.origin);
    if (proxied !== raw) element.setAttribute(attr, proxied);
  }
};
new MutationObserver((changes) => {
  for (const change of changes) {
    if (change.type === "attributes" && change.target instanceof Element) rewriteElement(change.target);
    for (const added of change.addedNodes) {
      if (!(added instanceof Element)) continue;
      rewriteElement(added);
      added.querySelectorAll("[src],[href],[action]").forEach(rewriteElement);
    }
  }
}).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["src", "href", "action"] });

void import("./runtime").catch(() => {
  const root = document.getElementById("root");
  if (root) root.textContent = "MADP could not start. Reload this page to try again.";
});
