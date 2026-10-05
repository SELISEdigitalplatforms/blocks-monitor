import { useMemo, useState, type ReactNode } from "react";
import { ArrowUp, Search } from "lucide-react";
import {
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
import type { ScaDependencyRow, ScaSeverity } from "@/components/module/repos/sca-transform";

const PAGE_SIZE = 5;

const HEADERS = ["Component", "Package", "Version", "Vulnerability", "CVSS", "EPSS %"];

const SEVERITY_BADGE: Record<ScaSeverity, string> = {
  Critical: "bg-red-100 text-red-700 border-red-200",
  High: "bg-orange-100 text-orange-700 border-orange-200",
  Medium: "bg-yellow-100 text-yellow-700 border-yellow-200",
  Low: "bg-green-100 text-green-700 border-green-200",
  Unassigned: "bg-gray-100 text-medium-emphasis border-transition",
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
  const pageNumbers = empty
    ? []
    : Array.from(
        { length: Math.min(3, totalPages - currentPage) },
        (_, index) => currentPage + index,
      );

  return (
    <div data-testid="sca-dependencies">
      <div className="relative my-5 max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-low-emphasis" />
        <input
          type="text"
          data-testid="sca-search"
          className="w-full rounded-md border bg-background py-2 pl-10 pr-4 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          placeholder="Search dependencies..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
        />
      </div>

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              {HEADERS.map((head) => (
                <TableHead key={head}>
                  <span className="flex items-center">
                    <span className="font-semibold text-medium-emphasis">{head}</span>
                    <ArrowUp className="ml-2 h-4 w-4 text-medium-emphasis opacity-50" />
                  </span>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {empty ? (
              <TableRow>
                <TableCell
                  colSpan={HEADERS.length}
                  className="h-24 text-center text-muted-foreground"
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
                  isHoverable
                  className="hover:bg-secondary"
                  onClick={() => setSelected(row)}
                >
                  <TableCell>
                    <span className="text-left text-sm font-medium text-blue-600 hover:text-blue-800">
                      {row.component}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm font-medium text-medium-emphasis">{row.group}</div>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm text-high-emphasis">{row.version}</div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-gray-100 px-2 py-1 text-xs text-low-emphasis">
                        NVD
                      </span>
                      <a
                        href={`https://nvd.nist.gov/vuln/detail/${encodeURIComponent(row.vulnerability)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm font-medium text-blue-600 hover:text-blue-800"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {row.vulnerability}
                      </a>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium text-high-emphasis">
                        {row.cvss == null ? "N/A" : row.cvss.toFixed(1)}
                      </span>
                      <span
                        className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${SEVERITY_BADGE[row.severity]}`}
                      >
                        {row.severity}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm font-medium text-medium-emphasis">
                      {row.epss == null ? "N/A" : `${row.epss.toFixed(2)}%`}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="border-t bg-background px-6 py-4">
        <div className="flex items-center justify-between">
          <span className="text-xs text-low-emphasis" data-testid="sca-footer">
            {empty
              ? "Showing 1-0 of 0 entries"
              : `Showing ${from}-${to} of ${filtered.length} entries`}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={currentPage <= 0}
              data-testid="sca-prev"
              className="px-3 py-2 text-xs text-low-emphasis hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => setPage(Math.max(0, currentPage - 1))}
            >
              Previous
            </button>

            {pageNumbers.map((pageNum) => (
              <button
                key={pageNum}
                type="button"
                className={`rounded px-3 py-2 text-xs font-medium ${
                  currentPage === pageNum
                    ? "bg-accent text-primary"
                    : "text-low-emphasis hover:text-medium-emphasis"
                }`}
                onClick={() => setPage(pageNum)}
              >
                {pageNum + 1}
              </button>
            ))}

            {totalPages > 3 && !pageNumbers.includes(totalPages - 1) && (
              <>
                <span className="px-2 text-xs text-gray-400">...</span>
                <button
                  type="button"
                  className="px-3 py-2 text-xs text-low-emphasis hover:text-primary"
                  onClick={() => setPage(totalPages - 1)}
                >
                  {totalPages}
                </button>
              </>
            )}

            <button
              type="button"
              disabled={empty || currentPage >= totalPages - 1}
              data-testid="sca-next"
              className="px-3 py-2 text-xs text-low-emphasis hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => setPage(currentPage + 1)}
            >
              Next
            </button>
          </div>
        </div>
      </div>

      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent data-testid="sca-dialog">
          <DialogHeader className="p-2">
            <DialogTitle>Vulnerability details</DialogTitle>
            <DialogDescription asChild>
              <div className="py-4">
                <DetailField label="Name" first>
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
                  {selected?.epssScore == null ? "No EPSS Score available." : selected.epssScore}
                </DetailField>
                <DetailField label="CWE Name">
                  {selected?.cweName || "No CWE Name available."}
                </DetailField>
                <DetailField label="Description">
                  {selected?.description || "No description available."}
                </DetailField>
              </div>
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DetailField({
  label,
  first,
  children,
}: Readonly<{
  label: string;
  first?: boolean;
  children: ReactNode;
}>) {
  return (
    <>
      <div className={`${first ? "" : "mt-2 "}text-sm font-bold text-muted-foreground`}>
        {label}
      </div>
      <div className="text-sm">{children}</div>
    </>
  );
}

export { PAGE_SIZE as SCA_PAGE_SIZE };
