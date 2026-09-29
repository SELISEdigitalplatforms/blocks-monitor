import type { IScaVulnerability } from "@/models/repos.model";

export type ScaSeverity = "Critical" | "High" | "Medium" | "Low" | "Unassigned";

export interface ScaDependencyRow {
  id: string;
  component: string;
  group: string;
  version: string;
  vulnerability: string;
  cvss: number | null;
  severity: ScaSeverity;
  epss: number | null;
  cweName: string;
  description: string;
  latestVersion: string;
  epssScore: number | null | undefined;
}

const SEVERITY_MAP: Record<string, ScaSeverity> = {
  CRITICAL: "Critical",
  HIGH: "High",
  MEDIUM: "Medium",
  LOW: "Low",
};

const SEVERITY_ORDER: Record<ScaSeverity, number> = {
  Critical: 1,
  High: 2,
  Medium: 3,
  Low: 4,
  Unassigned: 5,
};

/** Fixed transform: null-safe EPSS/CVSS; severity then CVSS desc, nulls last. */
export function transformVulnerabilities(
  vulnerabilities: IScaVulnerability[] | null | undefined,
): ScaDependencyRow[] {
  if (!Array.isArray(vulnerabilities) || vulnerabilities.length === 0) return [];

  const transformed = vulnerabilities.map((vuln, index) => {
    const score = vuln.score;
    const cvss =
      score != null && score !== "" ? Number.parseFloat(String(score)) : null;
    const epss =
      vuln.epssPercentile != null && Number.isFinite(vuln.epssPercentile)
        ? vuln.epssPercentile * 100
        : null;
    return {
      id: String(index + 1),
      component: vuln.name ?? "Unknown",
      group: vuln.group ?? "Unknown",
      version: vuln.version ?? "Unknown",
      vulnerability: vuln.id ?? "Unknown",
      cvss: cvss != null && Number.isFinite(cvss) ? cvss : null,
      severity: SEVERITY_MAP[vuln.severity ?? ""] ?? "Unassigned",
      epss,
      cweName: vuln.cweName ?? "Unknown",
      description: vuln.description ?? "No description available",
      latestVersion: vuln.latestVersion ?? "Unknown",
      epssScore: vuln.epssScore,
    } satisfies ScaDependencyRow;
  });

  transformed.sort((a, b) => {
    const orderA = SEVERITY_ORDER[a.severity];
    const orderB = SEVERITY_ORDER[b.severity];
    if (orderA !== orderB) return orderA - orderB;
    if (a.cvss === null && b.cvss === null) return 0;
    if (a.cvss === null) return 1;
    if (b.cvss === null) return -1;
    return b.cvss - a.cvss;
  });

  return transformed.map((item, index) => ({ ...item, id: String(index + 1) }));
}

export function hasNoReport(
  data: { details: Record<string, string> | null } | null | undefined,
): boolean {
  if (data == null) return true;
  if (data.details == null) return true;
  return Object.keys(data.details).length === 0;
}
