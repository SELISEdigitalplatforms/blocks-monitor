// TanStack Query keys. Workspace keys are ["ws", workspaceId, schema, params], so one prefix drops a workspace or a schema.
// Platform-level keys (no workspace) are ["platform", schema, params]. The session's queryClient.clear() drops both on sign-out.

/** A query key of the blocks data layer. */
export type BlocksKey = readonly unknown[];

/** Drops undefined values so {page: 1} and {page: 1, where: undefined} give equal keys. */
function withoutUndefined(params: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

export const blocksKeys = {
  all: () => ["ws"] as const,
  workspace: (workspaceId: string) => ["ws", workspaceId] as const,
  schema: (workspaceId: string, schema: string) => ["ws", workspaceId, schema] as const,
  list: (workspaceId: string, schema: string, params: Readonly<Record<string, unknown>>) =>
    ["ws", workspaceId, schema, { kind: "list", ...withoutUndefined(params) }] as const,
  item: (workspaceId: string, schema: string, id: string) =>
    ["ws", workspaceId, schema, { kind: "item", id }] as const,
  platformAll: () => ["platform"] as const,
  platformSchema: (schema: string) => ["platform", schema] as const,
  platformList: (schema: string, params: Readonly<Record<string, unknown>>) =>
    ["platform", schema, { kind: "list", ...withoutUndefined(params) }] as const,
};
