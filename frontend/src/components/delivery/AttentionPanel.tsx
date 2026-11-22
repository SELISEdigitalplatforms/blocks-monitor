/** "Changes that need attention": the right side panel the Release page's "Needs attention · N" chip opens
 *  (attention.ts). One row per change: its code and title, its state in plain words, the version, and the one next
 *  action; underline tabs group the rows by state, with counts. The actions are the change page's own ops (Fix what
 *  the checks found: cr.fixChecks; Run the checks again: build.retryAfterDeploy; Start the build again:
 *  cr.startBuild); "Known before this change" and "Put development back" open the change's page, where they take their
 *  reason and confirmation. A row says what its action did, and an error in plain words keeps the button. */
import { useState } from "react";
import { Link } from "react-router-dom";
import { CircleAlert, CircleCheck, CircleDashed, Clock, RotateCcw, Wrench } from "lucide-react";
import type { DeliveryContext } from "@/blocks/delivery/context";
import type { EngineJob } from "@/blocks/engine/types";
import { useFixChecks, useRetryAfterDeploy } from "@/blocks/delivery/actions";
import { blocksChangeMessage, useStartChangeBuild } from "@/components/changes/blocksChanges";
import { Button, Drawer, EmptyState, Tabs } from "@/ui/kit";
import { cn } from "@/lib/cn";
import { t, useT } from "@/i18n";
import { actionLabel, attentionRows, attentionTabs, type AttentionGroup, type AttentionItem } from "./attention";

/** The panel's title, in the current language. */
export const attentionTitle = (): string => t("build.release.attention.title", "Changes that need attention");

type Tab = "all" | AttentionGroup;

const MARK: Record<AttentionGroup, { icon: typeof CircleAlert; tone: string }> = {
  checks: { icon: CircleAlert, tone: "text-[rgb(var(--c-warning-text))]" },
  unfinished: { icon: CircleDashed, tone: "text-[rgb(var(--c-warning-text))]" },
  lost: { icon: Clock, tone: "text-[rgb(var(--c-danger-text))]" },
  passed: { icon: CircleCheck, tone: "text-[rgb(var(--c-success-text))]" },
};

export function AttentionPanel({ open, onClose, ...rest }: {
  open: boolean;
  onClose: () => void;
  ctx: DeliveryContext;
  items: readonly AttentionItem[];
  /** The page's jobs: a start that answers another change's build is never taken as this one's. */
  jobs: readonly EngineJob[];
  tab?: Tab;
}) {
  const t = useT();
  return (
    <Drawer open={open} onClose={onClose} title={t("build.release.attention.title", "Changes that need attention")} width={520}>
      <AttentionList onClose={onClose} {...rest} />
    </Drawer>
  );
}

