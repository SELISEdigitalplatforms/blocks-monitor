/** The project's policy for a change whose checks failed (Project.ChecksPolicy), read on its own (shared by the change
 *  request page and the Release page's attention panel). */
import { useQuery } from "@tanstack/react-query";
import { queryById } from "@/blocks/data/gql";
import { checksPolicyKey } from "@/blocks/delivery/actions";
import { checksPolicyOf, type ChecksPolicy } from "@/domain/changeChecks";

/** The project's policy for a change whose checks failed (Project.ChecksPolicy): read on its own, so a tenant that
 *  does not have the field yet only falls back to the default here. */
export function useChecksPolicyValue(projectId: string): ChecksPolicy {
  const q = useQuery({
    queryKey: checksPolicyKey(projectId),
    queryFn: () => queryById<{ ItemId: string; ChecksPolicy?: string | null }>("Project", projectId, ["ItemId", "ChecksPolicy"]),
    retry: false,
    staleTime: 60_000,
  });
  return checksPolicyOf(q.data?.ChecksPolicy ?? null);
}
