/** The release history of the selected environment (status, version, address, branch, time, each release with its
 *  source commit, "commit unknown" when the record names none, and its change requests), and the one next step after
 *  it: the version waiting for promotion, or the change request being built. An environment that is live without a
 *  release by the Factory (an existing product's, documented from the live product) says so instead of "Not released".
 *  Everything comes from the project's release and change request rows. Follows the theme. */
import { Link } from "react-router-dom";
import { ArrowUpRight, History } from "lucide-react";
import type { DeliveryChangeRequest, DeliveryRelease } from "@/madp/blocks/delivery/types";
import { changeCode, type EnvironmentState } from "@/madp/domain/delivery";
import type { Environment, GatedEnvironment } from "@/madp/domain/promotion";
import { formatDateTime } from "@/madp/lib/dates";
import { Button, Card, Chip } from "@/madp/ui/kit";
import { commitLabel, whereLine, type WhereRow } from "./liveRelease";
import { envName, envWord, releaseLinkState } from "./releaseUi";
import { useT } from "@/madp/i18n";

const NEXT: Record<Environment, GatedEnvironment | null> = { dev: "stage", stage: "production", production: null };

function Address({ env, release }: { env: Environment; release: DeliveryRelease }) {
  const t = useT();
  const s = releaseLinkState(env, release);
  return s.kind === "link"
    ? <a href={s.href} target="_blank" rel="noopener noreferrer" className="block truncate font-mono text-accent hover:underline"
      title={t("build.release.history.openAt", "Open the app at {host}", { host: s.host })}>{s.host}</a>
    : <span className="text-ink2">{s.text}</span>;
}

