/** A deployed version opened as the client's own app (/preview/<projectId>/<version>[?env=staging|production]): its
 *  designed screens and, for a feature without a screen, a page drawn from the feature's user stories, in the app's own
 *  colour. A slim bar at the bottom names the environment and the version, steps through the pages and tells what the
 *  version holds. Everything comes from the project's rows (preview or release, milestones, features, stories, screens);
 *  a version without an address is never shown as online. */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronLeft, ChevronRight, Info, X } from "lucide-react";
import { blocksAllOptions } from "@/madp/blocks/data/hooks";
import type { Where } from "@/madp/blocks/data/gql";
import { useDeliveryContext } from "@/madp/blocks/delivery/context";
import { useChangeRequests, usePreviews, useReleases } from "@/madp/blocks/delivery/hooks";
import type { DeliveryPreview, DeliveryRelease } from "@/madp/blocks/delivery/types";
import { useScopeContext } from "@/madp/blocks/scope/context";
import { useScreenUrls } from "@/madp/blocks/scope/hooks";
import { changeCode, safeExternalUrl } from "@/madp/domain/delivery";
import { compareVersions } from "@/madp/domain/numbering";
import {
  appInitials, appPages, inkOn, versionFeatures, type AppEnvironment, type AppFeature, type AppPage,
} from "@/madp/domain/appPreview";
import { formatDateTime } from "@/madp/lib/dates";
import { cn } from "@/madp/lib/cn";
import { envName, envWord } from "@/madp/components/delivery/releaseUi";
import { useT } from "@/madp/i18n";
import { prefixPath, rewritePath } from "@/madp/lib/pathPrefix";

/* ── rows ─────────────────────────────────────────────────────────────────────────────────────────────────────── */

interface FeatureRow { ItemId: string; ProjectId?: string; ScopeVersion?: number; Key?: string; Title?: string; Description?: string; Priority?: string; SortOrder?: number }
interface StoryRow { ItemId: string; ProjectId?: string; ScopeVersion?: number; FeatureRef?: string; Title?: string; Text?: string; AcceptanceCriteria?: string[]; SortOrder?: number }
interface MilestoneRow { ItemId: string; ProjectId?: string; ScopeVersion?: number; Number?: number; Name?: string; Goal?: string; PreviewPoint?: string; FeatureRefs?: string[]; SortOrder?: number; Status?: string }
interface ScreenRow { ItemId: string; ProjectId?: string; Key?: string; Name?: string; Version?: number; Width?: number; Height?: number; SortOrder?: number; Status?: string }

const SCREEN_STATUSES = ["generated", "accepted", "changes-requested"];

function useProjectRows<T extends { ProjectId?: string }>(
  schema: string, workspaceId: string | null, projectId: string, fields: readonly string[], more: Where<T> | null, enabled: boolean,
) {
  const where = ({ op: "and", clauses: [{ op: "eq", field: "ProjectId", value: projectId }, ...(more ? [more] : [])] }) as unknown as Where<T>;
  return useQuery({
    ...blocksAllOptions<T>(schema, { workspaceId, fields: fields as never, where, maxItems: 500 }),
    enabled: Boolean(workspaceId) && enabled,
  });
}

/* ── the app's colour: sampled from its first screen (the header of a phone screen, the side bar of a desktop one) ── */

type Rgb = [number, number, number];
const FALLBACK: Rgb = [31, 41, 55];

function useBrand(url: string | null, mobile: boolean): Rgb {
  const [rgb, setRgb] = useState<Rgb | null>(null);
  useEffect(() => {
    if (!url) return;
    let alive = true;
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement("canvas");
        c.width = 1;
        c.height = 1;
        const g = c.getContext("2d");
        if (!g) return;
        const x = Math.round(img.naturalWidth * 0.04);
        const y = Math.round(img.naturalHeight * (mobile ? 0.08 : 0.6));
        g.drawImage(img, x, y, 1, 1, 0, 0, 1, 1);
        const d = g.getImageData(0, 0, 1, 1).data;
        const v: Rgb = [d[0] ?? 0, d[1] ?? 0, d[2] ?? 0];
        // a near-white sample is the page, not the brand
        if (alive && v[0] + v[1] + v[2] < 640) setRgb(v);
      } catch {
        /* keep the neutral colour */
      }
    };
    img.src = url;
    return () => { alive = false; };
  }, [url, mobile]);
  return rgb ?? FALLBACK;
}

