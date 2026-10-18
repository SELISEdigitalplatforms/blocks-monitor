import { useMemo, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Package, Search } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/core";
import { cn } from "@/lib/utils";
import type { ScaDependencyRow, ScaSeverity } from "@/components/module/repos/sca-transform";

const PAGE_SIZE = 5;

const HEADERS = ["Component", "Package", "Version", "Vulnerability", "CVSS", "EPSS %"];

/** Severity soft pills, on the console's status surfaces. */
export const SCA_SEVERITY_BADGE: Record<ScaSeverity, string> = {
  Critical: "bg-destructive/10 text-danger-ink",
  High: "bg-rose-soft text-rose-ink",
  Medium: "bg-sunset-soft text-warn-ink",
  Low: "bg-forest-soft text-forest-ink",
  Unassigned: "bg-surface-warm text-muted-foreground",
};

/** Severity summary tiles: left accent, hover tint, and the selected (filtering) tint. */
export const SCA_SEVERITY_ACCENT: Record<
  ScaSeverity,
  { border: string; hover: string; active: string }
> = {
  Critical: {
    border: "border-destructive",
    hover: "hover:bg-destructive/10",
    active: "bg-destructive/10",
  },
  High: { border: "border-rose", hover: "hover:bg-rose-soft/70", active: "bg-rose-soft" },
  Medium: { border: "border-sunset", hover: "hover:bg-sunset-soft/70", active: "bg-sunset-soft" },
  Low: { border: "border-forest", hover: "hover:bg-forest-soft/70", active: "bg-forest-soft" },
  Unassigned: {
    border: "border-border-default",
    hover: "hover:bg-surface-warm",
    active: "bg-surface-warm",
  },
};

