// Read-only, project-scoped diagnosis. Uses the app's service SDK identity, never a browser session cookie.
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { createBlocksClient } from "@seliseblocks/client";
import { parseMakePrototype } from "../src/domain/figmaMake.ts";
import { parseFigmaScreens } from '../src/domain/figmaScreens.ts';

const projectId = process.argv[2];
if (!/^[A-Za-z0-9_-]{1,64}$/.test(projectId ?? "")) {
  console.error("Usage: node scripts/check-figma-project.mjs <projectId>");
  process.exit(2);
}
const root = fileURLToPath(new URL("../", import.meta.url));
const env = { ...loadEnv("development", root, ""), ...process.env };
try {
  const config = { apiUrl: env.VITE_BLOCKS_API_URL, xBlocksKey: env.MF_BLOCKS_TENANT };
  if (!config.apiUrl || !config.xBlocksKey || !env.MF_SVC_CLIENT_ID || !env.MF_SVC_CLIENT_SECRET) throw new Error("configuration_missing");
  const publicClient = createBlocksClient(config);
  const auth = await publicClient.auth.oidc.clientCredentials({ clientId: env.MF_SVC_CLIENT_ID, clientSecret: env.MF_SVC_CLIENT_SECRET });
  const token = auth?.access_token ?? auth?.accessToken ?? auth?.data?.access_token ?? auth?.data?.accessToken;
  if (typeof token !== "string" || !token) throw new Error("service_auth_failed");
  const client = createBlocksClient({ ...config, accessToken: token });
  async function list(schema, fields, filter, sort = { CreatedDate: -1 }) {
    const response = await client.data.collection(schema, { fields }).list({ filter, sort, pageNo: 1, pageSize: 100 });
    if (response?.errors?.length) throw new Error("gateway_read_failed");
    const data = response?.data?.[`get${schema}s`] ?? response?.data ?? response;
    if (!Array.isArray(data?.items)) throw new Error("gateway_response_invalid");
    return data.items;
  }
  const [projects, briefs, jobs, screens] = await Promise.all([
    list("Project", ["Stage"], { ItemId: projectId }),
    list("DesignBrief", ["Mode", "Status", "PrototypeJson"], { ProjectId: projectId }),
    list("EngineJob", ["Kind", "Status", "InputJson", "OutputRefs", "Message", "ErrorCode", "ClaimedBy", "CreatedDate", "FinishedAt"], { ProjectId: projectId, Kind: "design.generate" }),
    list("DesignScreen", ["DesignBriefId", "EngineJobId"], { ProjectId: projectId }),
  ]);
  const localWorker = `madp-engine-${os.hostname().replace(/[^A-Za-z0-9-]/g, "").slice(0, 40) || "host"}`;
  console.log(JSON.stringify({ projectId, found: projects.length === 1, stage: projects[0]?.Stage,
    briefs: briefs.map(b => {
      const design = parseFigmaScreens(b.PrototypeJson) ?? parseMakePrototype(b.PrototypeJson);
      return { id: b.ItemId, mode: b.Mode, status: b.Status, hasPrototypeJson: !!b.PrototypeJson, validMakePrototype: !!parseMakePrototype(b.PrototypeJson),
        provider: design?.provider ?? null, ...(design?.provider === 'figma-design' ? { screenPreviews: design.screens.length, totalScreens: design.totalScreens ?? design.screens.length, reviewComplete: design.reviewComplete !== false, previewUrl: design.previewUrl } : {}) };
    }),
    jobs: jobs.map(j => {
      let input = {};
      try { input = JSON.parse(j.InputJson ?? "{}"); } catch { /* malformed input is reported without its contents */ }
      const outputs = Array.isArray(j.OutputRefs) ? j.OutputRefs : [];
      return { id: j.ItemId, status: j.Status, workflow: input?.workflow ?? null, source: input?.source ?? null, briefId: input?.designBriefId ?? null,
        createdAt: j.CreatedDate, finishedAt: j.FinishedAt, errorCode: j.ErrorCode ?? null,
        claimedWorkerId: j.ClaimedBy ?? null,
        claimedOnThisMachine: j.ClaimedBy ? j.ClaimedBy === localWorker : null,
        screenshotOutputs: outputs.filter(r => typeof r === "string" && r.startsWith("DesignScreen:")).length,
        makeBriefOutputs: outputs.filter(r => typeof r === "string" && r.startsWith("DesignBrief:")).length,
        savedScreenshotRows: screens.filter(s => s.EngineJobId === j.ItemId).length,
        legacyScreenshotMessage: /screen (?:design|version)|screenshots/i.test(j.Message ?? ""),
      };
    }),
    readsOnly: true,
  }, null, 2));
} catch (error) {
  // Provider response bodies may carry identity/configuration data. Do not print them.
  const safeCodes = ["configuration_missing", "service_auth_failed", "gateway_read_failed", "gateway_response_invalid"];
  console.error(JSON.stringify({ ok: false, code: safeCodes.includes(error?.message) ? error.message : "project_diagnostic_failed" }));
  process.exitCode = 1;
}
