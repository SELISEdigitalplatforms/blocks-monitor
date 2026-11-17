/** cr.saveDraft: creates a numbered draft change request, or edits one while it is a draft. */
import { defineDeliveryOp, fail, failFromRule, idArg, optionalIdArg, strictArgs, stringArg } from "../common";
import { lockedMilestones, readMilestones } from "../rows";
import type { ReadPorts } from "../ports";
import { checkChangeDraft } from "../../../../src/domain/delivery";
import { insertWithNextNumber } from "../../../../src/domain/numbering";
import { claimFiles, filesArgs, precheckFiles, readFiles } from "../files";

/** The highest stored change number of the project (0 when there is none). */
async function topChangeNumber(ports: ReadPorts, projectId: string): Promise<number> {
  const top = await ports.query("ChangeRequest", { ProjectId: projectId }, { sort: [{ field: "Number", dir: "desc" }], limit: 1 });
  return typeof top[0]?.Number === "number" ? top[0].Number : 0;
}

export const crSaveDraftOp = defineDeliveryOp({
  permission: "build.run",
  validate(raw: unknown) {
    const a = strictArgs(raw, ["projectId", "changeRequestId", "lane", "featureRef", "title", "description", "attachmentIds", "draftKey"]);
    return {
      projectId: idArg(a.projectId, "projectId"),
      changeRequestId: optionalIdArg(a.changeRequestId, "changeRequestId"),
      lane: stringArg(a.lane, "lane", 20000),
      featureRef: stringArg(a.featureRef, "featureRef", 20000),
      title: stringArg(a.title, "title", 20000),
      description: stringArg(a.description, "description", 20000),
      // the files sent with the request (a design, a screenshot, a document): they stay with the change request
      ...filesArgs(a),
    };
  },
  // Round 1 (the router's): the milestones and the top number (new draft) or the draft itself (edit).
  prefetch: (ports: ReadPorts, args: any) =>
    Promise.all([
      readMilestones(ports, args.projectId),
      args.changeRequestId ? ports.getById("ChangeRequest", args.changeRequestId) : topChangeNumber(ports, args.projectId),
      readFiles(ports, args.projectId, args),
    ]),
  async handler(ctx: any, args: any) {
    const { ports, projectId, workspaceId } = ctx;
    // There is no Feature schema on this base, so the locked milestones are the project's scope.
    // Memo hits after the prefetch; the reads share one round otherwise.
    const [milestones, topNumber, existing, fileRows] = (await Promise.all([
      lockedMilestones(ctx),
      args.changeRequestId ? Promise.resolve(0) : topChangeNumber(ports, projectId),
      args.changeRequestId ? ports.getById("ChangeRequest", args.changeRequestId) : Promise.resolve(null),
      readFiles(ports, projectId, args),
    ])) as [any[], number, any, any[]];
    const featureRefs = [...new Set(milestones.flatMap((m) => (Array.isArray(m.FeatureRefs) ? m.FeatureRefs : [])))] as string[];
    const rule = checkChangeDraft(
      { lane: args.lane, featureRef: args.featureRef, title: args.title, description: args.description },
      featureRefs,
    );
    if (!rule.ok) failFromRule(rule);
    const v = (rule as any).value as { lane: string; featureRef: string; title: string; description: string };

    if (!args.changeRequestId) {
      // every file is one of the caller's own ready change-request uploads (before the request is written)
      precheckFiles(ctx, fileRows, args, "change-request");
      let first = true;
      const res = await insertWithNextNumber({
        readMax: async () => {
          if (first) {
            first = false;
            return topNumber;
          }
          // The retry after a clash: this request's own insert dropped the memo, so the read is fresh.
          return topChangeNumber(ports, projectId);
        },
        insert: (n) =>
          ports.insert(
            "ChangeRequest",
            ctx.stamp({
              ProjectId: projectId,
              Number: n,
              Lane: v.lane,
              FeatureRef: v.featureRef,
              Title: v.title,
              Description: v.description,
              Status: "draft",
              RequestedByUserId: ctx.caller.userId,
            }),
            { requestKey: ctx.requestKey() },
          ),
        isDuplicateKey: ports.isDuplicateKey,
      });
      const createdId = (res.value as any).itemId as string;
      const created = !(res.value as any).existing;
      if (args.attachmentIds.length > 0) {
        let files;
        try {
          files = claimFiles(ctx, fileRows, args, "change-request", createdId);
        } catch (e) {
          if (created) await ports.remove("ChangeRequest", createdId).catch(() => undefined);
          throw e;
        }
        await files.attach(createdId);
      }
      const fileCount = args.attachmentIds.length;
      if (created) await ctx.after(() => ctx.audit("cr.saveDraft", "ChangeRequest", createdId, { lane: v.lane, ...(fileCount ? { files: fileCount, attachmentIds: args.attachmentIds } : {}) }));
      return { changeRequestId: createdId, number: res.number };
    }

    const cr = existing;
    if (!cr || cr.ProjectId !== projectId || (cr.WorkspaceId && cr.WorkspaceId !== workspaceId)) {
      fail("not_found", "delivery.cr.notFound");
    }
    if (cr.Status !== "draft") fail("conflict", "delivery.cr.notDraft");
    const files = claimFiles(ctx, fileRows, args, "change-request", args.changeRequestId);
    // The answer does not depend on the update: it runs in the router's bookkeeping round.
    await ctx.after(() =>
      Promise.all([
        ports.update(
          "ChangeRequest",
          args.changeRequestId,
          ctx.touch({ Lane: v.lane, FeatureRef: v.featureRef, Title: v.title, Description: v.description }),
        ),
        files.attach(args.changeRequestId),
        ctx.audit("cr.saveDraft", "ChangeRequest", args.changeRequestId, { lane: v.lane, ...(files.count ? { files: files.count, attachmentIds: files.ids } : {}) }),
      ]),
    );
    return { changeRequestId: args.changeRequestId as string, number: cr.Number as number };
  },
});
