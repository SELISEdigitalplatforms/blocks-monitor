import { useMemo, useState } from "react";
import { ArrowUp, Search } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/core";
import { useGetReport } from "@/hooks/use-repos";
import {
  hasNoReport,
  transformVulnerabilities,
  type ScaDependencyRow,
  type ScaSeverity,
} from "@/components/module/repos/sca-transform";
import {
  ReportErrorCard,
  ReportLoadingCard,
  ReportNoDataCard,
} from "@/components/module/repos/report-states";

const PAGE_SIZE = 5;
const SEVERITIES: Array<ScaSeverity | "Total"> = [
  "Total",
  "Critical",
  "High",
  "Medium",
  "Low",
  "Unassigned",
];

const SEVERITY_COLORS: Record<ScaSeverity | "Total", string> = {
  Total: "border-red-600",
  Critical: "border-red-500",
  High: "border-orange-500",
  Medium: "border-yellow-500",
  Low: "border-green-500",
  Unassigned: "border-slate-500",
};

export function ScaTab({
  projectKey,
  buildId,
  isActive,
}: Readonly<{
  projectKey: string;
  buildId: string | undefined;
  isActive: boolean;
}>) {
  const { data, isLoading, isError, refetch } = useGetReport(
    projectKey,
    buildId,
    "sca-libraries",
    isActive,
  );
  const [severity, setSeverity] = useState<ScaSeverity | null>(null);

  const details = data?.data?.details ?? null;
  const rows = useMemo(
    () => transformVulnerabilities(data?.data?.vulnerabilities),
    [data?.data?.vulnerabilities],
  );

  if (isLoading) return <ReportLoadingCard label="Loading SCA report..." />;
  if (isError) return <ReportErrorCard onRetry={() => refetch()} />;
  if (hasNoReport(data?.data ?? null)) return <ReportNoDataCard />;
  if (!details) return <ReportNoDataCard />;

  return (
    <section className="rounded-sm border bg-background p-6 shadow-sm" data-testid="sca-tab">
      <h2 className="text-lg font-semibold text-high-emphasis">Software library package</h2>

      <div className="mt-8 flex flex-wrap gap-4 text-sm" data-testid="sca-header">
        <InlineStat label="Total components" value={details.components} />
        <InlineStat label="Vulnerable components" value={details.vulnerableComponents} />
        <InlineStat label="Risk Score" value={details.inheritedRiskScore} />
      </div>

      <div className="mt-7 grid gap-5 md:grid-cols-3 xl:grid-cols-6" data-testid="sca-summary-tiles">
        {SEVERITIES.map((item) => (
          <SeverityMetric
            key={item}
            label={item === "Total" ? "Total vulnerabilities" : item}
            value={countFor(details, item)}
            severity={item}
            active={severity === item}
            onClick={item === "Total" ? undefined : () => setSeverity((prev) => (prev === item ? null : item))}
          />
        ))}
      </div>

      <div className="my-6 border-t" />

      <ScaDependenciesTable rows={rows} severityFilter={severity} />
    </section>
  );
}

function ScaDependenciesTable({
  rows,
  severityFilter,
}: Readonly<{
  rows: ScaDependencyRow[];
  severityFilter: ScaSeverity | null;
}>) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<ScaDependencyRow | null>(null);

  const filtered = useMemo(() => {
    let list = rows;
    if (severityFilter) list = list.filter((row) => row.severity === severityFilter);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((row) => row.component.toLowerCase().includes(q));
    return list;
  }, [rows, severityFilter, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);
  const pageRows = filtered.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE);
  const empty = filtered.length === 0;
  const from = empty ? 0 : currentPage * PAGE_SIZE + 1;
  const to = empty ? 0 : Math.min(filtered.length, (currentPage + 1) * PAGE_SIZE);

  return (
    <div data-testid="sca-dependencies">
      <div className="relative w-full max-w-md">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          data-testid="sca-search"
          className="pl-11"
          placeholder="Search dependencies..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
        />
      </div>

      <div className="mt-7 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              {["Component", "Package", "Version", "Vulnerability", "CVSS", "EPSS %"].map((head) => (
                <TableHead key={head} className="text-base font-semibold text-high-emphasis">
                  <span className="inline-flex items-center gap-2">
                    {head}
                    <ArrowUp className="h-4 w-4 text-muted-foreground" />
                  </span>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {empty ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="h-28 text-center text-muted-foreground"
                  data-testid="sca-empty"
                >
                  No dependencies found.
                </TableCell>
              </TableRow>
            ) : (
              pageRows.map((row) => (
                <TableRow
                  key={row.id}
                  data-testid={`sca-row-${row.id}`}
                  className="cursor-pointer"
                  onClick={() => setSelected(row)}
                >
                  <TableCell>{row.component}</TableCell>
                  <TableCell>{row.group}</TableCell>
                  <TableCell>{row.version}</TableCell>
                  <TableCell>
                    <a
                      href={`https://nvd.nist.gov/vuln/detail/${encodeURIComponent(row.vulnerability)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {row.vulnerability}
                    </a>
                  </TableCell>
                  <TableCell>{row.cvss == null ? "-" : row.cvss.toFixed(1)}</TableCell>
                  <TableCell>{row.epss == null ? "N/A" : `${row.epss.toFixed(2)}%`}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="mt-7 flex items-center justify-between border-t pt-6 text-sm text-muted-foreground">
        <span data-testid="sca-footer">
          {empty ? "Showing 1-0 of 0 entries" : `Showing ${from}-${to} of ${filtered.length} entries`}
        </span>
        <div className="flex gap-8">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={currentPage <= 0}
            data-testid="sca-prev"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            Previous
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={empty || currentPage >= totalPages - 1}
            data-testid="sca-next"
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      </div>

      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent data-testid="sca-dialog">
          <DialogHeader>
            <DialogTitle>{selected?.vulnerability}</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-2 text-sm">
              <p>
                <span className="text-muted-foreground">Component:</span> {selected.component}
              </p>
              <p>
                <span className="text-muted-foreground">CWE:</span> {selected.cweName}
              </p>
              <p>{selected.description}</p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function InlineStat({
  label,
  value,
}: Readonly<{
  label: string;
  value?: string;
}>) {
  return (
    <span className="text-muted-foreground">
      {label}: <span className="font-semibold text-high-emphasis">{display(value)}</span>
    </span>
  );
}

function SeverityMetric({
  label,
  value,
  severity,
  active,
  onClick,
}: Readonly<{
  label: string;
  value: string;
  severity: ScaSeverity | "Total";
  active: boolean;
  onClick?: () => void;
}>) {
  const content = (
    <>
      <p className="font-semibold text-high-emphasis">{label}</p>
      <p className="mt-3 text-2xl font-semibold text-high-emphasis">{value}</p>
    </>
  );

  const className = `border-l-4 ${SEVERITY_COLORS[severity]} py-1 pl-4 text-left ${
    active ? "bg-secondary/70" : ""
  }`;

  if (!onClick) {
    return (
      <div className={className} data-testid="sca-tile-total">
        {content}
      </div>
    );
  }

  return (
    <button
      type="button"
      data-testid={`sca-tile-${severity.toLowerCase()}`}
      aria-pressed={active}
      className={`${className} transition hover:bg-secondary/70`}
      onClick={onClick}
    >
      {content}
    </button>
  );
}

function countFor(details: Record<string, string>, severity: ScaSeverity | "Total"): string {
  if (severity === "Total") return display(details.vulnerabilities);
  return display(details[severity.toLowerCase()]);
}

function display(value?: string): string {
  return value != null && value !== "" ? value : "0";
}
