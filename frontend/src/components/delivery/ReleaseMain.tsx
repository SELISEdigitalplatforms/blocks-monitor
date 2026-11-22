/** The Release step's main area, readable like a document: where the app runs (development, staging, production, each with
 *  its version, since when, its address, its branch and what waits for it; an environment that is live without a
 *  release by the Factory, documented from the live product, says so and is never "Not released yet") and the release
 *  notes of every version, newest first, with where each one runs. Read from the release, approval and change request
 *  rows and the documented environments; nothing is invented. */
import { ArrowUpRight, Check, CircleDashed, Clock } from "lucide-react";
import type { DeliveryRelease } from "@/blocks/delivery/types";
import { type EnvironmentState } from "@/domain/delivery";
import { compareVersions } from "@/domain/numbering";
import type { Environment } from "@/domain/promotion";
import { formatDateTime } from "@/lib/dates";
import { cn } from "@/lib/cn";
import { Card, Chip } from "@/ui/kit";
import { commitLabel, firstNoteText, whereLine, whereValue, type WhereRow } from "./liveRelease";
import { envName, envWord, releaseLinkState } from "./releaseUi";
import { type NoteSection, type ReleaseStepState } from "./releaseStep";
import { t, useT } from "@/i18n";

const ENVS: readonly Environment[] = ["dev", "stage", "production"];

function envHint(env: Environment): string {
  return env === "dev" ? t("build.release.main.hintDev", "Where the team and you try every new version first.")
    : env === "stage" ? t("build.release.main.hintStage", "The final check, set up like production.")
      : t("build.release.main.hintProduction", "What your users work with.");
}

function planLine(plan: ReleaseStepState["plans"]["stage"]): string | null {
  if (!plan) return null;
  const version = plan.version;
  switch (plan.phase) {
    case "approve": return t("build.release.main.planApprove", "v{version} waits for your approval", { version });
    case "promote": return t("build.release.main.planPromote", "v{version} is approved and ready to release", { version });
    case "changes":
      return !plan.changes ? t("build.release.main.planChangesAsked", "Changes asked for v{version}", { version })
        : plan.changes.comment
          ? t("build.release.main.planChangesComment", "{by} asked for changes to v{version}: “{comment}”", { by: plan.changes.by, version, comment: plan.changes.comment })
          : t("build.release.main.planChanges", "{by} asked for changes to v{version}", { by: plan.changes.by, version });
    case "request": return t("build.release.main.planRequest", "v{version} from development is ready to send for approval", { version });
    case "setup": return t("build.release.main.planSetup", "v{version} can follow once the approvals are set up", { version });
    case "waiting": return plan.waitingFor.length
      ? t("build.release.main.planWaitingFor", "v{version} waits for {who}", { version, who: plan.waitingFor.join(", ") })
      : t("build.release.main.planWaiting", "v{version} waits for its approvals", { version });
    default: return null;
  }
}

/** The furthest environment a version has reached. */
export function reachedEnv(states: Record<Environment, EnvironmentState<DeliveryRelease>>, version: string): Environment | null {
  for (const e of ["production", "stage", "dev"] as const) {
    const cur = states[e].current;
    if (cur && compareVersions(version, cur.version) <= 0 && states[e].history.length > 0) return e;
  }
  return null;
}

