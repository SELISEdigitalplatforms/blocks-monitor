export type ExtractionStatus = "pending" | "processing" | "ready" | "failed" | "unsupported";

export function extractionStatus(meta: { status?: string; startedAt?: string; sourceType?: string }, findings?: { summary?: string }, now = Date.now()): ExtractionStatus {
  if (meta.status === "processing") {
    const started = Date.parse(meta.startedAt || "");
    return Number.isFinite(started) && now - started > 300_000 ? "failed" : "processing";
  }
  if (["pending", "ready", "failed", "unsupported"].includes(meta.status || "")) return meta.status as ExtractionStatus;
  if (meta.sourceType === "pending") return "pending";
  if (meta.sourceType === "unsupported") return "unsupported";
  if (findings && /normalization failed/i.test(findings.summary || "")) return "failed";
  return findings ? "ready" : "pending";
}

export function extractionSummary(sources: readonly { status: string }[]) {
  const ready = sources.filter(s => s.status === "ready").length;
  const failed = sources.filter(s => s.status === "failed" || s.status === "unsupported").length;
  const active = sources.length - ready - failed;
  const status = !sources.length ? "empty" : active ? "processing" : !failed ? "ready" : ready ? "partial" : "failed";
  return { status, total: sources.length, ready, failed, active };
}
