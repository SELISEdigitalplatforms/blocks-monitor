import type { ReactNode } from "react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { parseAsBoolean, parseAsInteger, parseAsString } from "nuqs";


export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function RenderConditionally({
  condition,
  children,
}: {
  condition: boolean;
  children: ReactNode;
}) {
  return condition ? <>{children}</> : null;
}

// Mirrors blocks-kit's RenderAlternatively: renders `whenTrue` when
// `condition` holds, otherwise `whenFalse`.
export function RenderAlternatively({
  condition,
  whenTrue,
  whenFalse,
}: {
  condition: boolean;
  whenTrue: ReactNode;
  whenFalse: ReactNode;
}) {
  return <>{condition ? whenTrue : whenFalse}</>;
}

// `FilterControls` is a compound component. The app only reaches for two of its
// members: `.SortHeader` (a clickable column header that reports sort changes)
// and `.TablePagination`. These minimal passthroughs render the label/paging
// text and wire the click handlers so the local component logic stays testable.
function FilterControlsBase(props: { children?: ReactNode }) {
  return <div data-testid="filter-controls">{props.children ?? null}</div>;
}

function SortHeader({
  id,
  label,
  value,
  onChange,
}: {
  id?: string;
  label?: ReactNode;
  value?: SortValue;
  onChange?: (value: SortValue) => void;
  [key: string]: unknown;
}) {
  return (
    <button
      type="button"
      data-testid={`sort-header-${id ?? ""}`}
      onClick={() =>
        onChange?.({
          property: id ?? "",
          isDescending: !(value?.isDescending ?? false),
        })
      }
    >
      {label}
    </button>
  );
}

function TablePagination({
  pageIndex = 0,
  pageCount = 0,
  onPageChange,
}: {
  pageIndex?: number;
  pageCount?: number;
  onPageChange?: (page: number) => void;
  [key: string]: unknown;
}) {
  return (
    <div data-testid="table-pagination">
      <span>{`Page ${pageIndex + 1} of ${pageCount}`}</span>
      <button
        type="button"
        aria-label="Go to previous page"
        disabled={pageIndex <= 0}
        onClick={() => onPageChange?.(pageIndex - 1)}
      />
      <button
        type="button"
        aria-label="Go to next page"
        disabled={pageIndex + 1 >= pageCount}
        onClick={() => onPageChange?.(pageIndex + 1)}
      />
    </div>
  );
}

export const FilterControls = Object.assign(FilterControlsBase, {
  SortHeader,
  TablePagination,
});

export function FilterToolbar(props: { children?: ReactNode }) {
  return <div data-testid="filter-toolbar">{props.children ?? null}</div>;
}

export function InfoTooltip(props: { children?: ReactNode }) {
  return <span data-testid="info-tooltip">{props.children ?? null}</span>;
}

export function TableLoadingSkeleton() {
  return <div data-testid="table-loading-skeleton" />;
}

export type PaginationValue = { pageIndex: number; pageSize: number };
export type SortValue = { property: string; isDescending: boolean };

export const paginationQueryParsers = (defaults: PaginationValue) => ({
  pageIndex: parseAsInteger.withDefault(defaults.pageIndex),
  pageSize: parseAsInteger.withDefault(defaults.pageSize),
});

export const sortQueryParsers = (defaults: SortValue) => ({
  property: parseAsString.withDefault(defaults.property),
  isDescending: parseAsBoolean.withDefault(defaults.isDescending),
});
