// scope.screens.urls: short-lived screenshot URLs for this project's DesignScreen rows. Reads only; URLs are never stored.
import { ok, fail, parseArgs } from "./ports";
import type { ScopeOpDef } from "./ports";
import { findInProject } from "./shared";

const screensUrls: ScopeOpDef = {
  op: "scope.screens.urls",
  kind: "view",
  permission: "view",
  parse(args) {
    const r = parseArgs({
      projectId: { type: "string", max: 128 },
      screenIds: { type: "string[]", max: 128, maxItems: 50 },
    })(args);
    if (r.ok && r.value.screenIds.length < 1) return { ok: false, messageKey: "input.tooFew", params: { key: "screenIds", min: 1 } };
    return r;
  },
  async run(env, a) {
    const ids: string[] = [...new Set<string>(a.screenIds)];
    const rows = (await Promise.all(ids.map((id) => findInProject(env, "DesignScreen", id)))) as (Record<string, unknown> | null)[];
    if (rows.some((r) => !r)) return fail("not_found");
    // The screenshot is the Storage file id on the row (DesignScreen.ImageFileId).
    const urls = await Promise.all(
      rows.map(async (row, i) => {
        const file = typeof row!.ImageFileId === "string" ? row!.ImageFileId : "";
        if (!file) return { screenId: ids[i], url: null, expiresAt: null };
        const d = await env.files.downloadUrl(file);
        return { screenId: ids[i], url: d.url, expiresAt: d.expiresAt };
      }),
    );
    return ok({ urls });
  },
};

export const SCREEN_HANDLERS: readonly ScopeOpDef[] = [screensUrls];
