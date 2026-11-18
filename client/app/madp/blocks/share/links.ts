// External share links: read through the function host, write through it only. The token is returned to the caller once and never kept.
import { useCallback, useState } from "react";
import { useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { newRequestId } from "../fn";
import { callProjectOp } from "../projects/mutations";
import { isNotConfigured, messageFor } from "../projects/messages";
import { t } from "../../i18n";
import type { ShareLinkExpiryDays, ShareLinkItemType, ShareLinkView } from "./types";

export const shareLinkKeys = {
  item: (projectId: string, itemType: string, itemRef: string) => ["shareLinks", projectId, itemType, itemRef] as const,
};

export function useShareLinks(projectId: string, itemType: ShareLinkItemType, itemRef: string, enabled: boolean): UseQueryResult<ShareLinkView[], Error> {
  return useQuery<ShareLinkView[], Error>({
    queryKey: shareLinkKeys.item(projectId, itemType, itemRef),
    queryFn: async () => (await callProjectOp<{ links: ShareLinkView[] }>("shareLink.list", { projectId, itemType, itemRef })).links,
    enabled,
  });
}

function usePending<A, R>(fn: (args: A) => Promise<R>): { run(args: A): Promise<R>; isPending: boolean } {
  const [isPending, setPending] = useState(false);
  const run = useCallback(async (args: A): Promise<R> => {
    setPending(true);
    try {
      return await fn(args);
    } finally {
      setPending(false);
    }
  }, [fn]);
  return { run, isPending };
}

export function useCreateShareLink(): {
  run(args: { projectId: string; itemType: ShareLinkItemType; itemRef: string; expiresInDays: ShareLinkExpiryDays }): Promise<{ link: ShareLinkView; token: string | null }>;
  isPending: boolean;
} {
  const qc = useQueryClient();
  // newRequestId is fresh per run; callFunction's own retries reuse it.
  const create = useCallback(async (a: { projectId: string; itemType: ShareLinkItemType; itemRef: string; expiresInDays: ShareLinkExpiryDays }) => {
    const { projectId, itemType, itemRef, expiresInDays } = a;
    const data = await callProjectOp<{ link: ShareLinkView; token?: string | null }>(
      "shareLink.create", { projectId, itemType, itemRef, expiresInDays }, { requestId: newRequestId() },
    );
    await qc.invalidateQueries({ queryKey: shareLinkKeys.item(projectId, itemType, itemRef) });
    return { link: data.link, token: typeof data.token === "string" ? data.token : null };
  }, [qc]);
  return usePending(create);
}

export function useRevokeShareLink(): { run(args: { projectId: string; shareLinkId: string }): Promise<ShareLinkView>; isPending: boolean } {
  const qc = useQueryClient();
  const revoke = useCallback(async (a: { projectId: string; shareLinkId: string }) => {
    const { projectId, shareLinkId } = a;
    const data = await callProjectOp<{ link: ShareLinkView }>("shareLink.revoke", { projectId, shareLinkId });
    await qc.invalidateQueries({ queryKey: ["shareLinks", projectId] });
    return data.link;
  }, [qc]);
  return usePending(revoke);
}

export function shareLinkError(e: unknown): string {
  return isNotConfigured(e) ? t("common.errors.stepNotAvailable", "This step isn't available yet.") : messageFor(e);
}
