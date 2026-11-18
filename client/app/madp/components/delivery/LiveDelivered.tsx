/** The finish line of the selected environment, from the project's real release rows: the version it runs and since
 *  when, "Open the app" (only for an https address), the address to copy, idea to first dev release in days (the
 *  project's creation to its first dev release; for an existing product attached as it is live, how long it has been
 *  with the Factory and the releases made since instead: it was running long before) and what this version carries
 *  (its change requests). A release without an address is never called live: dev says "Not deployed yet", stage and
 *  production wait for the engine. */
import { useEffect, useRef } from "react";
import { ArrowUpRight, Check, Copy, Globe } from "lucide-react";
import type { DeliveryChangeRequest, DeliveryRelease } from "@/madp/blocks/delivery/types";
import { changeCode } from "@/madp/domain/delivery";
import type { Environment } from "@/madp/domain/promotion";
import { formatDateTime } from "@/madp/lib/dates";
import { Confetti, RingPulse } from "./Celebration";
import { STAGE_HATCH } from "./GoLiveConsole";
import { commitLabel, firstReleaseFact } from "./liveRelease";
import { envWord, releaseLinkState } from "./releaseUi";
import { manualCopy, useCopy, useReducedMotion } from "./shared";
import { useT } from "@/madp/i18n";

export interface LiveProject {
  name: string; eyebrow: string; createdDate: string | null;
  /** An existing product attached to the Factory as it is live (attachedLive). */
  attached?: boolean;
  /** Every release to development, for an attached product's "releases since it came to the Factory". */
  devReleases?: readonly { releasedAt: string | null }[];
}

