import { useMemo, useState, type ReactNode } from "react";
import { ArrowUp, Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/core";
import {
  getSeverityLabel,
  type ScaDependencyRow,
  type ScaSeverity,
} from "@/components/module/repos/sca-transform";
import { useT } from "@seliseblocks/genesis-os/i18n";

const PAGE_SIZE = 5;

const SEVERITY_BADGE: Record<ScaSeverity, string> = {
  Critical: "bg-red-100 text-red-700 border-red-200",
  High: "bg-orange-100 text-orange-700 border-orange-200",
  Medium: "bg-yellow-100 text-yellow-700 border-yellow-200",
  Low: "bg-green-100 text-green-700 border-green-200",
  Unassigned: "bg-gray-100 text-medium-emphasis border-transition",
};

export function ScaDependenciesTable({
  rows,
  severityFilter,
}: Readonly<{
  rows: ScaDependencyRow[];
  severityFilter: ScaSeverity | null;
}>) {
  const { t } = useT("monitor.repos");
  const headers = [
    t("SCA_DEPENDENCIES_TABLE.COLUMN_COMPONENT"),
    t("SCA_DEPENDENCIES_TABLE.COLUMN_PACKAGE"),
    t("SCA_DEPENDENCIES_TABLE.COLUMN_VERSION"),
    t("SCA_DEPENDENCIES_TABLE.COLUMN_VULNERABILITY"),
    t("SCA_DEPENDENCIES_TABLE.COLUMN_CVSS"),
    t("SCA_DEPENDENCIES_TABLE.COLUMN_EPSS"),
  ];
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<ScaDependencyRow | null>(null);

  const filtered = useMemo(() => {
    let list = rows;
    if (severityFilter) list = list.filter((row) => row.severity === severityFilter);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((row) => row.component.toLowerCase().includes(q));
    return list;
  }, [rows, severityFilter, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);
  const pageRows = filtered.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE);
  const empty = filtered.length === 0;
  const from = empty ? 0 : currentPage * PAGE_SIZE + 1;
  const to = empty ? 0 : Math.min(filtered.length, (currentPage + 1) * PAGE_SIZE);
  const pageNumbers = empty
    ? []
    : Array.from(
        { length: Math.min(3, totalPages - currentPage) },
        (_, index) => currentPage + index,
      );

  return (
    <div data-testid="sca-dependencies">
      <div className="relative my-5 max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-low-emphasis" />
        <input
          type="text"
          data-testid="sca-search"
          className="w-full rounded-md border bg-background py-2 pl-10 pr-4 text-sm focus:border-blue-500 focus:outline-hidden focus:ring-1 focus:ring-blue-500"
          placeholder={t("SCA_DEPENDENCIES_TABLE.SEARCH_PLACEHOLDER")}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
        />
      </div>

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              {headers.map((head) => (
                <TableHead key={head}>
                  <span className="flex items-center">
                    <span className="font-semibold text-medium-emphasis">{head}</span>
                    <ArrowUp className="ml-2 h-4 w-4 text-medium-emphasis opacity-50" />
                  </span>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {empty ? (
              <TableRow>
                <TableCell
                  colSpan={headers.length}
                  className="h-24 text-center text-muted-foreground"
                  data-testid="sca-empty"
                >
                  {t("SCA_DEPENDENCIES_TABLE.NO_DEPENDENCIES")}
                </TableCell>
              </TableRow>
            ) : (
              pageRows.map((row) => (
                <TableRow
                  key={row.id}
                  data-testid={`sca-row-${row.id}`}
                  isHoverable
                  className="hover:bg-secondary"
                  onClick={() => setSelected(row)}
                >
                  <TableCell>
                    <span className="text-left text-sm font-medium text-blue-600 hover:text-blue-800">
                      {row.component}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm font-medium text-medium-emphasis">{row.group}</div>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm text-high-emphasis">{row.version}</div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-gray-100 px-2 py-1 text-xs text-low-emphasis">
                        NVD
                      </span>
                      <a
                        href={`https://nvd.nist.gov/vuln/detail/${encodeURIComponent(row.vulnerability)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm font-medium text-blue-600 hover:text-blue-800"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {row.vulnerability}
                      </a>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium text-high-emphasis">
                        {row.cvss == null
                          ? t("SCA_DEPENDENCIES_TABLE.NOT_AVAILABLE")
                          : row.cvss.toFixed(1)}
                      </span>
                      <span
                        className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${SEVERITY_BADGE[row.severity]}`}
                      >
                        {getSeverityLabel(row.severity)}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm font-medium text-medium-emphasis">
                      {row.epss == null
                        ? t("SCA_DEPENDENCIES_TABLE.NOT_AVAILABLE")
                        : `${row.epss.toFixed(2)}%`}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="border-t bg-background px-6 py-4">
        <div className="flex items-center justify-between">
          <span className="text-xs text-low-emphasis" data-testid="sca-footer">
            {empty
              ? t("SCA_DEPENDENCIES_TABLE.SHOWING", { from: 1, to: 0, total: 0 })
              : t("SCA_DEPENDENCIES_TABLE.SHOWING", { from, to, total: filtered.length })}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={currentPage <= 0}
              data-testid="sca-prev"
              className="px-3 py-2 text-xs text-low-emphasis hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => setPage(Math.max(0, currentPage - 1))}
            >
              {t("common:PREVIOUS")}
            </button>

            {pageNumbers.map((pageNum) => (
              <button
                key={pageNum}
                type="button"
                className={`rounded px-3 py-2 text-xs font-medium ${
                  currentPage === pageNum
                    ? "bg-accent text-primary"
                    : "text-low-emphasis hover:text-medium-emphasis"
                }`}
                onClick={() => setPage(pageNum)}
              >
                {pageNum + 1}
              </button>
            ))}

            {totalPages > 3 && !pageNumbers.includes(totalPages - 1) && (
              <>
                <span className="px-2 text-xs text-gray-400">...</span>
                <button
                  type="button"
                  className="px-3 py-2 text-xs text-low-emphasis hover:text-primary"
                  onClick={() => setPage(totalPages - 1)}
                >
                  {totalPages}
                </button>
              </>
            )}

            <button
              type="button"
              disabled={empty || currentPage >= totalPages - 1}
              data-testid="sca-next"
              className="px-3 py-2 text-xs text-low-emphasis hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => setPage(currentPage + 1)}
            >
              {t("common:NEXT")}
            </button>
          </div>
        </div>
      </div>

      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent data-testid="sca-dialog">
          <DialogHeader className="p-2">
            <DialogTitle>{t("SCA_DEPENDENCIES_TABLE.DETAILS_TITLE")}</DialogTitle>
            <DialogDescription asChild>
              <div className="py-4">
                <DetailField label={t("common:NAME")} first>
                  {selected?.component || t("SCA_DEPENDENCIES_TABLE.NO_NAME")}
                </DetailField>
                <DetailField label={t("SCA_DEPENDENCIES_TABLE.DETAIL_GROUP")}>
                  {selected?.group || t("SCA_DEPENDENCIES_TABLE.NO_GROUP")}
                </DetailField>
                <DetailField label={t("SCA_DEPENDENCIES_TABLE.COLUMN_VERSION")}>
                  {selected?.version || t("SCA_DEPENDENCIES_TABLE.NO_VERSION")}
                </DetailField>
                <DetailField label={t("SCA_DEPENDENCIES_TABLE.DETAIL_LATEST_VERSION")}>
                  {selected?.latestVersion || t("SCA_DEPENDENCIES_TABLE.NO_DATA")}
                </DetailField>
                <DetailField label={t("SCA_DEPENDENCIES_TABLE.COLUMN_VULNERABILITY")}>
                  {selected?.vulnerability || t("SCA_DEPENDENCIES_TABLE.NO_VULNERABILITY")}
                </DetailField>
                <DetailField label={t("SCA_DEPENDENCIES_TABLE.COLUMN_CVSS")}>
                  {selected?.cvss == null
                    ? t("SCA_DEPENDENCIES_TABLE.NO_CVSS")
                    : selected.cvss.toFixed(1)}
                </DetailField>
                <DetailField label={t("SCA_DEPENDENCIES_TABLE.DETAIL_EPSS_PERCENTILE")}>
                  {selected?.epss == null
                    ? t("SCA_DEPENDENCIES_TABLE.NO_EPSS")
                    : `${selected.epss.toFixed(2)}%`}
                </DetailField>
                <DetailField label={t("SCA_DEPENDENCIES_TABLE.DETAIL_EPSS_SCORE")}>
                  {selected?.epssScore ?? t("SCA_DEPENDENCIES_TABLE.NO_EPSS_SCORE")}
                </DetailField>
                <DetailField label={t("SCA_DEPENDENCIES_TABLE.DETAIL_CWE_NAME")}>
                  {selected?.cweName || t("SCA_DEPENDENCIES_TABLE.NO_CWE_NAME")}
                </DetailField>
                <DetailField label={t("common:DESCRIPTION")}>
                  {selected?.description || t("SCA_DEPENDENCIES_TABLE.NO_DESCRIPTION")}
                </DetailField>
              </div>
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DetailField({
  label,
  first,
  children,
}: Readonly<{
  label: string;
  first?: boolean;
  children: ReactNode;
}>) {
  return (
    <>
      <div className={`${first ? "" : "mt-2 "}text-sm font-bold text-muted-foreground`}>
        {label}
      </div>
      <div className="text-sm">{children}</div>
    </>
  );
}

export { PAGE_SIZE as SCA_PAGE_SIZE };
