import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ScrollText } from "lucide-react";
import { AUDIT_PAGE_SIZE, useAuditPage, type PlatformAccess } from "@/madp/blocks/admin";
import { auditFacets, type AuditEntry, type AuditFilters } from "@/madp/domain/platform";
import { auditActionLabel } from "./auditLabels";
import { Button, Card, Chip, EmptyState, Input, Label, Select } from "@/madp/ui/kit";
import { useT } from "@/madp/i18n";

const PAGE_SIZE = AUDIT_PAGE_SIZE;
const ALL = "";

function when(at: string): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return at;
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function Row({ e }: { e: AuditEntry }) {
  const t = useT();
  return (
    <li className="flex flex-col gap-2 rounded-block bg-surface2 px-4 py-3 md:flex-row md:items-center md:gap-4">
      <div className="min-w-0 md:w-1/4">
        <div className="text-[14px] font-medium [overflow-wrap:anywhere]">{e.actorName || e.actorEmail}</div>
        {e.actorName && <div className="text-[13px] text-ink3 [overflow-wrap:anywhere]">{e.actorEmail}</div>}
      </div>
      <div className="min-w-0 md:flex-1">
        <div className="text-[14px] [overflow-wrap:anywhere]">{auditActionLabel(e.action)}</div>
        {e.targetLabel && <div className="text-[13px] text-ink2 [overflow-wrap:anywhere]">{e.targetLabel}</div>}
      </div>
      <div className="min-w-0 text-[13px] text-ink2 [overflow-wrap:anywhere] md:w-1/6">{e.workspaceName || t("platform.admin.audit.platform", "Platform")}</div>
      <div className="flex flex-wrap items-center gap-2 md:ml-auto md:justify-end">
        <time dateTime={e.at} className="text-[13px] text-ink3">{when(e.at)}</time>
        {e.crossWorkspace && <Chip tone="warning" title={t("platform.admin.audit.crossTitle", "Done by a platform admin from outside this workspace")}>{t("platform.admin.audit.platformAdmin", "Platform admin")}</Chip>}
      </div>
    </li>
  );
}

