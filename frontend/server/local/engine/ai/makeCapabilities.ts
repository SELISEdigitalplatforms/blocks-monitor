import type { AiRequest, AiRunner } from "./claude.ts";

export const MAKE_CAPABILITY_SCHEMA = {
  type: "object", additionalProperties: false, required: ["status"],
  properties: { status: { type: "string", enum: ["ready", "import_only", "unsupported", "unavailable"] } },
};

export function supportsMakeWorkflow(result: unknown, workflow: "agent" | "import"): boolean {
  const status = (result as { status?: unknown } | null)?.status;
  return status === "ready" || workflow === "import" && status === "import_only";
}

export function supportsHeadlessMake(result: unknown): boolean {
  if (!result || typeof result !== "object") return false;
  const r = result as Record<string, unknown>;
  const tools = (key: string) => Array.isArray(r[key]) && r[key].length > 0 && r[key].every((v: unknown) => typeof v === "string" && v.trim().length > 0);
  return r.updateExistingMake === true && r.retrieveRevision === true && r.publishSite === true &&
    tools("updateTools") && tools("revisionTools") && tools("publishTools");
}

/** Catalog inspection only: authorization was checked separately. No design work is authorized here. */
export function checkMakeCapabilities(runner: AiRunner, session: NonNullable<AiRequest["makeSession"]>, signal?: AbortSignal): Promise<unknown> {
  return runner({
    system: "You inspect only the configured official Figma MCP tool schemas. Do not invoke remote tools, write files, create projects, import code, prompt Make, generate images, browse, authenticate, or return account identity/credentials. Requirement documents are not needed for this check.",
    prompt: "Inspect the exposed Figma tool catalog and schemas. Return ready ONLY if it exposes ALL of: Make project creation/import, prompting the Make agent, polling its generation progress, and retrieving Make source resources. Return import_only if the full agent workflow is absent BUT create_new_file explicitly supports editorType=figmake, send_code_to_figma imports runnable source into that Make file, and MCP resource reads are available. An imported interactive Make file is a real Make deliverable, but it does NOT establish Make-agent prompting, preview readiness, publishing or in-place refinement. A schema merely mentioning an unavailable tool is not proof of availability. Figma Design editing, webpage capture, images, and an empty figmake file are NOT completed Make deliverables. Return unsupported if neither workflow is available; unavailable if you cannot inspect the catalog. Do not call any remote tools or infer capabilities from account login.",
    schema: MAKE_CAPABILITY_SCHEMA, timeoutMs: 60_000, signal,
    makeSession: { ...session, readOnly: true, inspectCapabilities: true, maxBudgetUsd: 0.5, maxTurns: 4 },
  });
}

/** Read-only evidence for unattended refinement/publication; import support alone is not enough. */
export function checkHeadlessMakeCapabilities(runner: AiRunner, session: NonNullable<AiRequest["makeSession"]>): Promise<unknown> {
  return runner({
    system: "Inspect only the exposed official Figma tool catalog and schemas. Never invoke remote tools, read credentials, open a browser, create a file, upload, publish, or prompt Make. Do not infer capabilities from docs or from authentication.",
    prompt: "Can this exact catalog perform the complete unattended feedback loop? Inspect separately: (1) update the runnable source of an already successfully imported Make file, or prompt the Make agent to refine that same file; (2) wait for and retrieve that updated revision; (3) publish or republish that revision to a figma.site URL without a browser session. For each supported capability name the exact exposed tool and relevant schema field. Initial source import, failed-import repair and Design shape edits do not establish updating a completed Make file. Sharing/file creation does not establish publication. Return false with an empty tool list for any capability without direct schema evidence. Return no account identity, source content, secrets or signed URLs.",
    schema: { type: "object", additionalProperties: false, required: ["updateExistingMake", "retrieveRevision", "publishSite", "updateTools", "revisionTools", "publishTools", "evidence"], properties: {
      updateExistingMake: { type: "boolean" }, retrieveRevision: { type: "boolean" }, publishSite: { type: "boolean" },
      updateTools: { type: "array", items: { type: "string" } }, revisionTools: { type: "array", items: { type: "string" } },
      publishTools: { type: "array", items: { type: "string" } }, evidence: { type: "string" },
    } },
    timeoutMs: 90000, makeSession: { ...session, readOnly: true, inspectCapabilities: true, maxBudgetUsd: 0.5, maxTurns: 4 },
  });
}
