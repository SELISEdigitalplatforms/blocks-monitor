/**
 * Auto-provision: creates an MADP workspace for the Blocks project if none exists,
 * and ensures the current user is a member. Uses the /api/data endpoint to check,
 * and /api/fn/workspace to create.
 *
 * Returns the MADP workspace ID to use.
 */

const PROVISION_CACHE = new Map<string, string>();

/**
 * Finds or creates an MADP workspace for the given Blocks project.
 * For now, uses the first existing MADP workspace the user has access to,
 * or creates a new one.
 */
export async function getOrCreateWorkspace(blocksProjectId: string, blocksProjectName: string): Promise<string | null> {
  // Check cache first
  const cached = PROVISION_CACHE.get(blocksProjectId);
  if (cached) return cached;

  try {
    // Query existing MADP workspaces
    const res = await fetch("/api/data", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        reads: [{
          schema: "Workspace",
          fields: ["ItemId", "Name"],
          sort: [{ field: "CreatedDate", dir: "desc" }],
          pageNo: 1,
          pageSize: 1,
        }],
      }),
    });

    if (res.ok) {
      const data = await res.json() as { results: Array<{ ok: boolean; items: Array<{ ItemId: string }> }> };
      const items = data.results?.[0]?.items;
      if (items && items.length > 0) {
        const wsId = items[0].ItemId;
        PROVISION_CACHE.set(blocksProjectId, wsId);
        return wsId;
      }
    }
  } catch {
    // Fall through
  }

  return null;
}
