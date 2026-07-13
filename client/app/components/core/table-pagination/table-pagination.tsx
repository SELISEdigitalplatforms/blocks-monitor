import * as React from "react";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/core/button/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/core/select/select";

export interface TablePaginationProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Zero-based current page index. */
  pageIndex: number;
  /** Total number of pages. */
  pageCount: number;
  /** Current page size. */
  pageSize: number;
  /** Available page-size options. */
  pageSizeOptions?: number[];
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  /** Optional summary, e.g. "12 of 134 selected". */
  summary?: React.ReactNode;
}

const TablePagination = React.forwardRef<HTMLDivElement, TablePaginationProps>(
  (
    {
      pageIndex,
      pageCount,
      pageSize,
      pageSizeOptions = [10, 20, 50, 100],
      onPageChange,
      onPageSizeChange,
      summary,
      className,
      ...props
    },
    ref,
  ) => {
    const canPrev = pageIndex > 0;
    const canNext = pageIndex < pageCount - 1;

    return (
      <div
        ref={ref}
        className={cn(
          "flex flex-col-reverse items-stretch gap-3 px-2 py-2 sm:flex-row sm:items-center sm:justify-between",
          className,
        )}
        {...props}>
        <div className="text-sm text-muted-foreground">{summary}</div>

        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium">Rows per page</p>
            <Select
              value={`${pageSize}`}
              onValueChange={(value) => onPageSizeChange(Number(value))}>
              <SelectTrigger className="h-8 w-[78px]">
                <SelectValue placeholder={pageSize} />
              </SelectTrigger>
              <SelectContent side="top">
                {pageSizeOptions.map((size) => (
                  <SelectItem key={size} value={`${size}`}>
                    {size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex w-[120px] items-center justify-center text-sm font-medium">
            Page {pageIndex + 1} of {Math.max(pageCount, 1)}
          </div>

          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="hidden size-8 lg:flex"
              onClick={() => onPageChange(0)}
              disabled={!canPrev}
              aria-label="Go to first page">
              <ChevronsLeft className="size-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              onClick={() => onPageChange(pageIndex - 1)}
              disabled={!canPrev}
              aria-label="Go to previous page">
              <ChevronLeft className="size-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              onClick={() => onPageChange(pageIndex + 1)}
              disabled={!canNext}
              aria-label="Go to next page">
              <ChevronRight className="size-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="hidden size-8 lg:flex"
              onClick={() => onPageChange(pageCount - 1)}
              disabled={!canNext}
              aria-label="Go to last page">
              <ChevronsRight className="size-4" />
            </Button>
          </div>
        </div>
      </div>
    );
  },
);
TablePagination.displayName = "TablePagination";

export { TablePagination };
