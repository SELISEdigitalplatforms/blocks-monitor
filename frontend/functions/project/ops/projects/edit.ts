import { checkClientField, checkProjectName } from "../../../../src/domain/projects";
import { NEW_REPO_BRANCH, checkBranch, checkNewRepo, checkRepoRef } from "../../../../src/domain/projectType";
import { WEBSITE_URL_MAX, checkWebsiteUrl } from "./create";
import { fail, ok, strictArgs, type OpDef } from "./op";
import { F, SCHEMA } from "./records";

export const projectRename: OpDef<{ projectId: string; name: string }, any> = {
  op: "project.rename",
  permission: "project.edit",
  scope: "project",
  parse(args) {
    const a = strictArgs(args, { projectId: { type: "string" }, name: { type: "string" } });
    if (!a.ok) return a;
    const n = checkProjectName(a.value.name);
    if (!n.ok) return n;
    return { ok: true, value: { projectId: a.value.projectId as string, name: n.value } };
  },
  async run(env, args) {
    const project = await env.ports.db.update(SCHEMA.project, args.projectId, env.stampUpdate({ [F.project.name]: args.name }));
    await env.audit("project.rename", SCHEMA.project, args.projectId, { fields: ["name"] });
    return ok({ project });
  },
};

const CLIENT = ["clientName", "clientContact", "clientIndustry", "clientRegion"] as const;

/**
 * Client fields, and one of two repository cases:
 * - an existing GitHub repository and branch (repo + repoBranch, sent together), while the project is in the Business
 *   step: an existing product's code, or the repository a new product is built in;
 * - a new product, until the build starts: the new repository MADP creates (repoOwner + repoName + repoVisibility,
 *   sent together, with an optional repoBranch; branch main by default).
 * A new product can switch between the two: to a new repository until the build starts, to an existing one until the
 * hand-over. RepoExisting follows the kind ("owner/name", or "" for a new repository) and RepoVisibility is "" for an
 * existing one (patches never carry null).
 */
export const projectUpdate: OpDef<{ projectId: string; patch: Record<string, string>; repo: "existing" | "new" | null }, any> = {
  op: "project.update",
  permission: "project.edit",
  scope: "project",
  parse(args) {
    const spec: Record<string, { type: "string"; optional?: boolean; max?: number }> = { projectId: { type: "string" } };
    for (const k of CLIENT) spec[k] = { type: "string", optional: true };
    spec.websiteUrl = { type: "string", optional: true, max: 4 * WEBSITE_URL_MAX };
    for (const k of ["repo", "repoBranch", "repoOwner", "repoName", "repoVisibility"]) spec[k] = { type: "string", optional: true };
    const a = strictArgs(args, spec);
    if (!a.ok) return a;
    const patch: Record<string, string> = {};
    for (const k of CLIENT) {
      if (a.value[k] === undefined) continue;
      const c = checkClientField(a.value[k], k);
      if (!c.ok) return c;
      patch[F.project[k]] = c.value;
    }
    const v = a.value as Record<string, string | undefined>;
    if (v.websiteUrl !== undefined) {
      // an existing product's website: "" clears it (a new idea's is ignored in run)
      const w = checkWebsiteUrl(v.websiteUrl);
      if (!w.ok) return w;
      patch[F.project.websiteUrl] = w.value;
    }
    const fresh = v.repoOwner !== undefined || v.repoName !== undefined || v.repoVisibility !== undefined;
    // repoBranch goes with whichever kind is sent; alone, it is an incomplete existing repository
    const existing = v.repo !== undefined || (!fresh && v.repoBranch !== undefined);
    if (existing && fresh) return { ok: false, messageKey: "project.repoMixed" };
    if (existing) {
      const ref = checkRepoRef(v.repo ?? "", v.repoBranch ?? "");
      if (!ref.ok) return { ok: false, messageKey: ref.field === "repo" ? "project.repoInvalid" : "project.branchInvalid" };
      patch[F.project.repoProvider] = "github";
      patch[F.project.repoOwner] = ref.value.owner;
      patch[F.project.repoName] = ref.value.name;
      patch[F.project.repoBranch] = ref.value.branch;
      patch[F.project.repoExisting] = `${ref.value.owner}/${ref.value.name}`;
      patch[F.project.repoVisibility] = "";
    }
    if (fresh) {
      const r = checkNewRepo(v.repoOwner ?? "", v.repoName ?? "", v.repoVisibility ?? "");
      if (!r.ok) return { ok: false, messageKey: r.field === "owner" ? "project.repoOwnerInvalid" : r.field === "name" ? "project.repoNameInvalid" : "project.repoVisibilityInvalid" };
      const b = v.repoBranch !== undefined && v.repoBranch.trim() !== "" ? checkBranch(v.repoBranch) : { ok: true as const, value: NEW_REPO_BRANCH };
      if (!b.ok) return { ok: false, messageKey: "project.branchInvalid" };
      patch[F.project.repoProvider] = "github";
      patch[F.project.repoOwner] = r.value.owner;
      patch[F.project.repoName] = r.value.name;
      patch[F.project.repoVisibility] = r.value.visibility;
      patch[F.project.repoBranch] = b.value;
      patch[F.project.repoExisting] = "";
    }
    return { ok: true, value: { projectId: a.value.projectId as string, patch, repo: existing ? "existing" : fresh ? "new" : null } };
  },
  async run(env, args) {
    const p = env.project!;
    if (args.repo === "existing") {
      // MADP analyses (existing product) or builds in (new product) this repository after the hand-over, so it is fixed from then on.
      if (p.step !== "business") return fail("conflict", "project.repoLocked");
    }
    if (args.repo === "new") {
      // MADP creates this repository when the build starts, so it is fixed from then on.
      if (p.repoMode === "existing") return fail("invalid_input", "project.notGreenfield");
      if (p.step === "build" || p.step === "release") return fail("conflict", "project.newRepoLocked");
    }
    // only an existing product has a website: a new idea's is ignored (and a stale one cleared)
    if (p.repoMode !== "existing" && F.project.websiteUrl in args.patch) args.patch[F.project.websiteUrl] = "";
    if (args.repo) await env.ports.verifyRepository?.({
      kind: args.repo, owner: args.patch[F.project.repoOwner], name: args.patch[F.project.repoName],
      branch: args.patch[F.project.repoBranch], visibility: args.patch[F.project.repoVisibility],
    });

    const project = await env.ports.db.update(SCHEMA.project, args.projectId, env.stampUpdate(args.patch));
    await env.audit("project.update", SCHEMA.project, args.projectId, { fields: Object.keys(args.patch) });
    return ok({ project });
  },
};