/* ── the route's view ─────────────────────────────────────────────────────────────────────────────────────────── */

interface Target {
  kind: "preview" | "release";
  version: string;
  environment: AppEnvironment;
  online: boolean;
  at: string | null;
  milestoneId: string | null;
  changeIds: readonly string[];
}

function findTarget(previews: readonly DeliveryPreview[], releases: readonly DeliveryRelease[], version: string, env: AppEnvironment): Target | null {
  const newest = <T extends { version: string }>(list: T[], at: (x: T) => string | null): T | null =>
    list.sort((a, b) => (Date.parse(at(b) ?? "") || 0) - (Date.parse(at(a) ?? "") || 0) || compareVersions(b.version, a.version))[0] ?? null;
  if (env === "dev") {
    const p = newest(previews.filter((x) => x.version === version), (x) => x.createdAt);
    if (p) return { kind: "preview", version, environment: "dev", online: safeExternalUrl(p.url) !== null, at: p.createdAt, milestoneId: p.milestoneId, changeIds: [] };
  }
  const r = newest(releases.filter((x) => x.environment === env && x.version === version), (x) => x.releasedAt);
  if (!r) return null;
  return { kind: "release", version, environment: env, online: safeExternalUrl(r.url) !== null, at: r.releasedAt, milestoneId: null, changeIds: r.changeRequestIds };
}

