import type { SortValue } from "@seliseblocks/blocks-kit/components";
import { FilterControls } from "@seliseblocks/blocks-kit/components";
import { TableLoadingSkeleton } from "@seliseblocks/blocks-kit/components";
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
            <div className="ml-2 flex w-[100px] flex-row items-center gap-2 sm:ml-0">
              <span className={statusClass}>
                {isResolved ? "Resolved" : "Unresolved"}
              </span>
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
                <div className="ml-2 flex items-center sm:ml-0 sm:w-[100px]">
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
          <div className="ml-2 flex items-center sm:ml-0 sm:w-[100px]">
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
            <div className="ml-2 flex w-[180px] items-center sm:ml-0 sm:w-[150px]">
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
          const endTime = row.original.endTime
            ? new Date(row.original.endTime)
            : null;
          const isOngoing = !endTime || endTime < startTime;
          return (
            <div className="ml-2 flex w-[180px] items-center sm:ml-0 sm:w-[150px]">
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
            <div className="ml-2 flex w-[180px] items-center sm:ml-0 sm:w-[100px]">
              <span>{formatDuration(durationSec)}</span>
            </div>
          );
        },
      },
    ];
    return cols;
  }, [showLastStatus, sortingValue, handleSortChange, enableSorting]);

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
            <TableRow
              key={headerGroup.id}
              className="px-4 py-2 hover:bg-transparent">
              {headerGroup.headers.map((header) => (
                <TableHead
                  key={header.id}
                  className="font-bold text-medium-emphasis">
                  {header.isPlaceholder
                    ? null
                    : flexRender(
                        header.column.columnDef.header,
                        header.getContext(),
                      )}
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
                  isHoverable>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={table.getAllColumns().length}
                  className="h-24 text-center text-muted-foreground">
                  No results.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        )}
      </Table>
      {totalCount > pageSize && (
        <div className="mt-5 flex items-center justify-end">
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

function formatDuration(seconds: number): string {
  const days = Math.floor(seconds / (24 * 3600));
  const hours = Math.floor((seconds % (24 * 3600)) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  const units = [
    { value: days, label: "d" },
    { value: hours, label: "h" },
    { value: minutes, label: "m" },
    { value: secs, label: "s" },
  ];

  const nonZero = units.filter((u) => u.value > 0);
  if (!nonZero.length) return "0s";

  return nonZero
    .slice(0, 2)
    .map((u) => `${u.value}${u.label}`)
    .join(" ");
}

export default IncidentList;
