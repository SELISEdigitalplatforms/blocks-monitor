import { useMemo, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { useScopedPath } from "@seliseblocks/app-kit/hooks";
import { formatDate } from "@seliseblocks/app-kit/utils";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpRight, FolderGit2, GitBranch } from "lucide-react";
import {
  Button,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/core";
import { cn } from "@/lib/utils";
import type { IRepoListItem } from "@/models/alerts.model";
import { RepoStatusBadge } from "@/components/module/repos/repo-status-badge";
import {
  REPOS_SORT_PROPERTY,
  useReposFilterQueryParams,
} from "@/components/module/repos/use-repos-filter-query-params";

const DEPLOYMENT_DATE_FORMAT: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
};

/** List item may carry optional deployment fields when the driver widens the payload. */
export type RepoRow = IRepoListItem & {
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

function deploymentTime(row: RepoRow): number {
  return row.lastDeploymentDate ? Date.parse(row.lastDeploymentDate) || 0 : 0;
}

/** Keeps a click or key press on a control inside a row from also opening the row. */
const stopRowNavigation = (event: MouseEvent | KeyboardEvent) => event.stopPropagation();

const columnHelper = createColumnHelper<RepoRow>();

const buildColumns = (sortHeader: ReactNode) => [
  columnHelper.accessor("repoName", {
    header: "Repository",
    cell: (info) => (
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm bg-surface-warm text-muted-foreground">
          <FolderGit2 className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium text-high-emphasis">
            {shortName(info.getValue())}
          </p>
          <p className="truncate text-xs text-muted-foreground" title={info.getValue()}>
            {info.getValue()}
          </p>
        </div>
      </div>
    ),
  }),
  columnHelper.accessor("branch", {
    header: "Branch",
    cell: (info) =>
      info.getValue() ? (
        <span className="inline-flex max-w-full items-center gap-1.5 font-mono text-[13px] text-muted-foreground">
          <GitBranch className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{info.getValue()}</span>
        </span>
      ) : (
        <span className="text-sm text-muted-foreground">-</span>
      ),
  }),
  columnHelper.accessor("lastDeploymentStatus", {
    header: "Status",
    cell: (info) => {
      const status = info.getValue();
      return status ? (
        <RepoStatusBadge status={status} />
      ) : (
        <RepoStatusBadge status="NoBuild" label="No build" />
      );
    },
  }),
  columnHelper.accessor("lastDeploymentDate", {
    header: () => sortHeader,
    cell: (info) => {
      const value = info.getValue();
      return (
        <span className="whitespace-nowrap text-sm text-muted-foreground">
          {value ? formatDate(new Date(value), DEPLOYMENT_DATE_FORMAT) : "-"}
        </span>
      );
    },
  }),
  columnHelper.display({
    id: "deploysTo",
    header: "Deploys to",
    cell: ({ row }) => {
      const url = deploysTo(row.original);
      return url ? (
        <span className="block truncate font-mono text-[13px] text-muted-foreground" title={url}>
          {url.replace(/^https?:\/\//, "")}
        </span>
      ) : (
        <span className="text-sm text-muted-foreground">-</span>
      );
    },
  }),
  columnHelper.display({
    id: "actions",
    header: () => <span className="sr-only">Actions</span>,
    cell: ({ row }) => {
      const url = deploysTo(row.original);
      if (!url) return null;
      const label = `Open ${shortName(row.original.repoName)} deployment`;
      return (
        <div className="flex items-center justify-end">
          <Button
            asChild
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-sm text-muted-foreground hover:bg-surface-warm hover:text-high-emphasis"
          >
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={label}
              title={label}
              onClick={stopRowNavigation}
              onKeyDown={stopRowNavigation}
            >
              <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
            </a>
          </Button>
        </div>
      );
    },
  }),
];

const COLUMN_CLASS: Record<string, string> = {
  repoName: "w-[30%]",
  branch: "w-[14%]",
  lastDeploymentStatus: "w-[14%]",
  lastDeploymentDate: "w-[18%]",
  actions: "w-16 text-right",
};

/** Skeleton rows matching the real row rhythm. */
export function ReposListLoading() {
  return (
    <div data-testid="repos-list-loading" className="flex flex-col divide-y divide-border/50">
      {Array.from({ length: 8 }).map((_, index) => (
        <div key={index} className="px-5 py-4">
          <Skeleton className="h-8 w-full rounded-sm" />
        </div>
      ))}
      <span className="sr-only">Loading repositories…</span>
    </div>
  );
}

/** In-card empty state: entity icon over a short muted sentence. */
export function ReposListEmpty({
  message,
  testId,
}: Readonly<{
  message: string;
  testId?: string;
}>) {
  return (
    <div
      data-testid={testId}
      className="flex min-h-[420px] flex-col items-center justify-center gap-3 px-5 py-16 text-center text-sm text-muted-foreground"
    >
      <FolderGit2 className="h-6 w-6" aria-hidden="true" />
      {message}
    </div>
  );
}

/**
 * The body of the repos list card: skeleton rows while loading, the in-card empty state, or the
 * kit `Table`. Search and sort are read from the URL (`useReposFilterQueryParams`).
 */
export function ReposListTable({
  rows,
  isLoading = false,
}: Readonly<{
  rows: RepoRow[];
  isLoading?: boolean;
}>) {
  const navigate = useNavigate();
  const scoped = useScopedPath();
  const { queryParams, setQueryParams } = useReposFilterQueryParams();
  const { search, isDescending } = queryParams;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q ? rows.filter((r) => r.repoName.toLowerCase().includes(q)) : rows;
    return [...list].sort((a, b) =>
      isDescending ? deploymentTime(b) - deploymentTime(a) : deploymentTime(a) - deploymentTime(b),
    );
  }, [rows, search, isDescending]);

  const SortIcon = isDescending ? ArrowDown : ArrowUp;
  const sortHeader = (
    <button
      type="button"
      data-testid="sort-last-deployment"
      className="-mx-1 inline-flex items-center gap-2 rounded-sm px-1 text-xs font-semibold uppercase tracking-wide text-high-emphasis focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={() =>
        void setQueryParams({ sortProperty: REPOS_SORT_PROPERTY, isDescending: !isDescending })
      }
      aria-label={
        isDescending
          ? "Sort repositories by oldest deployment"
          : "Sort repositories by newest deployment"
      }
    >
      Last deployment
      <SortIcon className="h-4 w-4" aria-hidden="true" />
    </button>
  );

  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: filtered,
    columns: buildColumns(sortHeader),
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.itemId,
  });

  const open = (repoId: string) => navigate(scoped(`repo/${encodeURIComponent(repoId)}`));

  if (isLoading) return <ReposListLoading />;

  if (rows.length === 0) {
    return <ReposListEmpty testId="repos-empty" message="No repositories deployed yet" />;
  }

  if (filtered.length === 0) {
    return <ReposListEmpty testId="repos-no-match" message="No repositories match your search." />;
  }

  // The kit Table's own container scrolls wide tables inside the card.
  return (
    <Table aria-label="Repositories" className="table-fixed md:min-w-[860px]">
      <TableHeader>
        {table.getHeaderGroups().map((headerGroup) => (
          <TableRow key={headerGroup.id}>
            {headerGroup.headers.map((header) => {
              let ariaSort: "ascending" | "descending" | undefined;
              if (header.id === "lastDeploymentDate") {
                ariaSort = isDescending ? "descending" : "ascending";
              }
              return (
                <TableHead key={header.id} className={COLUMN_CLASS[header.id]} aria-sort={ariaSort}>
                  {flexRender(header.column.columnDef.header, header.getContext())}
                </TableHead>
              );
            })}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {table.getRowModel().rows.map((row) => (
          <TableRow
            key={row.id}
            data-testid={`repo-row-${row.id}`}
            role="button"
            tabIndex={0}
            isHoverable
            className="outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            onClick={() => open(row.original.itemId)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                open(row.original.itemId);
              }
            }}
          >
            {row.getVisibleCells().map((cell) => (
              <TableCell key={cell.id} className={cn("min-w-0", COLUMN_CLASS[cell.column.id])}>
                {flexRender(cell.column.columnDef.cell, cell.getContext())}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
