import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useScopedPath } from "@seliseblocks/genesis-os/hooks";
import { formatDate } from "@seliseblocks/genesis-os/utils";
import { ExternalLink } from "lucide-react";
import {
  Button,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/core";
import type { IRepoListItem } from "@/models/alerts.model";
import { getDeploymentLogEventBadgeClassName } from "@/utils/deployment-logs.utils";

const DEPLOYMENT_DATE_FORMAT: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
};

const PAGE_SIZE = 10;

/** List item may carry optional deployment fields when the driver widens the payload. */
type RepoRow = IRepoListItem & {
  branch?: string | null;
  lastDeploymentDate?: string | null;
  lastDeploymentStatus?: string | null;
};

function deploysTo(row: RepoRow): string | null {
  return row.customDeploymentUrl || row.defaultDeploymentUrl || null;
}

function shortName(repoName: string): string {
  return repoName.split("/").pop() || repoName;
}

export function ReposListTable({ rows }: Readonly<{ rows: RepoRow[] }>) {
  const navigate = useNavigate();
  const scoped = useScopedPath();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [sortDesc, setSortDesc] = useState(true);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = rows;
    if (q) list = list.filter((r) => r.repoName.toLowerCase().includes(q));
    list = [...list].sort((a, b) => {
      const da = a.lastDeploymentDate ? Date.parse(a.lastDeploymentDate) : 0;
      const db = b.lastDeploymentDate ? Date.parse(b.lastDeploymentDate) : 0;
      return sortDesc ? db - da : da - db;
    });
    return list;
  }, [rows, search, sortDesc]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);
  const pageRows = filtered.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE);

  const go = (repoId: string) => navigate(scoped(`repos/${encodeURIComponent(repoId)}`));

  return (
    <div className="space-y-3" data-testid="repos-list-table">
      <Input
        data-testid="repos-search"
        placeholder="Search repositories…"
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
              <TableHead>
                <button
                  type="button"
                  className="font-medium"
                  onClick={() => setSortDesc((d) => !d)}
                  data-testid="sort-last-deployment"
                >
                  Repository {sortDesc ? "↓" : "↑"}
                </button>
              </TableHead>
              <TableHead>Branch</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last deployment</TableHead>
              <TableHead>Deploys to</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageRows.map((row) => {
              const url = deploysTo(row);
              const status = row.lastDeploymentStatus || "No build";
              return (
                <TableRow
                  key={row.itemId}
                  data-testid={`repo-row-${row.itemId}`}
                  tabIndex={0}
                  className="cursor-pointer"
                  onClick={() => go(row.itemId)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      go(row.itemId);
                    }
                  }}
                >
                  <TableCell>
                    <div className="font-medium">{shortName(row.repoName)}</div>
                    <div className="text-xs text-muted-foreground">{row.repoName}</div>
                  </TableCell>
                  <TableCell>{row.branch || "—"}</TableCell>
                  <TableCell>
                    <span className={getDeploymentLogEventBadgeClassName(status === "No build" ? "NoBuild" : status)}>
                      {status}
                    </span>
                  </TableCell>
                  <TableCell>
                    {row.lastDeploymentDate
                      ? formatDate(new Date(row.lastDeploymentDate), DEPLOYMENT_DATE_FORMAT)
                      : "—"}
                  </TableCell>
                  <TableCell>
                    {url ? (
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-primary underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {url.replace(/^https?:\/\//, "").slice(0, 40)}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={currentPage <= 0}
          onClick={() => setPage((p) => Math.max(0, p - 1))}
        >
          Previous
        </Button>
        <span className="text-sm text-muted-foreground">
          {currentPage + 1} / {totalPages}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={currentPage >= totalPages - 1}
          onClick={() => setPage((p) => p + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
