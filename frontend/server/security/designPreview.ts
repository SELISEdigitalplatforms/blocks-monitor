/** The prototype has an opaque origin: scripts can interact with its DOM, never with the parent or its session. */
export const DESIGN_PREVIEW_CSP = "sandbox allow-scripts allow-forms; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'";
export const DESIGN_PREVIEW_HEADERS = { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": DESIGN_PREVIEW_CSP,
  "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "X-Frame-Options": "SAMEORIGIN" };