export function AppPreview({ projectId, version, environment }: { projectId: string; version: string; environment: AppEnvironment }) {
  const t = useT();
  const ctx = useDeliveryContext(projectId);
  const scope = useScopeContext(projectId);
  const previews = usePreviews(ctx);
  const releases = useReleases(ctx);
  const changes = useChangeRequests(ctx);
  const ws = ctx.workspaceId;
  const n = ctx.project?.currentScopeVersion ?? null;
  const inVersion = n === null ? null : ({ op: "eq", field: "ScopeVersion", value: n } as const);
  const featuresQ = useProjectRows<FeatureRow>("Feature", ws, projectId, ["ItemId", "ProjectId", "ScopeVersion", "Key", "Title", "Description", "Priority", "SortOrder"], inVersion as never, n !== null);
  const storiesQ = useProjectRows<StoryRow>("Story", ws, projectId, ["ItemId", "ProjectId", "ScopeVersion", "FeatureRef", "Title", "Text", "AcceptanceCriteria", "SortOrder"], inVersion as never, n !== null);
  const milestonesQ = useProjectRows<MilestoneRow>("Milestone", ws, projectId, ["ItemId", "ProjectId", "ScopeVersion", "Number", "Name", "Goal", "PreviewPoint", "FeatureRefs", "SortOrder", "Status"], inVersion as never, n !== null);
  const screensQ = useProjectRows<ScreenRow>("DesignScreen", ws, projectId, ["ItemId", "ProjectId", "Key", "Name", "Version", "Width", "Height", "SortOrder", "Status"],
    { op: "in", field: "Status", values: SCREEN_STATUSES } as never, true);

  const projectName = ctx.project?.name || scope.project?.name || "";
  const target = useMemo(() => findTarget([...previews.data], [...releases.data], version, environment), [previews.data, releases.data, version, environment]);

  // the newest version of each designed screen
  const screens = useMemo(() => {
    const best = new Map<string, ScreenRow>();
    for (const s of screensQ.data ?? []) {
      const key = s.Key || s.ItemId;
      const cur = best.get(key);
      if (!cur || (s.Version ?? 0) > (cur.Version ?? 0)) best.set(key, s);
    }
    return [...best.values()].map((s) => ({
      id: s.ItemId, name: s.Name || t("build.preview.screen", "Screen"), sortOrder: s.SortOrder ?? 0,
      width: s.Width && s.Width > 0 ? s.Width : 390, height: s.Height && s.Height > 0 ? s.Height : 844,
    }));
  }, [screensQ.data, t]);

  const features: (AppFeature & { stories: { title: string; criteria: string[] }[] })[] = useMemo(() => {
    const stories = [...(storiesQ.data ?? [])].sort((a, b) => (a.SortOrder ?? 0) - (b.SortOrder ?? 0));
    return [...(featuresQ.data ?? [])]
      .filter((f) => f.Priority !== "excluded" && f.Key)
      .sort((a, b) => (a.SortOrder ?? 0) - (b.SortOrder ?? 0))
      .map((f) => ({
        ref: `feature:${f.Key}`, name: f.Title || "", description: f.Description || "",
        stories: stories.filter((s) => s.FeatureRef === `feature:${f.Key}`).map((s) => ({
          title: (s.Title || s.Text || "").trim(), criteria: (s.AcceptanceCriteria ?? []).filter((c) => typeof c === "string" && c.trim()),
        })).filter((s) => s.title),
      }));
  }, [featuresQ.data, storiesQ.data]);

  const milestones = useMemo(() => (milestonesQ.data ?? []).map((m) => ({
    id: m.ItemId, number: m.Number ?? 0, sortOrder: m.SortOrder ?? 0, featureRefs: m.FeatureRefs ?? [], status: m.Status ?? "planned",
    name: m.Name ?? "", goal: m.Goal ?? "", previewPoint: m.PreviewPoint ?? "",
  })), [milestonesQ.data]);

  const plan = useMemo(() => {
    if (!target) return null;
    const { refs, newRefs } = versionFeatures(milestones, target.kind === "preview" && target.milestoneId ? { kind: "preview", milestoneId: target.milestoneId } : { kind: "release" });
    // features in delivery order (milestone order, then the feature's own order)
    const order = new Map(features.map((f, i) => [f.ref, i]));
    const ordered = refs.filter((r) => order.has(r));
    const changed = changes.data.filter((c) => target.changeIds.includes(c.id));
    const changedRefs = changed.map((c) => c.featureRef).filter((r) => r && ordered.includes(r));
    const fresh = target.kind === "release" ? [...new Set(changedRefs)] : newRefs;
    const pages = appPages({ features, screens, refs: ordered, newRefs: fresh });
    return { refs: ordered, newRefs: fresh, pages, changed };
  }, [target, milestones, features, screens, changes.data]);

  const screenIds = useMemo(() => (plan?.pages ?? []).map((p) => p.screenId).filter((x): x is string => x !== null), [plan]);
  const urls = useScreenUrls(scope, screenIds).data ?? {};
  const mobile = screens.filter((s) => s.width < s.height).length >= screens.filter((s) => s.width >= s.height).length && screens.length > 0;
  const firstUrl = screenIds.map((id) => urls[id]?.url ?? null).find((u): u is string => Boolean(u)) ?? null;
  const brand = useBrand(firstUrl, mobile);

  const [index, setIndex] = useState(0);
  const [about, setAbout] = useState(false);
  const pages = plan?.pages ?? [];
  const page = pages[Math.min(index, Math.max(0, pages.length - 1))] ?? null;

  // the environment's name as a label ("Staging") and inside a sentence ("staging"), in the current language
  const envLabel = envName(environment);
  const envInText = envWord(environment);
  useEffect(() => {
    if (!projectName) return;
    document.title = environment === "production" ? projectName : `${projectName} · ${envLabel}`;
  }, [projectName, environment, envLabel]);

  // ← → step through the pages; Escape closes the window
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === "Escape") setAbout(false);
      if (about) return;
      if (e.key === "ArrowRight") setIndex((i) => Math.min(i + 1, Math.max(0, pages.length - 1)));
      if (e.key === "ArrowLeft") setIndex((i) => Math.max(0, i - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [about, pages.length]);
  useEffect(() => { window.scrollTo(0, 0); }, [index]);

  const back = { href: prefixPath(`/p/${projectId}/${target?.kind === "preview" ? "build" : "delivered"}`), label: t("build.preview.openProject", "Open the project") };
  if (ctx.status === "not_found" || ctx.status === "error") {
    return <Notice title={t("build.preview.unavailableTitle", "This app isn't available")} text={t("build.preview.unavailableText", "It belongs to a project you can't open with this account, or the project no longer exists.")}
      action={<Link to={rewritePath("/projects")} className={NOTICE_LINK}>{t("build.preview.goProjects", "Go to your projects")}</Link>} />;
  }
  const loading = ctx.status === "loading" || previews.isLoading || releases.isLoading
    || (n !== null && (featuresQ.isPending || storiesQ.isPending || milestonesQ.isPending)) || screensQ.isPending;
  if (loading) return <div aria-busy="true" className="min-h-screen bg-canvas" />;
  if (!target) {
    return <Notice title={t("build.preview.offlineTitle", "This version isn't online")}
      text={projectName ? t("build.preview.offlineText", "{project} has no version {version} on {env}.", { project: projectName, version, env: envInText })
        : t("build.preview.offlineTextAny", "This project has no version {version} on {env}.", { version, env: envInText })}
      action={<Link to={back.href} className={NOTICE_LINK}>{back.label}</Link>} />;
  }
  if (!target.online) {
    return <Notice title={t("build.preview.goingTitle", "Version {version} is going online", { version })} text={t("build.preview.goingText", "It opens here as soon as it runs on {env}.", { env: envInText })}
      action={<button type="button" onClick={() => window.location.reload()} className={NOTICE_LINK}>{t("build.preview.tryAgain", "Try again")}</button>} />;
  }

  const milestone = target.milestoneId ? milestones.find((m) => m.id === target.milestoneId) ?? null : null;
  const total = milestones.length;
  const ink = inkOn(brand);
  const brandStyle: CSSProperties = { backgroundColor: `rgb(${brand.join(" ")})`, color: ink };
  const appName = projectName || t("build.preview.app", "App");

  return (
    <div className="min-h-screen bg-canvas">
      <main className="pb-28 sm:px-6 sm:pt-6">
        {page === null ? (
          <Generated mobile={mobile} brandStyle={brandStyle} appName={appName} title={appName} description="" stories={[]} pages={[]} current={0} onPage={setIndex} />
        ) : page.screenId ? (
          <ScreenImage key={page.id} page={page} screen={screens.find((s) => s.id === page.screenId) ?? null} url={urls[page.screenId]?.url ?? null} />
        ) : (
          <Generated key={page.id} mobile={mobile} brandStyle={brandStyle} appName={appName} title={page.title}
            description={features.find((f) => f.ref === page.featureRef)?.description ?? ""}
            stories={features.find((f) => f.ref === page.featureRef)?.stories ?? []}
            pages={pages} current={Math.min(index, pages.length - 1)} onPage={setIndex} />
        )}
      </main>

      <Bar environment={environment} version={version} pages={pages} index={Math.min(index, Math.max(0, pages.length - 1))}
        onIndex={setIndex} about={about} onAbout={setAbout} />

      {about && (
        <About onClose={() => setAbout(false)} appName={appName} initials={appInitials(appName)} brandStyle={brandStyle}
          line={target.at ? t("build.preview.lineSince", "Version {version} on {env} · since {at}", { version, env: envInText, at: formatDateTime(target.at) }) : t("build.preview.line", "Version {version} on {env}", { version, env: envInText })}
          milestone={milestone ? {
            title: total ? t("build.preview.milestoneOf", "Milestone {number} of {total}: {name}", { number: milestone.number, total, name: milestone.name }) : t("build.page.milestoneNamed", "Milestone {number}: {name}", { number: milestone.number, name: milestone.name }),
            tryThis: milestone.previewPoint || milestone.goal,
          } : null}
          changes={(plan?.changed ?? []).map((c) => ({ code: changeCode(c), title: c.title }))}
          pages={pages} index={index} onPage={(i) => { setIndex(i); setAbout(false); }}
          features={(plan?.refs ?? []).map((r) => features.find((f) => f.ref === r)).filter((f): f is NonNullable<typeof f> => Boolean(f))
            .map((f) => ({ name: f.name, isNew: plan?.newRefs.includes(f.ref) ?? false, stories: f.stories.map((s) => s.title) }))} />
      )}
    </div>
  );
}

