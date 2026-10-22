import { cn } from "@/lib/utils";
import type { ScaSeverity } from "@/components/module/repos/sca-transform";
import { SCA_SEVERITY_ACCENT } from "@/components/module/repos/sca-dependencies-table";

const SEVERITIES: ScaSeverity[] = ["Critical", "High", "Medium", "Low", "Unassigned"];

export function ScaSummaryHeader({
  details,
}: Readonly<{
  details: Record<string, string>;
}>) {
  return (
    <dl className="flex flex-wrap gap-x-5 gap-y-2 text-[13px]" data-testid="sca-header">
      <Stat label="Total components" value={details.components} />
      <Stat label="Vulnerable components" value={details.vulnerableComponents} />
      <Stat label="Risk Score" value={details.inheritedRiskScore} />
    </dl>
  );
}

export function ScaSummaryTiles({
  details,
  activeSeverity,
  onToggleSeverity,
}: Readonly<{
  details: Record<string, string>;
  activeSeverity: ScaSeverity | null;
  onToggleSeverity: (s: ScaSeverity) => void;
}>) {
  const counts: Record<ScaSeverity | "Total", string> = {
    Total: details.vulnerabilities ?? "—",
    Critical: details.critical ?? "0",
    High: details.high ?? "0",
    Medium: details.medium ?? "0",
    Low: details.low ?? "0",
    Unassigned: details.unassigned ?? "0",
  };

  const tile = "block w-full rounded-sm border-l-[3px] px-3 py-2.5 text-left";

  return (
    <div
      className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-6"
      data-testid="sca-summary-tiles"
    >
      <div
        className={cn(tile, "border-high-emphasis/70 bg-surface-warm/40")}
        data-testid="sca-tile-total"
      >
        <p className="text-[11px] font-medium text-muted-foreground">Total vulnerabilities</p>
        <p className="mt-0.5 text-xl font-semibold tabular-nums text-high-emphasis">
          {counts.Total}
        </p>
      </div>
      {SEVERITIES.map((s) => {
        const active = activeSeverity === s;
        const accent = SCA_SEVERITY_ACCENT[s];
        return (
          <button
            key={s}
            type="button"
            data-testid={`sca-tile-${s.toLowerCase()}`}
            aria-pressed={active}
            className={cn(
              tile,
              "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              accent.border,
              active ? accent.active : cn("bg-surface-warm/40", accent.hover),
            )}
            onClick={() => onToggleSeverity(s)}
          >
            <p className="text-[11px] font-medium text-muted-foreground">{s}</p>
            <p className="mt-0.5 text-xl font-semibold tabular-nums text-high-emphasis">
              {counts[s]}
            </p>
          </button>
        );
      })}
    </div>
  );
}

function Stat({ label, value }: Readonly<{ label: string; value?: string }>) {
  return (
    <div className="flex items-center gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-semibold tabular-nums text-high-emphasis">
        {value != null && value !== "" ? value : "—"}
      </dd>
    </div>
  );
}
