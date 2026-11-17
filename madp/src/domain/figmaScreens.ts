/** Versioned native Figma frames, exported for review without publishing a website. */
export interface FigmaScreens {
  provider: "figma-design";
  projectId: string; projectUrl: string; previewUrl: string;
  revision: string; source: string; jobId: string; artifactFileId: string;
  reviewComplete?: boolean;
  totalScreens?: number;
  screens: { name: string; nodeId: string; requirementKeys: string[]; viewport?: { width: number; height: number } }[];
  /** Requirements with nothing to see on a screen (a background import, a data feed) and the planner's reason. */
  noScreen?: { key: string; title: string; reason: string }[];
}
const validNoScreen = (v: unknown) => v === undefined || (Array.isArray(v) && v.length <= 80 && v.every((n: any) => n &&
  typeof n.key === "string" && n.key.length > 0 && n.key.length <= 256 && typeof n.title === "string" && n.title.length <= 300 &&
  typeof n.reason === "string" && n.reason.trim().length > 0 && n.reason.length <= 300));
export const screenPreviewPath = (projectId: string, revision: string) => `/madp-api/api/design-preview/${encodeURIComponent(projectId)}/${revision}`;
export function figmaDesignUrl(value: unknown): string | null {
  try { const u = new URL(String(value)); return u.protocol === "https:" && /^(www\.)?figma\.com$/.test(u.hostname) &&
    !u.username && !u.password && !u.port && /^\/design\/[A-Za-z0-9_-]+(?:\/|$)/.test(u.pathname) ? u.href : null;
  } catch { return null; }
}
/** What the engine's privacy guard leaves in place of a design-tool link (server/blocks/engineWorker/privacy.ts): the
 *  link itself stays on the engine host, so the app never shows the account behind it. */
export const PRIVATE_LINK = "[private]";

export function parseFigmaScreens(raw: unknown): FigmaScreens | null {
  try {
    const p = typeof raw === "string" ? JSON.parse(raw) : raw as any;
    if (!p || p.provider !== "figma-design" || !(figmaDesignUrl(p.projectUrl) || p.projectUrl === PRIVATE_LINK) ||
      (p.reviewComplete !== undefined && typeof p.reviewComplete !== 'boolean') ||
      (p.totalScreens !== undefined && (!Number.isInteger(p.totalScreens) || p.totalScreens < p.screens?.length || p.totalScreens > 80)) ||
      !validNoScreen(p.noScreen) ||
      ![p.projectId, p.jobId, p.artifactFileId].every((s) => typeof s === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(s)) ||
      !/^[a-f0-9]{64}$/.test(p.revision) || typeof p.source !== "string" || !/^(factory-v1:ux-|pending:)/.test(p.source) ||
      p.previewUrl !== screenPreviewPath(p.projectId, p.revision) || !Array.isArray(p.screens) || !p.screens.length || p.screens.length > 80 ||
      !p.screens.every((s: any) => typeof s.name === "string" && s.name.length > 0 && s.name.length <= 200 && /^\d+:\d+$/.test(s.nodeId) &&
        Array.isArray(s.requirementKeys) && (p.reviewComplete === false || s.requirementKeys.length > 0) && s.requirementKeys.every((k: any) => typeof k === "string") &&
        (s.viewport === undefined || (Number.isInteger(s.viewport?.width) && s.viewport.width > 0 && s.viewport.width <= 20000 &&
          Number.isInteger(s.viewport?.height) && s.viewport.height > 0 && s.viewport.height <= 100000)))) return null;
     return p;
  } catch { return null; }
}
export function screenGallery(screens: { name: string; png: string }[]): string {
  const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Screen designs</title><style>body{margin:0;padding:16px;background:#f3f4f6;color:#17202a;font:14px system-ui}nav{display:flex;flex-wrap:wrap;gap:12px}a{color:#3348a5}section{margin:24px 0}img{display:block;max-width:100%;height:auto;background:white;border:1px solid #ddd;border-radius:8px}h2{font-size:16px}</style></head><body><nav>${screens.map((s, i) => `<a href="#s${i}">${escape(s.name)}</a>`).join("")}</nav>${screens.map((s, i) => `<section id="s${i}"><h2>${escape(s.name)}</h2><img alt="${escape(s.name)}" src="data:image/png;base64,${s.png}"></section>`).join("")}</body></html>`;
}