/* ── pieces ───────────────────────────────────────────────────────────────────────────────────────────────────── */

const NOTICE_LINK = "mt-5 inline-flex h-10 items-center rounded-full bg-accent px-5 text-[14px] font-medium text-white outline-none hover:bg-accent-hover focus-visible:ring-2 focus-visible:ring-accent/50";

function Notice({ title, text, action }: { title: string; text: string; action: ReactNode }) {
  return (
    <div className="grid min-h-screen place-items-center bg-canvas px-4">
      <div className="max-w-md text-center">
        <h1 className="text-[22px] font-medium tracking-[-0.01em] text-ink">{title}</h1>
        <p className="mt-2 text-[14px] leading-relaxed text-ink2">{text}</p>
        {action}
      </div>
    </div>
  );
}

function ScreenImage({ page, screen, url }: { page: AppPage; screen: { width: number; height: number } | null; url: string | null }) {
  const w = screen?.width ?? 390;
  const h = screen?.height ?? 844;
  const phone = w < h;
  const [loaded, setLoaded] = useState(false);
  return (
    // on a phone the screen fills the width; on a larger window it fits the window's height, like the device would
    <div className={cn("relative mx-auto w-full overflow-hidden bg-white sm:rounded-[20px] sm:shadow-float",
      phone ? "max-w-[390px] sm:w-[min(390px,calc((100dvh_-_7.5rem)_*_var(--fit)))] sm:rounded-[32px]" : "max-w-[1200px] sm:w-[min(1200px,100%,calc((100dvh_-_7.5rem)_*_var(--fit)))]")}
      style={{ aspectRatio: `${w} / ${h}`, "--fit": String(w / h) } as CSSProperties}>
      {url && (
        <img src={url} alt={page.title} width={w} height={h} onLoad={() => setLoaded(true)} draggable={false}
          className={cn("block h-full w-full select-none object-cover transition-opacity duration-300", loaded ? "opacity-100" : "opacity-0")} />
      )}
      {!loaded && <div aria-hidden className="absolute inset-0 animate-pulse bg-[#eef0f3]" />}
    </div>
  );
}

