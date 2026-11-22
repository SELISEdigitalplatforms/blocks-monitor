/** Who may approve or reject a change request on this page: the domain rule (src/domain/delivery.ts changeDecideRight,
 *  the release approvals' decideRight applied to the change) over the project's approvers (changeApproverIds). The
 *  server checks the same rule in cr.decide; this only decides what the page offers. */
import { useMemo } from "react";
import type { DeliveryContext } from "@/blocks/delivery/context";
import type { DeliveryChangeRequest, PolicyRecord } from "@/blocks/delivery/types";
import { changeApproverIds, changeDecideRight, type ChangeDecideRight } from "@/domain/delivery";

export type { ChangeDecideRight };

export function changeRightFor(o: {
  userId: string | null | undefined;
  requesterId: string | null | undefined;
  policies: readonly PolicyRecord[];
  activeMemberIds: readonly string[];
  /** the signed-in role holds release.approve, the permission cr.decide declares (a role without it is refused there) */
  canApprove?: boolean;
}): ChangeDecideRight {
  const approverIds = changeApproverIds(o.policies.flatMap((p) => p.policy.steps), o.activeMemberIds);
  if (!o.userId || o.canApprove === false) return { ok: false, reason: "notApprover", others: approverIds.filter((id) => id !== o.requesterId) };
  return changeDecideRight(o.userId, { requesterId: o.requesterId, approverIds, activeMemberIds: o.activeMemberIds });
}

export function useChangeDecideRight(ctx: DeliveryContext, cr: DeliveryChangeRequest, policies: readonly PolicyRecord[]): ChangeDecideRight {
  return useMemo(
    () => changeRightFor({ userId: ctx.userId, requesterId: cr.createdByUserId, policies, activeMemberIds: ctx.activeMemberIds, canApprove: ctx.can("release.approve") }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ctx.userId, cr.createdByUserId, policies, ctx.activeMemberIds, ctx.permissions],
  );
}