export function LiveDelivered({ project, env, release, firstDev, changes, milestones, celebrate, primary }: {
  project: LiveProject;
  env: Environment;
  release: DeliveryRelease;
  /** The project's first dev release (the oldest), for "idea to dev release". */
  firstDev: DeliveryRelease | null;
  /** The change requests this release carries (resolved from release.changeRequestIds). */
  changes: readonly DeliveryChangeRequest[];
  milestones: number;
  celebrate: boolean;
  /** False while another action on the page is the primary one. */
  primary: boolean;
}) {
  const t = useT();
  const link = releaseLinkState(env, release);
  const live = link.kind === "link";
  const href = live ? link.href : "";
  const host = live ? link.host : "";
  const { state: copyState, copy, target } = useCopy(href);
  const hero = useRef<HTMLElement>(null);
  const reduced = useReducedMotion();
  const version = `v${release.version}`;
  const envLabel = envWord(env);
  const since = formatDateTime(release.releasedAt);
  const fact = firstReleaseFact({
    attached: Boolean(project.attached), createdDate: project.createdDate,
    devReleases: project.devReleases ?? (firstDev ? [firstDev] : []),
  });
  const name = project.name || t("build.release.live.thisProject", "This project");
  useEffect(() => {
    if (celebrate) hero.current?.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
  }, [celebrate, reduced]);

  return (
    <section ref={hero} aria-labelledby="live-title"
      className="relative isolate scroll-mt-[calc(var(--project-nav-h,var(--topbar-h,0px))+24px)] overflow-hidden rounded-card bg-stage text-white shadow-float animate-rise dark:border dark:border-line" style={STAGE_HATCH}>
      {celebrate && live && <Confetti />}
      <div aria-hidden className="pointer-events-none absolute -right-24 -top-32 h-96 w-96 rounded-full bg-accent/25 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -bottom-40 left-[20%] h-80 w-80 rounded-full bg-success/15 blur-3xl" />

      <div className="relative grid grid-cols-1 gap-8 p-6 md:p-9 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <span className={`relative inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[13px] font-medium text-white ring-1 ring-inset ${live ? "bg-success/20 ring-success/40" : "bg-white/10 ring-white/15"}`}>
              {celebrate && live && <RingPulse className="rounded-full" />}
              <span className="relative flex h-2 w-2">
                {live && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success/70 motion-reduce:hidden" />}
                <span className={`relative inline-flex h-2 w-2 rounded-full ${live ? "bg-success" : "bg-white/60"}`} />
              </span>
              <span className="relative">{live ? t("build.release.live.liveOn", "Live on {env}", { env: envLabel }) : t("build.release.live.releasedTo", "Released to {env}", { env: envLabel })} · <span className="num">{version}</span></span>
            </span>
            {since && <span className="num text-[13px] text-white/60">{t("build.release.where.since", "Since {date}", { date: since })}</span>}
          </div>

          {project.eyebrow && <div className="mt-6 break-words text-[13px] text-white/60">{project.eyebrow}</div>}
          <h2 id="live-title" className="mt-1 break-words text-[36px] font-medium leading-[1.04] tracking-[-0.035em] sm:text-[44px] md:text-[58px]">
            {name}<br />{live ? t("build.release.live.isLiveOn", "is live on {env}.", { env: envLabel }) : t("build.release.live.versionOn", "{version} on {env}.", { version, env: envLabel })}
          </h2>
          <p className="mt-4 max-w-lg text-[16px] leading-relaxed text-white/65">
            {live
              ? <>{t("build.release.live.runsOn", "Version {version} runs on {env}.", { version, env: envLabel })}</>
              : <>{link.text}.</>}
            {milestones > 0 && <> {milestones === 1 ? t("build.release.live.plansOne", "The locked scope plans 1 milestone.")
              : t("build.release.live.plansMany", "The locked scope plans {count} milestones.", { count: milestones })}</>}
          </p>

          {live && (
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <a href={href} target="_blank" rel="noopener noreferrer"
                className={`inline-flex h-12 items-center gap-2 rounded-full px-6 text-[15px] font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-white/60 ${primary ? "bg-accent text-white hover:bg-accent-hover" : "bg-white/15 text-white hover:bg-white/20"}`}>
                {t("build.release.main.openAppOn", "Open the app on {env}", { env: envLabel })}<ArrowUpRight size={18} strokeWidth={2} aria-hidden />
              </a>
              <div className="flex w-full min-w-0 items-center justify-between gap-2 rounded-full bg-white/10 py-1.5 pl-3.5 pr-1.5 ring-1 ring-inset ring-white/10 sm:w-auto sm:justify-start sm:pl-4">
                <Globe size={16} strokeWidth={1.75} className="hidden shrink-0 text-white/60 sm:block" aria-hidden />
                <span ref={target} className="min-w-0 truncate font-mono text-[12px] sm:text-[14px]" title={href}>{host}</span>
                <button type="button" onClick={copy} aria-label={t("build.release.live.copyAddress", "Copy the app address")}
                  className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[13px] font-medium text-white/80 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 sm:px-3">
                  {copyState === "copied" ? <Check size={14} strokeWidth={2.5} aria-hidden /> : <Copy size={14} strokeWidth={1.75} aria-hidden />}
                  <span aria-live="polite" className="sr-only sm:not-sr-only">{copyState === "copied" ? t("build.release.copy.copied", "Copied") : copyState === "manual" ? manualCopy(t("build.release.copy.address", "Address")) : t("build.release.copy.copy", "Copy")}</span>
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-col rounded-block bg-white/[0.06] p-6 ring-1 ring-inset ring-white/10 lg:self-start">
          {fact.kind === "attached" ? (
            <>
              <div className="text-[14px] text-white/60">{t("build.release.live.releasesThrough", "Releases through the Factory")}</div>
              <div className="mt-3 flex items-end gap-2.5">
                <span className="num text-[88px] font-medium leading-[0.78] tracking-[-0.06em] sm:text-[104px]">{fact.releases}</span>
                <span className="pb-0.5 text-[24px] font-medium tracking-tight">{fact.releases === 1 ? t("build.release.live.releaseOne", "release") : t("build.release.live.releaseMany", "releases")}</span>
              </div>
              {fact.since && <div className="num mt-4 text-[13px] text-white/60">{t("build.release.live.withSince", "With the Factory since {date}", { date: formatDateTime(fact.since) })}</div>}
              <div className="mt-5 border-t border-white/10 pt-4 text-[12px] text-white/60">
                {t("build.release.live.attachedNote", "{name} came to the Factory as a live product; these are the releases to development the Factory made since.", { name })}
              </div>
            </>
          ) : (
            <>
              <div className="text-[14px] text-white/60">{t("build.release.live.ideaToFirst", "Idea to first release")}</div>
              {fact.kind === "idea" ? (
                <>
                  <div className="mt-3 flex items-end gap-2.5">
                    <span className="num text-[88px] font-medium leading-[0.78] tracking-[-0.06em] sm:text-[104px]">{fact.days < 1 ? "<1" : fact.days}</span>
                    <span className="pb-0.5 text-[24px] font-medium tracking-tight">{fact.days > 1 ? t("build.release.live.days", "days") : t("build.release.live.day", "day")}</span>
                  </div>
                  <div className="num mt-4 text-[13px] text-white/60">{formatDateTime(fact.from)} → {formatDateTime(fact.to)}</div>
                  <div className="mt-5 border-t border-white/10 pt-4 text-[12px] text-white/60">{t("build.release.live.ideaNote", "From the start of the project to its first release to development.")}</div>
                </>
              ) : (
                <p className="mt-3 text-[13px] text-white/60">{t("build.release.live.ideaUnknown", "Shown once the first release to development has a date.")}</p>
              )}
            </>
          )}
        </div>
      </div>

      <div className="relative flex flex-wrap items-center gap-2 border-t border-white/10 px-6 py-4 md:px-9">
        <span className="mr-1 text-[12px] text-white/60">{t("build.release.live.inVersion", "In {version}", { version })} · <span className="num font-mono">{commitLabel(release.sourceCommit)}</span></span>
        {changes.length === 0 ? (
          <span className="text-[12px] font-medium text-white/80">{t("build.release.live.noChanges", "No change requests in this version")}</span>
        ) : changes.map((c) => (
          <span key={c.id} className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full bg-white/10 py-1 pl-1.5 pr-3 text-[12px] font-medium">
            {/* the stage is dark in both themes: the done marker, not a theme colour */}
            <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-success text-stage"><Check size={10} strokeWidth={3} aria-hidden /></span>
            <span className="num shrink-0 font-mono">{changeCode(c)}</span>
            <span className="min-w-0 truncate">{c.title}</span>
          </span>
        ))}
      </div>
    </section>
  );
}
