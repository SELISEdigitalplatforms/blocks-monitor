import { useMemo, useState } from "react";
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
import { getDeploymentLogEventBadgeClassName } from "@/utils/deployment-logs.utils";
import type { ScaDependencyRow, ScaSeverity } from "@/components/module/repos/sca-transform";

const PAGE_SIZE = 5;

const SEVERITY_BADGE: Record<ScaSeverity, string> = {
  Critical: "Failed",
  High: "Failed",
  Medium: "Running",
  Low: "Pending",
  Unassigned: "NoBuild",
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

  // Filter once (A13) — severity then component search
  const filtered = useMemo(() => {
    let list = rows;
    if (severityFilter) {
      list = list.filter((r) => r.severity === severityFilter);
    }
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((r) => r.component.toLowerCase().includes(q));
    }
    return list;
  }, [rows, severityFilter, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);
  const pageRows = filtered.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE);
  const empty = filtered.length === 0;
  const from = empty ? 0 : currentPage * PAGE_SIZE + 1;
  const to = empty ? 0 : Math.min(filtered.length, (currentPage + 1) * PAGE_SIZE);

  const prevDisabled = currentPage <= 0;
  const nextDisabled = empty || currentPage >= totalPages - 1;

  return (
    <div className="space-y-3" data-testid="sca-dependencies">
      <Input
        data-testid="sca-search"
        placeholder="Search components…"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setPage(0);
        }}
      />

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Component</TableHead>
              <TableHead>Package</TableHead>
              <TableHead>Version</TableHead>
              <TableHead>Vulnerability</TableHead>
              <TableHead>CVSS</TableHead>
              <TableHead>EPSS %</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {empty ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground" data-testid="sca-empty">
                  No entries
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
                  <TableCell>
                    <span className="mr-2">{row.cvss == null ? "—" : row.cvss.toFixed(1)}</span>
                    <span className={getDeploymentLogEventBadgeClassName(SEVERITY_BADGE[row.severity])}>
                      {row.severity}
                    </span>
                  </TableCell>
                  <TableCell>{row.epss == null ? "N/A" : `${row.epss.toFixed(2)}%`}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between gap-2 text-sm">
        <span data-testid="sca-footer">
          {empty ? "No entries" : `Showing ${from}–${to} of ${filtered.length} entries`}
        </span>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={prevDisabled}
            data-testid="sca-prev"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            Previous
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={nextDisabled}
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

export { PAGE_SIZE as SCA_PAGE_SIZE };
