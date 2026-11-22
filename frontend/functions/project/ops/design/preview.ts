import { defineOp, f, v } from "../../../_lib";
import { parseProductPrototype } from "../../../../src/domain/factoryDesign";
import { screenGallery } from "../../../../src/domain/figmaScreens";

/** Project-scoped query: artifact id comes only from this project's current recorded revision, never client input. */
export const designPreview = defineOp({ op: "designBrief.preview", kind: "view", scope: "project", permission: "view",
  args: v.object({ projectId: v.id(), revision: v.string({ pattern: /^[a-f0-9]{64}$/ }) }),
  async handler(_ctx, args, deps) {
    const rows = await deps.gw.findAll("DesignBrief", { where: f.eq("ProjectId", args.projectId), fields: ["PrototypeJson"], max: 1 });
    const prototype = parseProductPrototype(rows[0]?.PrototypeJson);
    if (!prototype || prototype.provider === 'figma-make' || prototype.projectId !== args.projectId || prototype.revision !== args.revision) return deps.fail("not_found");
    const { url } = await deps.files.downloadUrl(prototype.artifactFileId);
    if (new URL(url).protocol !== "https:") return deps.fail("not_supported");
    // This is the SDK-returned signed storage URL, not a raw Blocks API call or a browser-supplied URL.
    const response = await fetch(url, { signal: AbortSignal.timeout(15000), redirect: "error", credentials: "omit" });
    if (!response.ok || !response.body) return deps.fail("not_supported");
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    try { while (true) { const { value, done } = await reader.read(); if (done) break; size += value.length;
      if (size > (prototype.provider === 'figma-design' ? 24 : 2) * 1024 * 1024) return deps.fail("too_large"); chunks.push(value); }
    } finally { await reader.cancel(); }
    const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const artifact = JSON.parse(new TextDecoder().decode(bytes).replace(/^\uFEFF/, ""));
    if (artifact.provider !== prototype.provider || artifact.projectId !== args.projectId || artifact.revision !== prototype.revision ||
      (artifact.source !== prototype.source && !prototype.source.startsWith("pending:")) || artifact.jobId !== prototype.jobId || typeof artifact.html !== "string") return deps.fail("not_supported");
    if (prototype.provider === 'figma-design') {
      if (!Array.isArray(artifact.screens) || artifact.screens.length !== prototype.screens.length || !artifact.screens.every((s: any, i: number) => s.nodeId === prototype.screens[i].nodeId && typeof s.png === 'string' && /^[A-Za-z0-9+/]+={0,2}$/.test(s.png))) return deps.fail('not_supported');
      const screens = artifact.screens.map((s: any) => {
        const header = atob(s.png.slice(0, 32));
        const uint = (offset: number) => [0, 1, 2, 3].reduce((n, i) => n * 256 + header.charCodeAt(offset + i), 0);
        return { name: s.name, nodeId: s.nodeId, requirementKeys: s.requirementKeys ?? [], png: s.png, width: uint(16), height: uint(20) };
      });
      return { html: screenGallery(artifact.screens), screens, revision: prototype.revision };
    }
    return { html: artifact.html, revision: prototype.revision };
  },
});
