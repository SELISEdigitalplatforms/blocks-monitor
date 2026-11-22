import {
  SHARE_ITEM_REF_MAX,
  SHARE_ITEM_TYPES,
  SHARE_RECIPIENTS_MAX,
  isInternalLink,
  shareLink,
  type ShareItemType,
} from "../../../../src/domain/projects";
import { shareItemLabel } from "../../../../src/domain/notifications";
import { activeMemberPermissions } from "./assign";
import { fail, ok, strictArgs, type OpDef } from "./op";
import type { GatewayPort, MembersPort } from "./ports";
import { F, SCHEMA } from "./records";

interface ShareArgs {
  projectId: string;
  itemType: ShareItemType;
  itemRef: string;
  userIds: string[];
}

/** The item, the members and the existing shares are independent reads: one round (and one prefetch). */
function createReads(env: { workspaceId: string; ports: { db: Pick<GatewayPort, "query">; members: Pick<MembersPort, "activeMembers" | "customRoles"> } }, args: ShareArgs) {
  const { projectId, itemType, itemRef, userIds } = args;
  return Promise.all([
    itemType === "screens"
      ? Promise.resolve(itemRef === "all" ? [true] : [])
      : env.ports.db.query(itemType === "scope" ? SCHEMA.scopeVersion : SCHEMA.designScreen, {
          ItemId: itemRef,
          ProjectId: projectId,
        }, { limit: 1 }),
    activeMemberPermissions(env),
    env.ports.db.query(SCHEMA.share, {
      [F.share.projectId]: projectId,
      [F.share.itemType]: itemType,
      [F.share.itemRef]: itemRef,
      [F.share.sharedWithUserId]: { in: userIds },
    }),
  ]);
}

export const shareCreate: OpDef<ShareArgs, any> = {
  op: "share.create",
  permission: "share",
  scope: "project",
  parse(args) {
    const a = strictArgs(args, {
      projectId: { type: "string" },
      itemType: { type: "string" },
      itemRef: { type: "string", max: SHARE_ITEM_REF_MAX },
      userIds: { type: "string[]", maxItems: SHARE_RECIPIENTS_MAX, max: 128 },
    });
    if (!a.ok) return a;
    const v = a.value;
    if (!(SHARE_ITEM_TYPES as readonly string[]).includes(v.itemType as string)) {
      return { ok: false, messageKey: "input.wrongType", params: { key: "itemType" } };
    }
    if (!v.itemRef) return { ok: false, messageKey: "input.wrongType", params: { key: "itemRef" } };
    const userIds = [...new Set(v.userIds as string[])];
    if (userIds.length < 1) return { ok: false, messageKey: "input.wrongType", params: { key: "userIds" } };
    return {
      ok: true,
      value: { projectId: v.projectId as string, itemType: v.itemType as ShareItemType, itemRef: v.itemRef as string, userIds },
    };
  },
  prefetch: (env, args) => createReads(env, args),
  async run(env, args) {
    const { projectId, itemType, itemRef, userIds } = args;
    const [target, members, existing] = await createReads(env, args);
    if (target.length === 0) return fail("not_found", "share.itemNotFound");
    for (const u of userIds) {
      if (u === env.userId) return fail("invalid_input", "share.self");
      if (!members.has(u)) return fail("invalid_input", "share.notMember");
    }
    const link = shareLink({ projectId, itemType, itemRef });
    if (!isInternalLink(link)) return fail("invalid_input", "input.invalid");
    const have = new Map(existing.map((s) => [String(s[F.share.sharedWithUserId]), s] as const));
    const missing = userIds.filter((u) => !have.has(u));
    const inserted = await Promise.all(
      missing.map((u) =>
        env.insertOnce(
          SCHEMA.share,
          {
            [F.share.projectId]: projectId,
            [F.share.itemType]: itemType,
            [F.share.itemRef]: itemRef,
            [F.share.sharedByUserId]: env.userId,
            [F.share.sharedWithUserId]: u,
          },
          `natural:share:${projectId}:${itemType}:${itemRef}:${u}`,
        ),
      ),
    );
    for (const s of inserted) have.set(String(s[F.share.sharedWithUserId]), s);
    for (const s of inserted) {
      await env.audit("share.create", SCHEMA.share, s.ItemId, { shareId: s.ItemId, granteeUserId: String(s[F.share.sharedWithUserId]), itemType });
    }
    await Promise.all(
      inserted.map((s) =>
        env.ports.notify.send({
          workspaceId: env.workspaceId,
          kind: "shared",
          recipientUserId: String(s[F.share.sharedWithUserId]),
          projectId,
          link,
          params: { projectName: env.project?.name ?? "", itemLabel: shareItemLabel(itemType) },
          eventKey: `shared:${s.ItemId}`,
        }),
      ),
    );
    return ok({ shares: userIds.map((u) => have.get(u)) });
  },
};

export const shareDelete: OpDef<{ projectId: string; shareId: string }, any> = {
  op: "share.delete",
  permission: "share",
  scope: "project",
  parse(args) {
    const a = strictArgs(args, { projectId: { type: "string" }, shareId: { type: "string", max: 128 } });
    if (!a.ok) return a;
    return { ok: true, value: { projectId: a.value.projectId as string, shareId: a.value.shareId as string } };
  },
  prefetch: (env, { projectId, shareId }) =>
    Promise.all([
      env.ports.db.query(SCHEMA.share, { ItemId: shareId, [F.share.projectId]: projectId }, { limit: 1 }),
      env.warmRemove?.(SCHEMA.share, shareId),
    ]),
  async run(env, { projectId, shareId }) {
    const [share] = await env.ports.db.query(SCHEMA.share, { ItemId: shareId, [F.share.projectId]: projectId }, { limit: 1 });
    if (!share) return fail("not_found", "share.notFound");
    if (share[F.share.sharedByUserId] !== env.userId && !env.permissions.includes("members.manage")) {
      return fail("forbidden", "share.notSharer");
    }
    await env.ports.db.remove(SCHEMA.share, shareId);
    await env.audit("share.delete", SCHEMA.share, shareId, { shareId, granteeUserId: String(share[F.share.sharedWithUserId]) });
    return ok({ shareId });
  },
};
