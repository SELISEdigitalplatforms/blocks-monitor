/** Shared, network-free contract for the planner's versioned Make deliverable. */
export interface MakePrototype {
  provider: "figma-make";
  projectUrl: string;
  previewUrl: string | null;
  revision: string;
  source: string;
  jobId: string;
  artifactFileId: string;
}

export function makeProjectUrl(value: unknown): string | null {
  const u = safeUrl(value);
  return u && /^(www\.)?figma\.com$/.test(u.hostname) && /^\/make\/[A-Za-z0-9_-]+(?:\/|$)/.test(u.pathname) ? u.href : null;
}

/** Published Make sites only; never frame arbitrary client-provided hosts or the editor. */
export function makePreviewUrl(value: unknown): string | null {
  const u = safeUrl(value);
  return u && /^[a-z0-9-]+\.figma\.site$/.test(u.hostname) ? u.href : null;
}

function safeUrl(value: unknown): URL | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const u = new URL(value);
    return u.protocol === "https:" && !u.username && !u.password && !u.port ? u : null;
  } catch { return null; }
}

export function parseMakePrototype(raw: unknown): MakePrototype | null {
  try {
    const p = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!p || p.provider !== "figma-make" || !makeProjectUrl(p.projectUrl) ||
      (p.previewUrl !== null && !makePreviewUrl(p.previewUrl)) ||
      ![p.revision, p.source, p.jobId, p.artifactFileId].every((v) => typeof v === "string" && v.length > 0 && v.length <= 256)) return null;
    return { provider: "figma-make", projectUrl: makeProjectUrl(p.projectUrl)!, previewUrl: makePreviewUrl(p.previewUrl), revision: p.revision, source: p.source, jobId: p.jobId, artifactFileId: p.artifactFileId };
  } catch { return null; }
}

export interface DesignRequirement { key: string; title: string; text: string; criteria: readonly string[] }

/** Planner-owned direction: users change requirements or submit tracked feedback, not this text. */
export function automaticDesignDirection(requirements: readonly DesignRequirement[]): string {
  return [
    "Derive the product journeys, screen inventory and visual direction from the supplied requirements and acceptance criteria.",
    "Design every required role and primary workflow, with responsive layouts, accessible typography and contrast, keyboard focus, and touch-friendly controls.",
    "Include loading, empty, validation, error, success and permission-denied states. Use realistic fictional content and do not invent business scope.",
    "Choose a coherent visual identity suited to the product. Record assumptions and map screens to requirement keys in the design handoff.",
    `Required capabilities: ${[...requirements].sort((a, b) => a.key.localeCompare(b.key)).map((r) => `${r.key}: ${r.title}`).join("; ").slice(0, 6000)}`,
  ].join("\n");
}

/** Change detector, not an authorisation token. Normalised identically in browser, function and engine. */
export function designSource(instructions: string, requirements: readonly DesignRequirement[]): string {
  const input = JSON.stringify([instructions, [...requirements].sort((a, b) => a.key.localeCompare(b.key)).map((r) => [r.key, r.title, r.text, [...r.criteria]])]);
  let a = 2166136261, b = 5381;
  for (let i = 0; i < input.length; i++) { a = Math.imul(a ^ input.charCodeAt(i), 16777619); b = Math.imul(b, 33) ^ input.charCodeAt(i); }
  return `ux-${(a >>> 0).toString(16)}-${(b >>> 0).toString(16)}`;
}

export function rawDesignRequirements(rows: readonly Record<string, unknown>[]): DesignRequirement[] {
  return rows.filter((r) => r.Status !== "dropped").map((r) => ({ key: String(r.Key || r.ItemId || ""), title: String(r.Title || ""), text: String(r.Text || ""), criteria: Array.isArray(r.AcceptanceCriteria) ? r.AcceptanceCriteria.map(String) : [] }));
}