export function ScaDependenciesTable({
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
  const pageNumbers = Array.from(
    { length: Math.min(3, totalPages - currentPage) },
    (_, index) => currentPage + index,
  );

  return (
    <div data-testid="sca-dependencies">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-5 py-3">
        <p className="text-[13px] font-semibold text-high-emphasis">
          Dependencies
          {severityFilter && (
            <span className="font-normal text-muted-foreground"> · {severityFilter} only</span>
          )}
        </p>
        <div className="relative w-full sm:w-64">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <input
            type="text"
            data-testid="sca-search"
            aria-label="Search dependencies"
            className="h-9 w-full rounded-sm border border-border-default bg-card py-2 pl-9 pr-3 text-[13px] text-high-emphasis shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/10"
            placeholder="Search dependencies..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
          />
        </div>
      </div>

      {empty ? (
        <div
          className="flex min-h-[200px] flex-col items-center justify-center gap-3 px-5 py-12 text-center text-sm text-muted-foreground"
          data-testid="sca-empty"
        >
          <Package className="h-6 w-6" aria-hidden="true" />
          No dependencies found.
        </div>
      ) : (
        <Table aria-label="Vulnerable dependencies" className="md:min-w-[760px]">
          <TableHeader>
            <TableRow>
              {HEADERS.map((head) => (
                <TableHead key={head}>{head}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageRows.map((row) => (
              <TableRow
                key={row.id}
                data-testid={`sca-row-${row.id}`}
                role="button"
                tabIndex={0}
                isHoverable
                className="outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                onClick={() => setSelected(row)}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget) return;
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setSelected(row);
                  }
                }}
              >
                <TableCell>
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm bg-surface-warm text-muted-foreground">
                      <Package className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
                    </span>
                    <span className="truncate text-[13px] font-medium text-high-emphasis">
                      {row.component}
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  <span className="text-sm text-muted-foreground">{row.group}</span>
                </TableCell>
                <TableCell>
                  <span className="font-mono text-[13px] text-muted-foreground">{row.version}</span>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <span className="rounded-sm bg-surface-warm px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                      NVD
                    </span>
                    <a
                      href={`https://nvd.nist.gov/vuln/detail/${encodeURIComponent(row.vulnerability)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="whitespace-nowrap font-mono text-[13px] text-primary hover:underline"
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => e.stopPropagation()}
                    >
                      {row.vulnerability}
                    </a>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <span className="text-[13px] font-medium tabular-nums text-high-emphasis">
                      {row.cvss == null ? "N/A" : row.cvss.toFixed(1)}
                    </span>
                    <span
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium",
                        SCA_SEVERITY_BADGE[row.severity],
                      )}
                    >
                      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
                      {row.severity}
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  <span className="text-sm tabular-nums text-muted-foreground">
                    {row.epss == null ? "N/A" : `${row.epss.toFixed(2)}%`}
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {!empty && (
        <nav
          aria-label="Dependencies pagination"
          className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 px-5 py-3"
        >
          <span className="text-xs tabular-nums text-muted-foreground" data-testid="sca-footer">
            {`Showing ${from}-${to} of ${filtered.length} entries`}
          </span>
          {totalPages > 1 && (
            <div className="flex items-center gap-1">
              <PagerButton
                testId="sca-prev"
                label="Previous page"
                disabled={currentPage <= 0}
                onClick={() => setPage(Math.max(0, currentPage - 1))}
              >
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              </PagerButton>

              {pageNumbers.map((pageNum) => (
                <PagerButton
                  key={pageNum}
                  label={`Page ${pageNum + 1}`}
                  current={currentPage === pageNum}
                  onClick={() => setPage(pageNum)}
                >
                  {pageNum + 1}
                </PagerButton>
              ))}

              {totalPages > 3 && !pageNumbers.includes(totalPages - 1) && (
                <>
                  <span className="px-1 text-xs text-muted-foreground" aria-hidden="true">
                    …
                  </span>
                  <PagerButton label={`Page ${totalPages}`} onClick={() => setPage(totalPages - 1)}>
                    {totalPages}
                  </PagerButton>
                </>
              )}

              <PagerButton
                testId="sca-next"
                label="Next page"
                disabled={currentPage >= totalPages - 1}
                onClick={() => setPage(currentPage + 1)}
              >
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </PagerButton>
            </div>
          )}
        </nav>
      )}

      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent data-testid="sca-dialog">
          <DialogHeader className="p-2">
            <DialogTitle>Vulnerability details</DialogTitle>
            <DialogDescription asChild>
              <dl className="space-y-3 pt-4">
                <DetailField label="Name">
                  {selected?.component || "No name available."}
                </DetailField>
                <DetailField label="Group">{selected?.group || "No group available."}</DetailField>
                <DetailField label="Version">
                  {selected?.version || "No version available."}
                </DetailField>
                <DetailField label="Latest Version">
                  {selected?.latestVersion || "No data available."}
                </DetailField>
                <DetailField label="Vulnerability">
                  {selected?.vulnerability || "No vulnerability available."}
                </DetailField>
                <DetailField label="CVSS">
                  {selected?.cvss == null ? "No CVSS available." : selected.cvss.toFixed(1)}
                </DetailField>
                <DetailField label="EPSS Percentile">
                  {selected?.epss == null ? "No EPSS available." : `${selected.epss.toFixed(2)}%`}
                </DetailField>
                <DetailField label="EPSS Score">
                  {selected?.epssScore ?? "No EPSS Score available."}
                </DetailField>
                <DetailField label="CWE Name">
                  {selected?.cweName || "No CWE Name available."}
                </DetailField>
                <DetailField label="Description">
                  {selected?.description || "No description available."}
                </DetailField>
              </dl>
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PagerButton({
  label,
  testId,
  current = false,
  disabled = false,
  onClick,
  children,
}: Readonly<{
  label: string;
  testId?: string;
  current?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}>) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      data-testid={testId}
      aria-label={label}
      aria-current={current ? "page" : undefined}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "h-8 min-w-8 rounded-sm px-2 text-xs tabular-nums",
        current
          ? "bg-primary/[0.07] font-semibold text-primary hover:bg-primary/[0.07]"
          : "text-muted-foreground hover:bg-surface-warm hover:text-high-emphasis",
      )}
    >
      {children}
    </Button>
  );
}

function DetailField({
  label,
  children,
}: Readonly<{
  label: string;
  children: ReactNode;
}>) {
  return (
    <div>
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm text-high-emphasis">{children}</dd>
    </div>
  );
}

export { PAGE_SIZE as SCA_PAGE_SIZE };
