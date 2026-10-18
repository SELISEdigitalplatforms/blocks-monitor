import type { SortValue } from "@seliseblocks/app-kit/components";
import { FilterControls } from "@seliseblocks/app-kit/components";
import { TableLoadingSkeleton } from "@seliseblocks/app-kit/components";
import {
  ScrollArea,
  ScrollBar,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/core";
import { IncidentTree } from "@/models/alerts.model";
import {
  CellContext,
  ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useCallback, useMemo } from "react";
import { useIncidentFilterQueryParams } from "./use-incident-query-filter-params";
import { formatDuration } from "@seliseblocks/app-kit/utils";

const parseFailureReason = (reason?: string | null): string | undefined => {
  if (!reason) return undefined; // instead of null
  try {
    const parsed = JSON.parse(reason);
    return parsed?.error || reason;
  } catch {
    return reason.replace(/\\n/g, "").trim() || undefined;
  }
};

type IncidentListProps = {
  isLoading: boolean;
  data: IncidentTree[];
  totalCount?: number;
  showLastStatus?: boolean;
  pageNumber?: number;
  pageSize?: number;
  onPageChange?: (page: number) => void;
  sortQueryParams?: SortValue;
  onSortChange?: (params: SortValue) => void;
};

const IncidentList = ({
  isLoading,
  data,
  showLastStatus,
  totalCount = 0,
  pageNumber = 0,
  pageSize = 10,
  onPageChange,
  sortQueryParams,
  onSortChange,
}: IncidentListProps) => {
  const { queryParams, setQueryParams } = useIncidentFilterQueryParams({
    property: sortQueryParams?.property || "started_time",
    isDescending: sortQueryParams?.isDescending || true,
  });
  const enableSorting = Boolean(sortQueryParams && onSortChange);
  const sortingValue = useMemo(
    () => ({
      property: queryParams?.sortProperty,
      isDescending: queryParams?.isDescending || false,
    }),
    [queryParams],
  );

  const handlePageChange = (page: number) => {
    if (onPageChange) {
      onPageChange(page);
    } else {
      setQueryParams((params) => ({ ...params, page }));
    }
  };

  const handlePageSizeChange = (pageSize: number) => {
    setQueryParams((params) => ({ ...params, page: 0, pageSize }));
  };

  const handleSortChange = useCallback(
    (params: SortValue) => {
      if (onSortChange) {
        onSortChange(params);
      } else {
        setQueryParams((prev) => ({
          ...prev,
          property: params.property,
          isDescending: params.isDescending,
        }));
      }
    },
    [onSortChange, setQueryParams],
  );

  const columns = useMemo<ColumnDef<IncidentTree>[]>(() => {
    const cols: ColumnDef<IncidentTree>[] = [
      {
        accessorKey: "status",
        header: () => (
          <FilterControls.SortHeader
            key={"status"}
            id="status"
            label="Status"
            value={sortingValue}
            onChange={handleSortChange}
            isSortingEnabled={enableSorting}
          />
        ),
        cell: ({ row }) => {
          const isResolved = row.original.isResolved;
          const statusClass = isResolved
            ? "text-green-600 bg-green-100 px-2 py-1 rounded-full"
            : "text-red-600 bg-red-100 px-2 py-1 rounded-full";
          return (
            <div className="flex w-[100px] flex-row items-center gap-2">
              <span className={statusClass}>{isResolved ? "Resolved" : "Unresolved"}</span>
            </div>
          );
        },
      },
      ...(showLastStatus
        ? [
            {
              accessorKey: "lastStatusCode",
              header: () => (
                <FilterControls.SortHeader
                  key={"lastStatusCode"}
                  id="lastStatusCode"
                  label="Status Code"
                  value={sortingValue}
                  onChange={handleSortChange}
                />
              ),
              cell: (cell: CellContext<IncidentTree, string | undefined>) => (
                <div className="flex items-center sm:w-[100px]">
                  <span>{cell.row.original.lastStatusCode}</span>
                </div>
              ),
            },
          ]
        : []),
      {
        accessorKey: "rootCause",
        header: () => (
          <FilterControls.SortHeader
            key={"rootCause"}
            id="rootCause"
            label="Root cause"
            value={sortingValue}
            onChange={handleSortChange}
            isSortingEnabled={enableSorting}
          />
        ),
        cell: ({ row }) => (
          <div className="flex items-center sm:w-[100px]">
            <span>{parseFailureReason(row.original.failureReason)}</span>
          </div>
        ),
      },
      {
        accessorKey: "started_time",
        header: () => (
          <FilterControls.SortHeader
            key={"started_time"}
            id="started_time"
            label="Start time"
            value={sortingValue}
            defaultValue={{ property: "started_time", isDescending: true }}
            onChange={handleSortChange}
            isSortingEnabled={enableSorting}
          />
        ),
        cell: ({ row }) => {
          const started = new Date(row.original.startTime).toLocaleString();
          return (
            <div className="flex w-[180px] items-center sm:w-[150px]">
              <span>{started}</span>
            </div>
          );
        },
      },
      {
        accessorKey: "end_time",
        header: () => (
          <FilterControls.SortHeader
            key={"end_time"}
            id="end_time"
            label="End time"
            value={sortingValue}
            onChange={handleSortChange}
            isSortingEnabled={enableSorting}
          />
        ),
        cell: ({ row }) => {
          const startTime = new Date(row.original.startTime);
          const endTime = row.original.endTime ? new Date(row.original.endTime) : null;
          const isOngoing = !endTime || endTime < startTime;
          return (
            <div className="flex w-[180px] items-center sm:w-[150px]">
              <span>{isOngoing ? "Ongoing" : endTime?.toLocaleString()}</span>
            </div>
          );
        },
      },
      {
        accessorKey: "duration",
        header: () => (
          <FilterControls.SortHeader
            key={"duration"}
            id="duration"
            label="Duration"
            value={sortingValue}
            onChange={handleSortChange}
            isSortingEnabled={enableSorting}
          />
        ),
        cell: ({ row }) => {
          let durationSec = row.original.downtimeDurationSeconds || 0;
          if (durationSec === 0) {
            const now = Date.now();
            const start = new Date(row.original.startTime).getTime();
            durationSec = Math.floor((now - start) / 1000);
          }
          return (
            <div className="flex w-[180px] items-center sm:w-[100px]">
              <span>{formatDuration(durationSec * 1000)}</span>
            </div>
          );
        },
      },
    ];
    return cols;
  }, [showLastStatus, sortingValue, handleSortChange, enableSorting]);

  // TanStack Table returns fresh functions each render, so the React Compiler skips this
  // component; the compiler is not enabled here, and no compiler-safe table API exists.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable<IncidentTree>({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <ScrollArea className="w-full">
      <Table className="text-sm">
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id} className="hover:bg-transparent">
              {headerGroup.headers.map((header) => (
                <TableHead
                  key={header.id}
                  className="text-xs font-semibold uppercase tracking-wide text-high-emphasis"
                >
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
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && "selected"}
                  className="text-medium-emphasis"
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
      {totalCount > pageSize && (
        <div className="flex items-center justify-end border-t border-border/60 px-5 py-3">
          <FilterControls.TablePagination
            pageIndex={pageNumber}
            pageSize={pageSize}
            pageSizeOptions={[5, 10, 15]}
            onPageSizeChange={handlePageSizeChange}
            onPageChange={handlePageChange}
            pageCount={Math.ceil(totalCount / pageSize)}
          />
        </div>
      )}

      <ScrollBar orientation="horizontal" />
    </ScrollArea>
  );
};

export default IncidentList;
