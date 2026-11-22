/** The page's CSP nonce. server/security/plugin.ts sets Vite's html.cspNonce, so Vite puts it on <meta property="csp-nonce">; read the nonce property, because browsers hide the attribute. */
export function cspNonce(): string | undefined {
  if (typeof document === "undefined" || typeof document.querySelector !== "function") return undefined;
  return document.querySelector<HTMLMetaElement>('meta[property="csp-nonce"]')?.nonce || undefined;
}
