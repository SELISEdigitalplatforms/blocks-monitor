import type { SortValue } from "@seliseblocks/genesis-os/components";
import { FilterControls } from "@seliseblocks/genesis-os/components";
import { TableLoadingSkeleton } from "@seliseblocks/genesis-os/components";
import {
  Badge,
  ScrollArea,
  ScrollBar,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/core";
import AlertAction from "@/components/module/alert/alert-action";
import ProgressBar from "@/components/module/alert/progress-bar";
import { AlertTree } from "@/models/alerts.model";
import { formatDate } from "@seliseblocks/genesis-os/utils";
import { useProjectStore } from "@seliseblocks/genesis-os/store";
import { useScopedPath } from "@seliseblocks/genesis-os/hooks";
import { ColumnDef, flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { ArrowDown, ArrowUp } from "lucide-react";
import { useMemo } from "react";
import { useNavigate } from "react-router";
import { useAlertFilterQueryParams } from "./use-alert-filter-query-params";

type AlertsListProps = {
  data: AlertTree[];
  isLoading: boolean;
  sortQueryParams: SortValue;
  onSortChange: (params: SortValue) => void;
};

const UPTIME_DATE_FORMAT: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  year: "numeric",
};

const EMPTY_VALUE = "-";

/**
 * The model types the incident date as `Date`, but the API also sends an ISO
 * string, null, and the C# `DateTime.MinValue` sentinel. Normalise all of them
 * here and return null for anything unusable, so no caller can hand an invalid
 * Date to `Intl.DateTimeFormat` (which throws rather than degrading).
 */
const toValidDate = (value: Date | string | null | undefined): Date | null => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/**
 * `DateTime.MinValue` is year 0001 UTC, but a positive UTC offset pushes it back
 * into year 0, so treat anything at or below year 1 as "no incident recorded".
 *
 * This is deliberately a year check rather than an exact match on the minimum
 * date: the ticket specifies one (C1), and it stays correct however the backend
 * serialises the sentinel. The tradeoff is that a genuine year-1 timestamp would
 * also be read as "never" -- not a real case for uptime monitoring.
 */
const isNeverSentinel = (date: Date) => date.getUTCFullYear() <= 1;

export function AlertsList({ data, isLoading, sortQueryParams, onSortChange }: AlertsListProps) {
  const navigate = useNavigate();
  const scoped = useScopedPath();
  const projectKey = useProjectStore()?.selectedProject?.tenantId || "";
  const { queryParams } = useAlertFilterQueryParams();

  const columns = useMemo<ColumnDef<AlertTree>[]>(
    () => [
      {
        accessorKey: "name",
        header: () => (
          <FilterControls.SortHeader
            key={"name"}
            id="name"
            label="Name"
            value={sortQueryParams}
            defaultValue={{ property: "name", isDescending: false }}
            onChange={onSortChange}
            className="sm:w-[150px] w-[180px]"
          />
        ),
        cell: ({ row }) => {
          const name = row.original?.name || row.original.operationName || "N/A";
          return (
            <div className="ml-2 flex flex-row items-center sm:ml-0 w-[180px] sm:w-[150px]">
              <span className="break-all">{name}</span>
            </div>
          );
        },
      },
      {
        accessorKey: "monitorType",
        header: () => (
          <FilterControls.SortHeader
            key={"monitor_type"}
            id="monitor_type"
            label="Monitor Type"
            value={sortQueryParams}
            onChange={onSortChange}
            className="sm:w-[150px] w-[180px]"
          />
        ),
        cell: ({ row }) => {
          const monitorType =
            row.original.monitorConfigurationType === 0 ? "HTTP Check" : "Heartbeat";
          return (
            <div className="ml-2 flex w-[180px] items-center sm:ml-0 sm:w-[150px]">
              <span className="break-all">{monitorType}</span>
            </div>
          );
        },
      },
      {
        accessorKey: "url",
        header: () => (
          <FilterControls.SortHeader
            key={"url"}
            id="url"
            label="URL"
            value={sortQueryParams}
            onChange={onSortChange}
            className="sm:w-[150px] w-[180px]"
          />
        ),
        cell: ({ row }) => {
          const url = row.original.url || row.original.request?.url || "N/A";
          return (
            <div className="ml-2 flex w-[180px] items-center sm:ml-0 sm:w-[150px]">
              <span className="break-all">{url}</span>
            </div>
          );
        },
      },

      {
        accessorKey: "taggedService",
        header: () => (
          <FilterControls.SortHeader
            key={"tagged_service"}
            id="tagged_service"
            label="Tagged Service"
            value={sortQueryParams}
            onChange={onSortChange}
            className="sm:w-[150px] w-[180px]"
          />
        ),
        cell: ({ row }) => {
          const value = row.original.repoName || row.original.externalServiceName || "-";

          return (
            <div className="flex w-[180px] items-center sm:ml-0 sm:w-[150px]">
              <span className="break-all">{value}</span>
            </div>
          );
        },
      },

      {
        accessorKey: "uptime",
        header: () => (
          <FilterControls.SortHeader
            key={"uptime"}
            id="uptime"
            label="Uptime"
            value={sortQueryParams}
            onChange={onSortChange}
            className="sm:w-[150px] w-[180px]"
          />
        ),
        cell: ({ row }) => {
          const { lastIncidentAt, currentStatus, createdDate } = row.original;

          // Show the date of the last incident, or when the service was created
          // if nothing has happened yet. This used to format `Date.now() - time`,
          // an elapsed duration, which Intl read as a millisecond epoch and
          // rendered as a date in 1970.
          const incidentDate = toValidDate(lastIncidentAt as Date | string | null);
          const uptimeDate =
            incidentDate && !isNeverSentinel(incidentDate)
              ? incidentDate
              : toValidDate(createdDate);
          const formattedDate = uptimeDate
            ? formatDate(uptimeDate, UPTIME_DATE_FORMAT)
            : EMPTY_VALUE;

          return (
            <div className="ml-2 flex w-[180px] items-center sm:ml-0 sm:w-[150px]">
              <span>{formattedDate}</span>
              {currentStatus ? (
                <ArrowUp className="ml-1 h-4 w-4 text-green-500" />
              ) : (
                <ArrowDown className="ml-1 h-4 w-4 text-red-500" />
              )}
            </div>
          );
        },
      },

      {
        accessorKey: "status",
        header: () => (
          <FilterControls.SortHeader
            key={"status"}
            id="status"
            label="Status"
            value={sortQueryParams}
            onChange={onSortChange}
          />
        ),
        cell: ({ row }) => {
          const incidentList = row.original.incidentSummaries;
          const status = row.original.currentStatus;
          // Strictly `=== false`, not `!isActive`: a row whose payload omits the field must read
          // as active. The AlertAction call below uses `?? false` for the opposite reason -- see
          // its own comment -- so the two defaults differ on purpose.
          const isPaused = row.original.isActive === false;
          return (
            <div className="flex justify-start mt-3">
              {isPaused ? (
                // Replaces the bar rather than sitting beside it: 24 hours of green/red is a
                // health display, and health is not meaningful while a monitor is paused.
                <Badge variant="secondary" className="w-fit">
                  Paused
                </Badge>
              ) : (
                <ProgressBar incidents={incidentList} status={status} />
              )}
            </div>
          );
        },
      },
      {
        accessorKey: "AlertActions",
        header: () => <div className="text-center"></div>,
        cell: ({ row }) => {
          const request = row.original.monitorConfigurationType === 0 ? true : false;
          const name = row.original?.name;
          const monitorSourceType = row.original.monitorSourceType;
          return (
            <>
              {monitorSourceType !== 2 ? (
                <div
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                  className="flex justify-center"
                >
                  <AlertAction
                    monitorId={row.original.itemId as string}
                    isActive={row.original.isActive ?? false}
                    goBack={false}
                    request={request}
                    name={name as string}
                    projectKey={projectKey}
                    monitorSourceType={monitorSourceType}
                  />
                </div>
              ) : null}
            </>
          );
        },
      },
    ],
    [onSortChange, sortQueryParams, projectKey],
  );
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    state: {
      columnVisibility: {
        taggedService: queryParams.tab === "all",
      },
    },
  });
  const handleRowClick = (itemId: string) => {
    if (itemId) {
      navigate(scoped(`monitor/${itemId}`));
    }
  };

  return (
    <ScrollArea className="w-full">
      <Table className="text-sm">
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id} className="px-4 py-2 hover:bg-transparent">
              {headerGroup.headers.map((header) => (
                <TableHead key={header.id} className="font-bold text-medium-emphasis">
                  {header.isPlaceholder
                    ? null
                    : flexRender(header.column.columnDef.header, header.getContext())}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        {isLoading ? (
          <TableLoadingSkeleton table={table} />
        ) : (
          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && "selected"}
                  className="text-medium-emphasis"
                  onClick={() => handleRowClick(row.original.itemId)}
                  isHoverable
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={table.getAllColumns().length}
                  className="h-24 text-center text-muted-foreground"
                >
                  No results.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        )}
      </Table>

      <ScrollBar orientation="horizontal" />
    </ScrollArea>
  );
}