export function AuditTab({ access, initialFilters }: { access: PlatformAccess; initialFilters?: AuditFilters }) {
  const t = useT();
  const enabled = access.isSuperAdmin || access.permissions.includes("platform.audit.view");
  const [filters, setFilters] = useState<AuditFilters>(initialFilters ?? {});
  const [actor, setActor] = useState(initialFilters?.actor ?? "");
  const [page, setPage] = useState(1);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const v = actor.trim();
      setFilters((f) => ((f.actor ?? "") === v ? f : { ...f, actor: v || undefined }));
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [actor]);

  // The server filters by person, action, workspace, cross-workspace and dates over the whole trail and pages it.
  const q = useAuditPage({
    page, pageSize: PAGE_SIZE, action: filters.action, workspaceId: filters.workspaceId,
    actor: filters.actor, crossWorkspaceOnly: filters.crossWorkspaceOnly,
    from: filters.from ? `${filters.from}T00:00:00.000Z` : undefined,
    to: filters.to ? `${filters.to}T23:59:59.999Z` : undefined,
  }, enabled);
  const entries = q.data?.entries ?? [];
  const seen = useRef<AuditEntry[]>([]);
  const facets = useMemo(() => {
    const byId = new Map(seen.current.map((e) => [e.id, e]));
    for (const e of entries) byId.set(e.id, e);
    seen.current = [...byId.values()];
    return auditFacets(seen.current);
  }, [entries]);
  const rows = entries;

  if (!enabled) return null;

  const set = (patch: Partial<AuditFilters>) => { setFilters((f) => ({ ...f, ...patch })); setPage(1); };
  const clear = () => { setActor(""); setFilters({}); setPage(1); };
  const filtered = Object.values(filters).some((v) => v !== undefined && v !== "" && v !== false);
  const total = q.data?.totalCount ?? entries.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const cur = Math.min(page, pages);
  const shown = rows;
  const hasMore = q.data?.hasMore === true;
  const canNext = q.data ? hasMore : cur < pages;
  const loading = q.isLoading;

  return (
    <Card title={t("platform.admin.audit.title", "Audit log")} icon={<ScrollText size={18} strokeWidth={1.75} />} bodyClassName="flex flex-col gap-4">
      <p className="max-w-[68ch] text-[14px] text-ink2">{t("platform.admin.audit.intro", "Who did what, where and when, across the platform and every workspace.")}</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <div className="min-w-0">
          <Label>{t("platform.admin.audit.who", "Who")}</Label>
          <Input type="search" value={actor} onChange={(e) => setActor(e.target.value)} placeholder={t("platform.admin.audit.whoPlaceholder", "Name or email")} aria-label={t("platform.admin.audit.who", "Who")} maxLength={100} />
        </div>
        <div className="min-w-0">
          <Label>{t("platform.admin.audit.action", "Action")}</Label>
          <Select label={t("platform.admin.audit.action", "Action")} value={filters.action ?? ALL} onChange={(v) => set({ action: v || undefined })}
            options={[{ value: ALL, label: t("platform.admin.audit.allActions", "All actions") }, ...facets.actions.map((a) => ({ value: a, label: auditActionLabel(a) })).sort((x, y) => x.label.localeCompare(y.label))]} />
        </div>
        <div className="min-w-0">
          <Label>{t("platform.admin.audit.where", "Where")}</Label>
          <Select label={t("platform.admin.audit.where", "Where")} value={filters.workspaceId ?? ALL} onChange={(v) => set({ workspaceId: v || undefined })}
            options={[{ value: ALL, label: t("platform.admin.audit.allWorkspaces", "All workspaces") }, ...facets.workspaces.map((w) => ({ value: w.id, label: w.name }))]} />
        </div>
        <div className="min-w-0">
          <Label>{t("platform.admin.audit.from", "From")}</Label>
          <Input type="date" value={filters.from ?? ""} max={filters.to || undefined} aria-label={t("platform.admin.audit.from", "From")} onChange={(e) => set({ from: e.target.value || undefined })} />
        </div>
        <div className="min-w-0">
          <Label>{t("platform.admin.audit.to", "To")}</Label>
          <Input type="date" value={filters.to ?? ""} min={filters.from || undefined} aria-label={t("platform.admin.audit.to", "To")} onChange={(e) => set({ to: e.target.value || undefined })} />
        </div>
        <div className="flex min-w-0 flex-wrap items-end gap-3 pb-1.5">
          <label className="flex items-center gap-2 text-[14px] text-ink2">
            <input type="checkbox" className="h-4 w-4 accent-accent" checked={!!filters.crossWorkspaceOnly}
              onChange={(e) => set({ crossWorkspaceOnly: e.target.checked || undefined })} />
            {t("platform.admin.audit.crossOnly", "Only by platform admins from outside")}
          </label>
          <Button size="sm" variant="ghost" onClick={clear}>{t("platform.admin.audit.clear", "Clear filters")}</Button>
        </div>
      </div>
      {q.error && <p role="alert" className="text-[13px] text-danger [overflow-wrap:anywhere]">{q.error.message}</p>}
      {!q.error && !loading && entries.length === 0 && !filtered && (
        <EmptyState icon={<ScrollText size={18} strokeWidth={1.75} />} title={t("platform.admin.audit.emptyTitle", "Nothing recorded yet")} text={t("platform.admin.audit.emptyText", "Changes people make appear here.")} />
      )}
      {!q.error && !loading && (entries.length > 0 || filtered) && rows.length === 0 && (
        <EmptyState icon={<ScrollText size={18} strokeWidth={1.75} />} title={t("platform.admin.audit.noMatch", "Nothing matches these filters")}
          action={filtered ? <Button size="sm" variant="secondary" onClick={clear}>{t("platform.admin.audit.clear", "Clear filters")}</Button> : undefined} />
      )}
      <ul className="flex flex-col gap-3" aria-busy={loading}>
        {shown.map((e) => <Row key={e.id} e={e} />)}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-[13px] text-ink3">{t("platform.admin.audit.page", "Page {cur} of {pages}", { cur, pages })}{hasMore ? t("platform.admin.audit.moreNext", " · More on the next page") : ""}</span>
        <div className="flex gap-3">
          <Button size="sm" variant="ghost" icon={<ChevronLeft size={16} strokeWidth={1.75} />} disabled={cur <= 1} onClick={() => setPage(cur - 1)}>{t("platform.admin.audit.previous", "Previous")}</Button>
          <Button size="sm" variant="ghost" iconRight={<ChevronRight size={16} strokeWidth={1.75} />} disabled={!canNext} onClick={() => setPage(cur + 1)}>{t("platform.admin.audit.next", "Next")}</Button>
        </div>
      </div>
    </Card>
  );
}
