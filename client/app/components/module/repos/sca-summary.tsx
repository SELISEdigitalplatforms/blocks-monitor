import type { ScaSeverity } from "@/components/module/repos/sca-transform";

const SEVERITIES: ScaSeverity[] = ["Critical", "High", "Medium", "Low", "Unassigned"];

export function ScaSummaryHeader({
  details,
}: {
  details: Record<string, string>;
}) {
  return (
    <div className="flex flex-wrap gap-6 text-sm" data-testid="sca-header">
      <Stat label="Total components" value={details.components} />
      <Stat label="Vulnerable components" value={details.vulnerableComponents} />
      <Stat label="Risk Score" value={details.inheritedRiskScore} />
    </div>
  );
}

export function ScaSummaryTiles({
  details,
  activeSeverity,
  onToggleSeverity,
}: {
  details: Record<string, string>;
  activeSeverity: ScaSeverity | null;
  onToggleSeverity: (s: ScaSeverity) => void;
}) {
  const counts: Record<ScaSeverity | "Total", string> = {
    Total: details.vulnerabilities ?? "—",
    Critical: details.critical ?? "0",
    High: details.high ?? "0",
    Medium: details.medium ?? "0",
    Low: details.low ?? "0",
    Unassigned: details.unassigned ?? "0",
  };

  return (
    <div className="grid gap-3 sm:grid-cols-3 md:grid-cols-6" data-testid="sca-summary-tiles">
      <div className="rounded-lg border p-3" data-testid="sca-tile-total">
        <p className="text-xs text-muted-foreground">Total vulnerabilities</p>
        <p className="text-lg font-semibold">{counts.Total}</p>
      </div>
      {SEVERITIES.map((s) => {
        const active = activeSeverity === s;
        return (
          <button
            key={s}
            type="button"
            data-testid={`sca-tile-${s.toLowerCase()}`}
            aria-pressed={active}
            className={`rounded-lg border p-3 text-left transition ${active ? "border-primary bg-primary/5" : "hover:bg-muted/40"}`}
            onClick={() => onToggleSeverity(s)}
          >
            <p className="text-xs text-muted-foreground">{s}</p>
            <p className="text-lg font-semibold">{counts[s]}</p>
          </button>
        );
      })}
    </div>
  );
}

function Stat({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <p className="text-muted-foreground">{label}</p>
      <p className="font-medium">{value != null && value !== "" ? value : "—"}</p>
    </div>
  );
}
