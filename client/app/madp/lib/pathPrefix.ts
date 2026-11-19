/**
 * Blocks shell path prefix: MADP paths like /p/:id/business become /app/:itemId/p/:id/business.
 * This module holds the current prefix so path-building helpers can produce correct absolute URLs
 * without every component needing to know about the Blocks shell routing.
 *
 * Set once by MadpBridgeProvider when it mounts; read by projectRoute, stepPath, phasePath, etc.
 */

let _prefix = "";

/** Set the path prefix (e.g. "/app/abc123"). Called by MadpBridgeProvider. */
export function setPathPrefix(prefix: string): void {
  _prefix = prefix.replace(/\/+$/, ""); // strip trailing slash
}

/** Get the current prefix (empty string when running standalone MADP). */
export function getPathPrefix(): string {
  return _prefix;
}

/**
 * Prepend the current Blocks shell prefix to any MADP absolute path.
 * "/p/xyz/business" → "/app/:itemId/p/xyz/business"
 * Already-prefixed paths pass through unchanged.
 */
export function prefixPath(path: string): string {
  if (!_prefix) return path;
  if (path.startsWith(_prefix)) return path; // already prefixed
  return _prefix + path;
}

/**
 * Rewrite well-known MADP top-level paths to their Blocks shell equivalents.
 * "/projects" → "/app/:itemId/home" (MADP projects list lives under "home" in Blocks)
 * "/dashboard" → "/app/:itemId/home"
 * "/home" → "/app/:itemId/home"
 * "/new" → "/app/:itemId/new"
 * "/settings" → "/app/:itemId/settings"
 * "/admin" → "/app/:itemId/admin"
 * "/wiki" → "/app/:itemId/wiki"
 * "/billing/..." → "/app/:itemId/settings" (billing is under settings in Blocks)
 * "/p/..." → "/app/:itemId/p/..."
 */
export function rewritePath(path: string): string {
  if (!_prefix) return path;
  if (path.startsWith(_prefix)) return path;

  // Top-level MADP paths → Blocks equivalents
  if (path === "/projects" || path === "/dashboard" || path === "/home") {
    return _prefix + "/home";
  }
  if (path.startsWith("/new")) return _prefix + path;
  if (path.startsWith("/settings")) return _prefix + path;
  if (path.startsWith("/admin")) return _prefix + path;
  if (path.startsWith("/wiki")) return _prefix + path;
  if (path.startsWith("/billing")) return _prefix + "/settings";
  if (path.startsWith("/p/")) return _prefix + path;

  // Fallback: just prefix it
  return _prefix + path;
}
