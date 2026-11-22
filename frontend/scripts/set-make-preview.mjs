// One operator recording step: make a Figma Make file's published preview site live in the app's design panel.
// The engine never publishes; the file owner publishes in Figma (Sites → Publish) and gets a *.figma.site URL.
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { createBlocksClient } from "@seliseblocks/client";
import { makePreviewUrl } from "../src/domain/figmaMake.ts";
import { prepareMakePreview, verifyMakePreview } from "../server/blocks/engineWorker/makePreview.ts";

const positional = process.argv.slice(2);
const [projectId, previewUrl, fileKey] = positional;
const usage = () => {
  console.error("Usage: APPLY=1 node scripts/set-make-preview.mjs <projectId> <https://name.figma.site> <make file key>");
  console.error("The Make file key is the segment of its figma.com/make/<fileKey> URL. Preview without APPLY=1; APPLY=1 writes.");
  process.exit(2);
};
const apply = process.env.APPLY === "1";
if (!/^[A-Za-z0-9_-]{1,64}$/.test(projectId ?? "") || !/^[A-Za-z0-9_-]{1,128}$/.test(fileKey ?? "") || positional.length !== 3) usage();
const preview = makePreviewUrl(previewUrl);
if (!preview) { console.error("The preview URL must be an https://<name>.figma.site address."); process.exit(2); }
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
  const page = await client.data.collection("DesignBrief", { fields: ["ItemId", "Mode", "Status", "PrototypeJson"] })
    .list({ filter: { ProjectId: projectId }, pageNo: 1, pageSize: 50 });
  if (page?.errors?.length) throw new Error("gateway_read_failed");
  const result = page?.data?.getDesignBriefs;
  if (!Array.isArray(result?.items) || result.hasNextPage) throw new Error("brief_read_incomplete");
  const prepared = prepareMakePreview(result.items, fileKey, preview);
  await verifyMakePreview(preview);
  if (apply && !prepared.unchanged) {
    const update = await client.data.collection("DesignBrief").update(prepared.briefId, prepared.patch);
    if (update?.errors?.length || update?.data?.updateDesignBrief?.acknowledged !== true) throw new Error("preview_update_not_acknowledged");
    const check = await client.data.collection("DesignBrief", { fields: ["PrototypeJson", "Status"] }).get(prepared.briefId);
    const saved = check?.data?.getDesignBriefs?.items?.[0];
    if (check?.errors?.length || saved?.PrototypeJson !== prepared.patch.PrototypeJson || saved?.Status !== "draft") throw new Error("preview_update_not_verified");
  }
  console.log(JSON.stringify({
    briefId: prepared.briefId, fileId: fileKey, mode: prepared.unchanged ? "unchanged" : apply ? "recorded" : "preview_only",
    previewUrl: preview, previous: prepared.previous,
    note: "The panel embeds a published figma.site preview live. It reflects the latest published version; re-run after publishing a new revision.",
  }, null, 2));
} catch (e) {
  console.error(e instanceof Error ? e.message : "Recording failed.");
  process.exitCode = 1;
}
