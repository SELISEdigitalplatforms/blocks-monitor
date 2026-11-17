/** The feature names of the locked scope version, keyed by every form a ticket's FeatureRef can take
 *  ('feature:<Key>', the Key, the ItemId). Read from the scope's Feature records; an unknown ref keeps its raw value. */
import { useMemo } from "react";
import { useScopeContext } from "@/blocks/scope/context";
import { useFeatures } from "@/blocks/scope/hooks";

const EMPTY: ReadonlyMap<string, string> = new Map();

export function useFeatureNames(projectId: string, version: number | null): ReadonlyMap<string, string> {
  const ctx = useScopeContext(projectId);
  const q = useFeatures(ctx, version);
  return useMemo(() => {
    const items = q.data?.items;
    if (!items?.length) return EMPTY;
    const names = new Map<string, string>();
    for (const f of items) {
      if (!f.name) continue;
      for (const k of [f.ref, f.key, f.id, `feature:${f.id}`]) if (k && !names.has(k)) names.set(k, f.name);
    }
    return names;
  }, [q.data]);
}
