// Read-your-write helpers: put returned rows into the cached gateway lists, then invalidate the schemas.
import type { QueryClient } from "@tanstack/react-query";
import { blocksKeys } from "../data/keys";

export function upsertById<T extends { id: string }>(
  list: readonly T[] | undefined,
  incoming: readonly T[],
  compare?: (a: T, b: T) => number,
): T[] {
  const byId = new Map<string, T>();
  for (const r of list ?? []) byId.set(r.id, r);
  for (const r of incoming) byId.set(r.id, r);
  const out = [...byId.values()];
  return compare ? out.sort(compare) : out;
}

/** Update a cached array, or a Page {items}, in place of the query data; other shapes are left alone. */
export function putRecords<T extends { id: string }>(
  client: QueryClient,
  queryKey: readonly unknown[],
  incoming: readonly T[],
  compare?: (a: T, b: T) => number,
): void {
  client.setQueryData(queryKey, (old: unknown) => {
    if (old === undefined) return old;
    if (Array.isArray(old)) return upsertById(old as T[], incoming, compare);
    if (old && typeof old === "object" && Array.isArray((old as { items?: unknown }).items)) {
      const page = old as { items: T[] };
      return { ...page, items: upsertById(page.items, incoming, compare) };
    }
    return old;
  });
}

export function invalidateCollab(client: QueryClient, workspaceId: string | null, schemas: string[]): void {
  if (!workspaceId) return;
  for (const s of schemas) void client.invalidateQueries({ queryKey: blocksKeys.schema(workspaceId, s) });
}