/** The panel's content: the tabs and the rows with their actions. */
export function AttentionList({ onClose, ctx, items, jobs, tab: initialTab = "all" }: {
  onClose: () => void;
  ctx: DeliveryContext;
  items: readonly AttentionItem[];
  jobs: readonly EngineJob[];
  tab?: Tab;
}) {
  const t = useT();
  const [tab, setTab] = useState<Tab>(initialTab);
  const fix = useFixChecks(ctx);
  const retry = useRetryAfterDeploy(ctx);
  const start = useStartChangeBuild(ctx.workspaceId, ctx.projectId);
  // the row an action was taken on, and what came of it (one at a time, like every page)
  const [acted, setActed] = useState<{ id: string; pending: boolean; ok: string | null; error: string | null } | null>(null);
  const tabs = attentionTabs(items);
  const shown = tabs.some((x) => x.value === tab) ? tab : "all";
  const rows = attentionRows(items, shown);

  const act = async (item: AttentionItem) => {
    if (acted?.pending) return;
    fix.reset(); retry.reset();
    setActed({ id: item.changeId, pending: true, ok: null, error: null });
    const a = item.action;
    if (a.kind === "start") {
      try {
        await start.start(item.changeId, jobs);
        setActed({ id: item.changeId, pending: false, ok: t("build.release.attention.requestedBuild", "The build was requested. The development team picks it up in a moment."), error: null });
      } catch (e) {
        setActed({ id: item.changeId, pending: false, ok: null, error: blocksChangeMessage(e) });
      }
      return;
    }
    const ok = a.kind === "fix" ? await fix.run({ changeRequestId: item.changeId, action: "fix" })
      : a.kind === "recheck" || a.kind === "finish" ? await retry.run({ jobId: a.jobId })
        : false;
    setActed({ id: item.changeId, pending: false, ok: ok ? t("build.release.attention.requested", "Requested. The development team takes it on in a moment.") : null,
      error: ok ? null : t("build.release.attention.requestFailed", "It could not be requested. Try again in a moment.") });
  };
  // the hooks' own words win (what was started, or why not)
  const okOf = (id: string) => (acted?.id === id ? (fix.success ?? retry.success ?? acted.ok) : null);
  const errorOf = (id: string) => (acted?.id === id ? (fix.error ?? retry.error ?? acted.error) : null);

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="scroll-thin -mx-1 overflow-x-auto px-1">
        <Tabs label={t("build.release.attention.tabsLabel", "Group the changes by state")} idPrefix="attention" value={shown} onChange={setTab}
          tabs={tabs.map((x) => ({ value: x.value, label: <span>{x.label} <span className="num text-ink3">{x.count}</span></span> }))} />
      </div>
      {rows.length === 0 ? (
        <EmptyState title={t("build.release.attention.emptyTitle", "Nothing needs attention right now")}
          text={t("build.release.attention.emptyText", "Every change on development is usable and its steps after the deploy are finished.")} />
      ) : (
        <ul id={`attention-panel-${shown}`} role="tabpanel" aria-labelledby={`attention-tab-${shown}`} className="flex flex-col">
          {rows.map((item) => {
            const mark = MARK[item.group];
            const Icon = mark.icon;
            const a = item.action;
            const runs = a.kind === "fix" || a.kind === "recheck" || a.kind === "finish" || a.kind === "start";
            const pending = acted?.id === item.changeId && acted.pending;
            const ok = okOf(item.changeId);
            const error = errorOf(item.changeId);
            return (
              <li key={item.changeId} className="flex min-w-0 flex-col gap-1.5 border-b border-line py-4 first:pt-1 last:border-0">
                <div className="flex min-w-0 items-baseline gap-3">
                  <span className="num shrink-0 font-mono text-[13px] font-medium text-ink">{item.code}</span>
                  <Link to={item.href} onClick={onClose} className="min-w-0 flex-1 break-words text-[14px] text-ink underline-offset-2 hover:underline">
                    {item.title || item.code}
                  </Link>
                  {item.version && <span className="num shrink-0 font-mono text-[12px] text-ink3">v{item.version}</span>}
                </div>
                <p className="flex min-w-0 items-start gap-1.5 text-[13px] leading-relaxed text-ink2">
                  <Icon size={15} strokeWidth={1.75} aria-hidden className={cn("mt-0.5 shrink-0", mark.tone)} />
                  <span className="min-w-0 break-words">{item.state}</span>
                </p>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pl-[21px]">
                  {runs ? (
                    <Button size="sm" variant="secondary" disabled={pending || !!ok}
                      icon={a.kind === "fix" ? <Wrench size={14} strokeWidth={1.75} aria-hidden /> : <RotateCcw size={14} strokeWidth={1.75} aria-hidden />}
                      onClick={() => void act(item)}>
                      {pending ? t("build.release.attention.requesting", "Requesting…") : actionLabel(a.kind)}
                    </Button>
                  ) : a.kind !== "open" ? (
                    <Link to={item.href} onClick={onClose} className="text-[13px] font-medium text-accent underline-offset-2 hover:underline">{actionLabel(a.kind)}</Link>
                  ) : null}
                  <Link to={item.href} onClick={onClose} className={cn("text-[13px] underline-offset-2 hover:underline", a.kind === "open" ? "font-medium text-accent" : "text-ink3")}>
                    {t("build.release.attention.action.open", "Open the change")}
                  </Link>
                </div>
                {ok && !error && <p role="status" className="pl-[21px] text-[13px] text-[rgb(var(--c-success-text))]">{ok}</p>}
                {error && <p role="alert" className="pl-[21px] text-[13px] text-danger">{error}</p>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