function Generated({ mobile, brandStyle, appName, title, description, stories, pages, current, onPage }: {
  mobile: boolean; brandStyle: CSSProperties; appName: string; title: string; description: string;
  stories: readonly { title: string; criteria: readonly string[] }[]; pages: readonly AppPage[]; current: number; onPage: (i: number) => void;
}) {
  const cards = (
    <div className={cn("grid gap-3", !mobile && "sm:grid-cols-2 sm:gap-4")}>
      {stories.map((s, i) => (
        <div key={i} className="rounded-2xl border border-[#e5e7eb] bg-white p-4 text-left shadow-[0_1px_2px_rgb(0_0_0/0.04)]">
          <p className="text-[15px] font-medium text-[#111827]">{s.title}</p>
          {s.criteria.length > 0 && (
            <ul className="mt-2 space-y-1.5">
              {s.criteria.map((c, j) => (
                <li key={j} className="flex gap-2 text-[13px] leading-snug text-[#4b5563]">
                  <Check size={14} strokeWidth={2.25} className="mt-[2px] shrink-0" style={{ color: brandStyle.backgroundColor as string }} aria-hidden />{c}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
  if (mobile) {
    return (
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-[390px] flex-col overflow-hidden bg-[#f5f6f8] sm:aspect-[390/844] sm:min-h-0 sm:w-[min(390px,calc((100dvh_-_7.5rem)_*_0.4621))] sm:overflow-y-auto sm:rounded-[32px] sm:shadow-float">
        <header className="px-5 pb-6 pt-7" style={brandStyle}>
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] opacity-80">{appName}</p>
          <h1 className="mt-1 text-[24px] font-semibold leading-tight tracking-[-0.01em]">{title}</h1>
        </header>
        <div className="flex-1 space-y-3 p-4">
          {description && <p className="px-1 text-[14px] leading-relaxed text-[#4b5563]">{description}</p>}
          {cards}
        </div>
      </div>
    );
  }
  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-[1200px] overflow-hidden bg-[#f5f6f8] sm:aspect-[1440/900] sm:min-h-0 sm:w-[min(1200px,100%,calc((100dvh_-_7.5rem)_*_1.6))] sm:rounded-[20px] sm:shadow-float">
      <aside className="hidden w-60 shrink-0 flex-col gap-1 p-4 sm:flex" style={brandStyle}>
        <p className="mb-4 px-2 pt-1 text-[15px] font-semibold">{appName}</p>
        {pages.map((p, i) => (
          <button key={p.id} type="button" onClick={() => onPage(i)} aria-current={i === current ? "page" : undefined}
            className={cn("rounded-lg px-3 py-2 text-left text-[14px] outline-none transition focus-visible:ring-2 focus-visible:ring-white/60",
              i === current ? "bg-white/20 font-medium" : "opacity-80 hover:bg-white/10 hover:opacity-100")}>
            {p.title}
          </button>
        ))}
      </aside>
      <section className="min-w-0 flex-1 sm:overflow-y-auto">
        <header className="px-5 py-4 sm:hidden" style={brandStyle}><p className="text-[15px] font-semibold">{appName}</p></header>
        <div className="p-5 sm:p-8">
          <h1 className="text-[24px] font-semibold tracking-[-0.01em] text-[#111827] sm:text-[28px]">{title}</h1>
          {description && <p className="mt-1.5 max-w-2xl text-[14px] leading-relaxed text-[#4b5563]">{description}</p>}
          <div className="mt-6">{cards}</div>
        </div>
      </section>
    </div>
  );
}

const ENV_DOT: Record<AppEnvironment, string> = { dev: "bg-amber-400", stage: "bg-sky-400", production: "bg-emerald-400" };
const BAR_BTN = "grid h-9 w-9 shrink-0 place-items-center rounded-full text-white/85 outline-none transition hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white/60 disabled:opacity-30 disabled:hover:bg-transparent";

function Bar({ environment, version, pages, index, onIndex, about, onAbout }: {
  environment: AppEnvironment; version: string; pages: readonly AppPage[]; index: number; onIndex: (i: number) => void;
  about: boolean; onAbout: (open: boolean) => void;
}) {
  const t = useT();
  const page = pages[index] ?? null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-3 z-40 flex justify-center px-3">
      <nav aria-label={t("build.preview.thisVersion", "This version")} className="pointer-events-auto flex min-w-0 max-w-full items-center gap-0.5 rounded-full bg-[#111827]/95 p-1 pl-3.5 text-white shadow-float ring-1 ring-white/10 backdrop-blur">
        <span className="flex shrink-0 items-center gap-2 pr-1.5 text-[13px] font-medium">
          <span aria-hidden className={cn("h-2 w-2 rounded-full", ENV_DOT[environment])} />
          {envName(environment)}
          <span className="num font-mono text-[12px] font-normal text-white/65">v{version}</span>
        </span>
        {pages.length > 1 && (<>
          <span aria-hidden className="mx-1 h-5 w-px bg-white/15" />
          <button type="button" className={BAR_BTN} aria-label={t("build.preview.prev", "Previous page")} disabled={index === 0} onClick={() => onIndex(Math.max(0, index - 1))}>
            <ChevronLeft size={18} aria-hidden />
          </button>
          <button type="button" onClick={() => onAbout(!about)} aria-expanded={about} aria-haspopup="dialog"
            className="flex h-9 min-w-0 items-center gap-2 rounded-full px-2.5 text-[13px] outline-none transition hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white/60">
            <span className="min-w-0 max-w-[34vw] truncate sm:max-w-[260px]">{page?.title}</span>
            <span className="num shrink-0 text-white/55">{index + 1}/{pages.length}</span>
          </button>
          <button type="button" className={BAR_BTN} aria-label={t("build.preview.next", "Next page")} disabled={index >= pages.length - 1} onClick={() => onIndex(Math.min(pages.length - 1, index + 1))}>
            <ChevronRight size={18} aria-hidden />
          </button>
        </>)}
        <button type="button" className={BAR_BTN} aria-label={t("build.preview.about", "About this version")} aria-expanded={about} aria-haspopup="dialog" onClick={() => onAbout(!about)}>
          <Info size={17} aria-hidden />
        </button>
      </nav>
    </div>
  );
}

function About({ onClose, appName, initials, brandStyle, line, milestone, changes, pages, index, onPage, features }: {
  onClose: () => void; appName: string; initials: string; brandStyle: CSSProperties; line: string;
  milestone: { title: string; tryThis: string } | null;
  changes: readonly { code: string; title: string }[];
  pages: readonly AppPage[]; index: number; onPage: (i: number) => void;
  features: readonly { name: string; isNew: boolean; stories: readonly string[] }[];
}) {
  const t = useT();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { box.current?.focus(); }, []);
  const h3 = "text-[11px] font-medium uppercase tracking-[0.12em] text-white/50";
  return (
    <>
      <div aria-hidden className="fixed inset-0 z-40 bg-black/20" onClick={onClose} />
      <div ref={box} role="dialog" aria-modal="true" aria-label={t("build.preview.aboutApp", "About {app}", { app: appName })} tabIndex={-1}
        className="fixed inset-x-3 bottom-[4.25rem] z-50 mx-auto max-h-[min(70dvh,640px)] max-w-[520px] overflow-y-auto overscroll-contain rounded-[20px] bg-[#111827] p-5 text-white shadow-float outline-none ring-1 ring-white/10">
        <div className="flex items-start gap-3">
          <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-[14px] font-semibold" style={brandStyle}>{initials}</span>
          <div className="min-w-0 flex-1">
            <h2 className="break-words text-[16px] font-semibold">{appName}</h2>
            <p className="mt-0.5 text-[13px] text-white/65">{line}</p>
          </div>
          <button type="button" className={BAR_BTN} aria-label={t("build.preview.close", "Close")} onClick={onClose}><X size={17} aria-hidden /></button>
        </div>

        {milestone && (
          <div className="mt-4 rounded-2xl bg-white/[0.06] p-4">
            <p className="text-[13px] font-medium text-white/85">{milestone.title}</p>
            {milestone.tryThis && <p className="mt-1.5 text-[14px] leading-relaxed text-white"><span className="text-white/55">{t("build.preview.tryThis", "Try this: ")}</span>{milestone.tryThis}</p>}
          </div>
        )}

        {changes.length > 0 && (
          <section className="mt-5">
            <h3 className={h3}>{t("build.preview.newInVersion", "New in this version")}</h3>
            <ul className="mt-2 space-y-1.5">
              {changes.map((c) => (
                <li key={c.code} className="flex gap-2 text-[14px]"><span className="num shrink-0 font-mono text-[12px] leading-[21px] text-white/55">{c.code}</span><span className="min-w-0 break-words">{c.title}</span></li>
              ))}
            </ul>
          </section>
        )}

        {pages.length > 1 && (
          <section className="mt-5">
            <h3 className={h3}>{t("build.preview.pages", "Pages")}</h3>
            <ul className="mt-2 grid gap-1 sm:grid-cols-2">
              {pages.map((p, i) => (
                <li key={p.id}>
                  <button type="button" onClick={() => onPage(i)} aria-current={i === index ? "page" : undefined}
                    className={cn("flex w-full min-w-0 items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[14px] outline-none transition focus-visible:ring-2 focus-visible:ring-white/60",
                      i === index ? "bg-white/15" : "hover:bg-white/10")}>
                    <span className="min-w-0 flex-1 truncate">{p.title}</span>
                    {p.isNew && <span className="shrink-0 rounded-full bg-emerald-400/15 px-2 py-0.5 text-[11px] font-medium text-emerald-300">{t("build.preview.new", "New")}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {features.length > 0 && (
          <section className="mt-5">
            <h3 className={h3}>{t("build.preview.canDo", "What you can do")}</h3>
            <ul className="mt-2 space-y-3">
              {features.map((f) => (
                <li key={f.name}>
                  <p className="flex flex-wrap items-center gap-2 text-[14px] font-medium">
                    {f.name}
                    {f.isNew && <span className="rounded-full bg-emerald-400/15 px-2 py-0.5 text-[11px] font-medium text-emerald-300">{t("build.preview.new", "New")}</span>}
                  </p>
                  {f.stories.length > 0 && (
                    <ul className="mt-1 space-y-0.5">
                      {f.stories.map((s, i) => <li key={i} className="text-[13px] leading-snug text-white/70">{s}</li>)}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </>
  );
}
