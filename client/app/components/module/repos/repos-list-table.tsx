import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useScopedPath } from "@seliseblocks/genesis-os/hooks";
import { formatDate } from "@seliseblocks/genesis-os/utils";
import { ArrowDown, ArrowUp, ExternalLink } from "lucide-react";
import {
  Card,
  CardContent,
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
import { useT } from "@seliseblocks/genesis-os/i18n";

const DEPLOYMENT_DATE_FORMAT: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
};

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
  const { t } = useT("monitor.repos");
  const navigate = useNavigate();
  const scoped = useScopedPath();
  const [search, setSearch] = useState("");
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

  const go = (repoId: string) => navigate(scoped(`repo/${encodeURIComponent(repoId)}`));

  return (
    <Card data-testid="repos-list-table">
      <CardContent className="space-y-4">
        <div className="w-full max-w-md md:w-[42%]">
          <Input
            data-testid="repos-search"
            placeholder={t("REPOS_LIST_TABLE.SEARCH_PLACEHOLDER")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="overflow-x-auto rounded-sm">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 font-medium"
                    onClick={() => setSortDesc((d) => !d)}
                    data-testid="sort-last-deployment"
                    aria-label={
                      sortDesc
                        ? t("REPOS_LIST_TABLE.SORT_OLDEST")
                        : t("REPOS_LIST_TABLE.SORT_NEWEST")
                    }
                  >
                    {t("REPOS_LIST_TABLE.COLUMN_REPOSITORY")}
                    {sortDesc ? (
                      <ArrowDown className="h-3.5 w-3.5" aria-hidden />
                    ) : (
                      <ArrowUp className="h-3.5 w-3.5" aria-hidden />
                    )}
                  </button>
                </TableHead>
                <TableHead>{t("REPOS_LIST_TABLE.COLUMN_BRANCH")}</TableHead>
                <TableHead>{t("common:STATUS")}</TableHead>
                <TableHead>{t("REPOS_LIST_TABLE.COLUMN_LAST_DEPLOYMENT")}</TableHead>
                <TableHead>{t("REPOS_LIST_TABLE.COLUMN_DEPLOYS_TO")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((row) => {
                const url = deploysTo(row);
                const hasStatus = Boolean(row.lastDeploymentStatus);
                const status = row.lastDeploymentStatus || t("REPOS_LIST_TABLE.NO_BUILD");
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
                    <TableCell>{row.branch || "-"}</TableCell>
                    <TableCell>
                      <span
                        className={getDeploymentLogEventBadgeClassName(
                          hasStatus ? status : "NoBuild",
                        )}
                      >
                        {status}
                      </span>
                    </TableCell>
                    <TableCell>
                      {row.lastDeploymentDate
                        ? formatDate(new Date(row.lastDeploymentDate), DEPLOYMENT_DATE_FORMAT)
                        : "-"}
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
                        "-"
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center text-sm text-muted-foreground">
                    {t("REPOS_LIST_TABLE.NO_MATCH")}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