export function ReleaseMain({ states, where, step, notes, attached = false }: {
  states: Record<Environment, EnvironmentState<DeliveryRelease>>;
  /** Every environment with what the records know (whereItRuns). */
  where: Record<Environment, WhereRow>;
  step: ReleaseStepState;
  notes: NoteSection[];
  /** An existing product attached as it is live: its first release is the product as it was, not what milestones delivered. */
  attached?: boolean;
}) {
  const t = useT();
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
      <Card title={t("build.release.main.notesTitle", "Release notes")} className="min-w-0 lg:order-1">
        {notes.length === 0 ? (
          <p className="text-[14px] text-ink2">{t("build.release.main.notesEmpty", "The notes start with the first release to the development environment.")}</p>
        ) : (
          <ol className="flex flex-col">
            {notes.map((n) => {
              const env = reachedEnv(states, n.version);
              const next = step.version === n.version;
              return (
                <li key={n.version} className={cn("min-w-0 border-b border-line py-4 first:pt-0 last:border-b-0 last:pb-0")}>
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                    <h3 className="num text-[16px] font-medium">v{n.version}</h3>
                    {n.releasedAt && <span className="num text-[12px] text-ink3">{formatDateTime(n.releasedAt)}</span>}
                    {env && <Chip tone={env === "production" ? "success" : "neutral"}>{env === "production" ? t("build.release.main.inProduction", "In production") : t("build.release.main.onEnv", "On {env}", { env: envWord(env) })}</Chip>}
                    {next && step.target && <Chip tone="accent">{t("build.release.main.nextFor", "Next for {env}", { env: envWord(step.target) })}</Chip>}
                    <span className="num font-mono text-[12px] text-ink3">{commitLabel(n.commit)}</span>
                  </div>
                  {n.documented && <p className="mt-1.5 text-[13px] text-ink2">{t("build.release.main.documented", "Documented from the live product: it ran before the Factory released it.")}</p>}
                  {n.first && <p className="mt-1.5 text-[13px] text-ink2">{firstNoteText(attached, n.items.length)}</p>}
                  {n.items.length === 0 ? ((n.first && attached) || n.documented ? null : (
                    <p className="mt-1.5 text-[13px] text-ink2">{t("build.release.main.maintenance", "Maintenance release.")}</p>
                  )) : (
                    <ul className="mt-2 flex flex-col gap-1.5">
                      {n.items.map((it, i) => (
                        <li key={i} className="flex min-w-0 items-baseline gap-2 text-[14px]">
                          <span className="w-[5.5rem] shrink-0 text-[12px] font-medium uppercase tracking-wide text-ink3">{it.word}</span>
                          <span className="min-w-0 break-words text-ink">{it.text}{it.code && <span className="num ml-1.5 whitespace-nowrap font-mono text-[12px] text-ink3">{it.code}</span>}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </Card>

      <Card title={t("build.release.main.whereTitle", "Where it runs")} className="min-w-0 lg:order-2">
        <ul id="release-where" tabIndex={-1} className="flex flex-col outline-none">
          {ENVS.map((e) => {
            const cur = states[e].current;
            const row = where[e];
            // a release's own link rules (a release without an address waits for the engine); a documented address opens
            const link = cur ? releaseLinkState(e, cur) : row.url ? { kind: "link" as const, href: row.url, host: row.host ?? row.url } : null;
            const line = e === "dev" ? null : planLine(step.plans[e]);
            const mine = e !== "dev" && (step.plans[e]?.phase === "approve" || step.plans[e]?.phase === "changes");
            const on = Boolean(cur) || row.state === "live";
            const sub = whereLine(row, formatDateTime);
            return (
              <li key={e} className="min-w-0 border-b border-line py-3 first:pt-0 last:border-b-0 last:pb-0">
                <div className="flex min-w-0 items-start gap-3">
                  <span aria-hidden className={cn("mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full",
                    on ? "bg-success text-white dark:text-canvas" : "bg-surface2 text-ink3")}>
                    {on ? <Check size={13} strokeWidth={3} /> : <CircleDashed size={14} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                      <span className="text-[14px] font-medium text-ink">{envName(e)}</span>
                      <span className="num text-[13px] text-ink2">{whereValue(row)}</span>
                    </div>
                    <p className="mt-0.5 text-[12px] text-ink3">{sub ?? envHint(e)}</p>
                    {link?.kind === "link" && (
                      <a href={link.href} target="_blank" rel="noopener noreferrer" aria-label={t("build.release.main.openAppOn", "Open the app on {env}", { env: envWord(e) })}
                        className="mt-1 inline-flex max-w-full items-center gap-1 text-[13px] font-medium text-[rgb(var(--c-accent-text))] underline-offset-2 hover:underline">
                        <span className="min-w-0 truncate">{t("build.release.main.openApp", "Open the app")}</span><ArrowUpRight size={13} aria-hidden className="shrink-0" />
                        <span className="min-w-0 truncate font-mono text-[12px] font-normal text-ink3">{link.host}</span>
                      </a>
                    )}
                    {link?.kind === "waiting" && <p className="mt-1 text-[12px] text-ink2">{link.text}</p>}
                    {row.branch && <p className="mt-1 text-[12px] text-ink2">{t("build.release.main.branch", "Branch")} <span className="font-mono">{row.branch}</span></p>}
                    {line && (
                      <p className={cn("mt-2 flex items-start gap-1.5 rounded-block px-3 py-2 text-[13px]",
                        mine ? "bg-warning-soft text-ink" : "bg-surface2 text-ink2")}>
                        <Clock size={14} aria-hidden className="mt-0.5 shrink-0" /><span className="min-w-0 break-words">{line}</span>
                      </p>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}