export function EnvironmentsCard({ projectId, env, state, where, changes, stopped, buildingId, candidate, onPromote }: {
  projectId: string;
  env: Environment;
  state: EnvironmentState<DeliveryRelease>;
  /** What the records know about this environment besides the releases (its address and branch). */
  where?: WhereRow | null;
  changes: readonly DeliveryChangeRequest[];
  /** True when a change request's build stopped (the one rule: src/components/changes/changeStopped.ts): its line then
   *  says so instead of "Building". */
  stopped?: (c: DeliveryChangeRequest) => boolean;
  /** The change request whose own build is queued or running now (from the jobs, never from a status alone); without
   *  it, the first one at "building". */
  buildingId?: string | null;
  /** The version waiting to be promoted from this environment to the next one, if any. */
  candidate: string | null;
  /** Shows the promotion of the next environment (the Promotion card does the request and the promote). */
  onPromote: (target: GatedEnvironment) => void;
}) {
  const t = useT();
  const cur = state.current;
  const byId = new Map(changes.map((c) => [c.id, c]));
  const building = buildingId !== undefined ? (buildingId ? changes.find((c) => c.id === buildingId) ?? null : null) : changes.find((c) => c.status === "building") ?? null;
  const next = NEXT[env];
  const liveOnly = !cur && where?.state === "live";

  return (
    <Card title={t("build.release.history.title", "Release history · {env}", { env: envName(env) })} icon={<History size={18} strokeWidth={1.75} aria-hidden />} bodyClassName="px-4 pb-6 pt-4 sm:px-6">
      <div className="min-w-0 rounded-block bg-surface2 p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h3 className="text-[15px] font-medium">{envName(env)}</h3>
          <Chip tone={cur || liveOnly ? "success" : "neutral"}>
            {cur ? (where?.documented ? t("build.release.where.live", "Live") : t("build.release.step.released", "Released"))
              : liveOnly ? t("build.release.where.live", "Live") : t("build.release.history.notReleased", "Not released")}
          </Chip>
          {(cur || where?.version) && <span className="num ml-auto font-mono text-[13px] text-ink2">{`v${cur?.version ?? where?.version}`}</span>}
        </div>
        {cur ? (
          <div className="mt-3 min-w-0 text-[13px]">
            <Address env={env} release={cur} />
            {formatDateTime(cur.releasedAt) && <div className="num mt-1 text-ink2">{formatDateTime(cur.releasedAt)}</div>}
            {where?.branch && <div className="mt-1 text-ink2">{t("build.release.main.branch", "Branch")} <span className="font-mono">{where.branch}</span></div>}
            {where?.documented && <div className="mt-1 text-ink2">{whereLine(where, formatDateTime)}</div>}
          </div>
        ) : liveOnly && where ? (
          <div className="mt-3 min-w-0 text-[13px]">
            {where.url && <a href={where.url} target="_blank" rel="noopener noreferrer" className="block truncate font-mono text-accent hover:underline" title={t("build.release.history.openAt", "Open the app at {host}", { host: where.host ?? where.url })}>{where.host ?? where.url}</a>}
            {where.branch && <div className="mt-1 text-ink2">{t("build.release.main.branch", "Branch")} <span className="font-mono">{where.branch}</span></div>}
            <p className="mt-1 text-ink2">{whereLine(where, formatDateTime)}</p>
          </div>
        ) : (
          <p className="mt-3 text-[13px] text-ink2">{t("build.release.history.nothing", "Nothing released yet")}</p>
        )}
        {state.history.length > 0 && (
          <ol className="mt-4 flex flex-col gap-3 border-t border-line pt-4">
            {state.history.map((h) => {
              const ids: readonly string[] = Array.isArray(h.changeRequestIds) ? h.changeRequestIds : [];
              const crs = ids.map((id) => byId.get(id)).filter((c): c is DeliveryChangeRequest => c !== undefined);
              return (
                <li key={h.id} className="min-w-0 text-[13px]">
                  <div>
                    <span className="num font-mono font-medium">{`v${h.version}`}</span>
                    {formatDateTime(h.releasedAt) && <span className="num text-ink2"> · {formatDateTime(h.releasedAt)}</span>}
                    <span className="num font-mono text-[12px] text-ink3"> · {commitLabel(h.sourceCommit)}</span>
                  </div>
                  {ids.length === 0 ? <div className="text-ink2">{t("build.release.history.noChanges", "No change requests")}</div> : (
                    <ul className="mt-1 flex flex-col gap-1">
                      {crs.map((r) => (
                        <li key={r.id} className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="num font-mono text-ink2">{changeCode(r)}</span>
                          <span className="min-w-0 [overflow-wrap:anywhere]">{r.title}</span>
                          <Chip tone={r.lane === "fix" ? "warning" : "accent"}>{r.lane === "fix" ? t("build.release.history.fix", "Fix") : t("build.release.history.change", "Change")}</Chip>
                        </li>
                      ))}
                      {crs.length < ids.length && (
                        <li className="text-ink3">{t("build.release.history.unreadable", "{count} not readable here", { count: ids.length - crs.length })}</li>
                      )}
                    </ul>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </div>
      <div className="mt-5 flex flex-col items-start gap-3">
        {next && candidate ? (
          <>
            <Button variant="secondary" iconRight={<ArrowUpRight size={16} strokeWidth={1.75} aria-hidden />} onClick={() => onPromote(next)}>
              {t("build.release.history.releaseTo", "Release to {env}", { env: envWord(next) })}
            </Button>
            <p className="text-[13px] text-ink2">
              {t("build.release.history.candidate", "v{version} is on {env} and not on {next} yet.", { version: candidate, env: envWord(env), next: envWord(next) })}
            </p>
          </>
        ) : next && cur ? (
          <p className="text-[13px] text-ink2">{t("build.release.history.upToDate", "{next} runs the latest {env} version.", { next: envName(next), env: envWord(env) })}</p>
        ) : null}
        {building && (
          <p className="text-[13px] text-ink2">
            {stopped?.(building) ? t("build.release.history.buildStopped", "Build stopped:") : t("build.release.history.building", "Building:")}{" "}<Link to={`/p/${projectId}/build?cr=${building.number}`} className="font-medium text-accent hover:underline">
              <span className="num font-mono">{changeCode(building)}</span> · {building.title}</Link>
          </p>
        )}
      </div>
    </Card>
  );
}
