import { Skeleton, TableBody, TableCell, TableRow } from "@/components/core";
import type { Table } from "@tanstack/react-table";

type TableSkeletonProps<TData> = {
  table: Table<TData>;
};

export const LoadingSkelton = <TData,>({
  table,
}: TableSkeletonProps<TData>) => (
  <TableBody>
    {Array.from({ length: 5 }).map((_, index) => (
      <TableRow key={index}>
        <TableCell colSpan={table.getVisibleLeafColumns().length}>
          <Skeleton className="h-12 w-full rounded-xl" />
        </TableCell>
      </TableRow>
    ))}
  </TableBody>
);
