// One operator annotation: record a terminal design job's verified failure cause on its EngineJob row.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { createBlocksClient } from "@seliseblocks/client";

const [jobId, code, phrase, ...extra] = process.argv.slice(2);
if (!/^[A-Za-z0-9_-]{1,64}$/.test(jobId ?? "") || !code?.startsWith("design.") || process.argv.length !== 5) {
  console.error("Usage: node scripts/note-design-job-failure.mjs <jobId> design.<code> \"<message up to 200 characters>\"");
  console.error("Terminal (failed/cancelled) design jobs only. Preview without --apply; with --apply the row is corrected.");
  process.exit(2);
}
const message = phrase;
if (message.length === 0 || message.length > 200) { console.error("The record message must be 1-200 characters."); process.exit(2); }
const root = fileURLToPath(new URL("../", import.meta.url));
const env = { ...loadEnv("development", root, ""), ...process.env };
const apply = env.APPLY === "1" || env.APPLY === "true";
try {
  const config = { apiUrl: env.VITE_BLOCKS_API_URL, xBlocksKey: env.MF_BLOCKS_TENANT };
  if (!config.apiUrl || !config.xBlocksKey || !env.MF_SVC_CLIENT_ID || !env.MF_SVC_CLIENT_SECRET) throw new Error("configuration_missing");
  const publicClient = createBlocksClient(config);
  const auth = await publicClient.auth.oidc.clientCredentials({ clientId: env.MF_SVC_CLIENT_ID, clientSecret: env.MF_SVC_CLIENT_SECRET });
  const token = auth?.access_token ?? auth?.accessToken ?? auth?.data?.access_token ?? auth?.data?.accessToken;
  if (typeof token !== "string" || !token) throw new Error("service_auth_failed");
  const client = createBlocksClient({ ...config, accessToken: token });
  const page = await client.data.collection("EngineJob").list({
    fields: ["ItemId", "Kind", "Status", "ErrorCode", "Message"], filter: { ItemId: jobId }, pageNo: 1, pageSize: 2,
  });
  if (page?.errors?.length) throw new Error("gateway_read_failed");
  const rows = page?.data?.getEngineJobs?.items ?? [];
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error("job_not_unique");
  const job = rows[0];
  if (job.Kind !== "design.generate") throw new Error("not_a_design_job");
  if (!["failed", "cancelled"].includes(String(job.Status))) throw new Error(`status_${String(job.Status)}_is_not_annotatable`);
  if (apply) {
    await client.data.collection("EngineJob").update(jobId, { ErrorCode: code, Message: message });
  }
  console.log(JSON.stringify({ jobId, status: job.Status, columnName: apply ? "noted" : "preview_only",
    recorded: apply ? { errorCode: code, message } : null, previous: { errorCode: job.ErrorCode ?? null, message: job.Message ?? null } }, null, 2));
} catch (e) {
  console.error(e instanceof Error ? e.message : "Annotation failed.");
  process.exitCode = 1;
}
