/** Rich cards above the composer: the website preview, files uploading and being read, where the code lives (MADP
 *  Factory, or the visitor's own GitHub connected for real), the summary and the first requirements. One card at a
 *  time, the one the conversation is on. */
import { useEffect, useState } from "react";
import { AlertCircle, Check, ExternalLink, FileSpreadsheet, FileText, Globe, Loader2, ShieldCheck } from "lucide-react";
import { phaseText } from "@/components/setup/shareModel";
import { t, useT } from "@/i18n";
import { useConnectGithub, useGithubStatus } from "@/blocks/github";
import { cn } from "@/lib/cn";
import { GITHUB_ANSWER } from "../journey/script";
import { useJourney, type UploadFile } from "../journey/store";
import { websiteLabel } from "../journey/real";
import { GuideAvatar } from "./Avatar";

export function GithubMark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

const card = "cine-card cine-rise";

/** The real office: the address as the person gave it (no preview is made up), and whether it is saved yet. */
function RealWebsiteCard() {
  useT();
  const url = useJourney((s) => s.answers.website);
  const save = useJourney((s) => s.websiteSave);
  const href = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  return (
    <div className={cn(card, "flex w-[420px] items-center gap-3 p-3")}>
      <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent"><Globe size={22} aria-hidden /></span>
      <div className="min-w-0 flex-1">
        <a href={href} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 truncate text-[15px] font-semibold text-ink hover:underline">
          <span className="truncate">{websiteLabel(url)}</span><ExternalLink size={13} aria-hidden className="shrink-0 text-ink3" />
        </a>
        <div role="status" className={cn("mt-0.5 flex items-center gap-1.5 text-[12.5px]", save === "failed" ? "text-danger" : save === "saved" ? "text-success" : "text-ink3")}>
          {save === "saved" ? <><Check size={13} aria-hidden /> {t("studio.cinematic.cards.websiteSaved", "Saved to the project's material")}</>
            : save === "failed" ? <><AlertCircle size={13} aria-hidden /> {t("studio.cinematic.cards.websiteNotSaved", "Not saved. You can add it in Project setup.")}</>
            : <><Loader2 size={13} className="animate-spin" aria-hidden /> {t("studio.cinematic.cards.websiteSaving", "Saving to the project…")}</>}
        </div>
      </div>
    </div>
  );
}

function WebsiteCard() {
  const real = useJourney((s) => s.mode === "real");
  return real ? <RealWebsiteCard /> : <StoryWebsiteCard />;
}

function StoryWebsiteCard() {
  useT();
  const site = useJourney((s) => s.answers.website);
  const info = useJourney((s) => s.story.site);
  const bar = (op: number) => ({ background: info.ink, opacity: op });
  return (
    <div className={cn(card, "flex w-[420px] gap-3 p-3")}>
      <div className="grid h-[74px] w-[112px] shrink-0 place-items-center overflow-hidden rounded-xl" style={{ background: `linear-gradient(to bottom right, ${info.tint[0]}, ${info.tint[1]})` }}>
        <div className="w-[88px] space-y-1.5">
          <div className="h-2 w-10 rounded-full" style={bar(1)} />
          <div className="h-1.5 w-full rounded-full" style={bar(0.25)} />
          <div className="h-1.5 w-3/4 rounded-full" style={bar(0.25)} />
          <div className="mt-2 flex gap-1"><div className="h-5 w-7 rounded bg-white/90" /><div className="h-5 w-7 rounded bg-white/90" /><div className="h-5 w-7 rounded bg-white/90" /></div>
        </div>
      </div>
      <div className="min-w-0 py-0.5">
        <div className="flex items-center gap-1.5 text-[12px] text-ink3"><Globe size={12} aria-hidden /> {site}</div>
        <div className="mt-0.5 truncate text-[15px] font-semibold text-ink">{info.title}</div>
        <div className="line-clamp-2 text-[12.5px] leading-snug text-ink2">{info.blurb}</div>
      </div>
    </div>
  );
}

/** What a file's line says: the real upload's phase in the real office, the timed bar in the story. */
function fileStatus(f: UploadFile): string {
  if (f.phase === "failed") return f.message || t("studio.cinematic.cards.notUploaded", "Not uploaded");
  if (f.phase) return f.phase === "queued" ? t("studio.cinematic.cards.waiting", "Waiting…") : phaseText(f.phase);
  return f.progress >= 1 ? t("studio.cinematic.cards.read", "Read") : f.progress > 0.55 ? t("studio.cinematic.cards.reading", "Reading…") : t("studio.cinematic.cards.uploading", "Uploading…");
}

function FilesCard() {
  useT();
  const uploads = useJourney((s) => s.uploads);
  const reading = useJourney((s) => s.reading);
  const agent = useJourney((s) => s.agent.state);
  if (!uploads.length) return null;
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex gap-2">
        {uploads.map((f, i) => (
          <div key={f.name} style={{ animationDelay: `${i * 90}ms` }} className={cn(card, "relative min-w-[196px] max-w-[300px] overflow-hidden p-3")}>
            <div className="flex items-center gap-2">
              <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-lg", /xlsx|csv/i.test(f.name) ? "bg-success-soft text-success" : /pdf/i.test(f.name) ? "bg-danger-soft text-danger" : "bg-accent-soft text-accent")}>
                {/xlsx|csv/i.test(f.name) ? <FileSpreadsheet size={16} /> : <FileText size={16} />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium text-ink">{f.name}</div>
                <div className={cn("line-clamp-2 text-[11.5px]", f.phase === "failed" ? "text-danger" : "text-ink3")}>{fileStatus(f)}</div>
              </div>
              {f.progress >= 1 ? <Check size={15} className="shrink-0 text-success" /> : f.phase === "failed" ? <AlertCircle size={15} className="shrink-0 text-danger" /> : <span aria-hidden className="w-[15px] shrink-0" />}
            </div>
            <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-ink/10">
              <div className={cn("h-full origin-left rounded-full transition-transform duration-300", f.phase === "failed" ? "bg-danger" : "bg-gradient-to-r from-accent to-ai")} style={{ transform: `scaleX(${f.phase === "failed" ? 1 : f.progress})` }} />
            </div>
            {f.progress < 1 && f.phase !== "failed" && <div className="cine-shimmer pointer-events-none absolute inset-0" />}
          </div>
        ))}
      </div>
      {reading && <div role="status" className="cine-pill flex items-center gap-2 px-3 py-1 text-[12.5px] text-ink2"><Loader2 size={13} className="animate-spin text-ai" /> {t("studio.cinematic.cards.readingDocuments", "Reading your documents…")}</div>}
      {agent === "reading" && <div role="status" className="cine-pill flex items-center gap-2 px-3 py-1 text-[12.5px] text-ink2"><Loader2 size={13} className="animate-spin text-ai" /> {t("studio.cinematic.cards.agentReading", "Your business agent is reading…")}</div>}
      {agent === "read" && <div role="status" className="cine-pill flex items-center gap-2 px-3 py-1 text-[12.5px] text-ink2"><Check size={13} className="text-success" /> {t("studio.cinematic.cards.agentRead", "Read by your business agent")}</div>}
    </div>
  );
}

/** Where the code lives: MADP Factory keeps it (the default), or the visitor connects their own GitHub through the
 *  real /api/github routes. Nothing here pretends a connection: the account shown is the one GitHub reports. */
function CodeHomeCard() {
  useT();
  const answer = useJourney((s) => s.answer);
  const live = useJourney((s) => s.askId === "github");
  const setGithub = useJourney((s) => s.setGithub);
  const status = useGithubStatus();
  const connect = useConnectGithub();
  const [problem, setProblem] = useState<string | null>(null);
  const login = status.data?.connected ? status.data.login : null;
  const unavailable = status.isError;
  const busy = connect.isPending;

  // the engineer's monitor follows the real connection
  useEffect(() => { setGithub(busy ? "connecting" : login ? "connected" : "idle", login); }, [busy, login, setGithub]);

  const answerIfLive = (value: string) => { if (useJourney.getState().askId === "github") answer(value); };
  const useGithub = () => {
    if (!live || busy) return;
    if (login) { answerIfLive(`${GITHUB_ANSWER}${login}`); return; }
    setProblem(null);
    connect.mutate(undefined, {
      onSuccess: (c) => {
        if (c.connected && c.login) answerIfLive(`${GITHUB_ANSWER}${c.login}`);
        else setProblem(t("studio.cinematic.cards.githubNotConnected", "GitHub wasn't connected. Try again, or keep the code in MADP Factory."));
      },
      onError: () => setProblem(t("studio.cinematic.cards.githubUnavailable", "GitHub can't be connected right now. Keep the code in MADP Factory and connect GitHub later.")),
    });
  };

  return (
    <div className={cn(card, "w-[420px] p-4")}>
      <div className="text-[14.5px] font-semibold text-ink">{t("studio.cinematic.cards.codeHome", "Where your code lives")}</div>
      <div className="mt-3 flex flex-col gap-2">
        <button
          type="button"
          data-primary
          onClick={() => { if (live && !busy) answerIfLive("factory"); }}
          disabled={!live || busy}
          className="flex w-full items-center gap-3 rounded-xl bg-accent px-4 py-2.5 text-left text-white transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/30 disabled:opacity-90"
        >
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/15"><ShieldCheck size={18} aria-hidden /></span>
          <span className="min-w-0">
            <span className="block text-[14px] font-semibold">{t("studio.cinematic.cards.keepInFactory", "Keep it in MADP Factory")}</span>
            <span className="block text-[12px] text-white/80">{t("studio.cinematic.cards.recommended", "Recommended · nothing to set up")}</span>
          </span>
        </button>
        <button
          type="button"
          onClick={useGithub}
          disabled={!live || busy || unavailable}
          className="flex w-full items-center gap-3 rounded-xl bg-[#0d1117] px-4 py-2.5 text-left text-white transition hover:bg-[#1f2630] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/30 disabled:opacity-60"
        >
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/10">{busy ? <Loader2 size={16} className="animate-spin" /> : <GithubMark size={16} />}</span>
          <span className="min-w-0">
            <span className="block text-[14px] font-semibold">{busy ? t("studio.cinematic.cards.connecting", "Connecting securely…") : login ? t("studio.cinematic.script.useGithubAs", "Use GitHub as @{login}", { login }) : t("studio.cinematic.cards.connectGithub", "Connect GitHub (optional)")}</span>
            <span className="block text-[12px] text-white/70">{unavailable ? t("studio.cinematic.cards.githubLater", "Not available right now. You can connect it later.") : t("studio.cinematic.cards.newRepo", "A new private repository in your account")}</span>
          </span>
        </button>
      </div>
      {problem && <p role="alert" className="mt-2 text-[12.5px] text-ink2">{problem}</p>}
    </div>
  );
}

function SummaryCard() {
  useT();
  const a = useJourney((s) => s.answers);
  const real = useJourney((s) => s.mode === "real");
  const files = useJourney((s) => s.uploads.length);
  const filed = useJourney((s) => s.uploads.filter((u) => u.phase === "done").length);
  const rows: [string, string][] = real
    ? [
        [t("studio.cinematic.summary.project", "Project"), a.name],
        [t("studio.cinematic.summary.idea", "The idea"), a.about],
        [t("studio.cinematic.summary.for", "For"), a.audience],
        [t("studio.cinematic.summary.whatMatters", "What matters"), a.goal],
        [t("studio.cinematic.summary.material", "Material"), [
          a.website ? websiteLabel(a.website) : "",
          filed ? (filed === 1 ? t("studio.cinematic.summary.fileFiled", "1 file filed") : t("studio.cinematic.summary.filesFiled", "{count} files filed", { count: filed })) : "",
        ].filter(Boolean).join(" · ") || t("studio.cinematic.summary.noneYet", "None yet")],
      ]
    : [
        [t("studio.cinematic.summary.product", "Product"), a.name],
        [t("studio.cinematic.summary.idea", "The idea"), a.about],
        [t("studio.cinematic.summary.for", "For"), a.audience],
        [t("studio.cinematic.summary.goal", "Goal"), a.goal],
        [t("studio.cinematic.summary.material", "Material"), [
          a.website,
          files ? (files === 1 ? t("studio.cinematic.summary.documentRead", "1 document read") : t("studio.cinematic.summary.documentsRead", "{count} documents read", { count: files })) : "",
        ].filter(Boolean).join(" · ") || t("studio.cinematic.summary.noneYet", "None yet")],
      ];
  return (
    <div className={cn(card, "w-[560px] overflow-hidden")}>
      <div className="flex items-center gap-2 border-b border-ink/5 bg-gradient-to-r from-ai-soft to-accent-soft px-4 py-2.5">
        <GuideAvatar who="pm" size={22} />
        <span className="text-[13px] font-semibold text-ink">{real ? t("studio.cinematic.summary.toldUs", "What you told us") : t("studio.cinematic.summary.understood", "Here's what we understood")}</span>
      </div>
      <dl className="divide-y divide-ink/5 px-4">
        {rows.map(([k, v]) => (
          <div key={k} className="grid grid-cols-[86px_1fr] gap-3 py-2 text-[13px] leading-snug">
            <dt className="text-ink3">{k}</dt>
            <dd className="line-clamp-2 text-ink">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function RequirementsCard() {
  useT();
  const reqs = useJourney((s) => s.requirements);
  return (
    <div className="flex max-w-[980px] flex-wrap justify-center gap-2">
      {reqs.map((r) => (
        <div key={r.id} className={cn(card, "flex w-[300px] gap-2.5 p-3")}>
          <span className="mt-0.5 h-fit rounded-full bg-ai px-1.5 py-0.5 font-mono text-[10px] font-semibold text-white">{r.id}</span>
          <div className="text-[12.5px] leading-snug">
            <div className="font-semibold text-ink">{r.title}</div>
            <div className="text-ink2">{r.body}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function CardTray() {
  const kind = useJourney((s) => s.card);
  const walk = useJourney((s) => s.walk);
  if (!kind || walk) return null;
  return (
    <div className="pointer-events-auto flex justify-center">
      {kind === "website" && <WebsiteCard />}
      {kind === "files" && <FilesCard />}
      {kind === "github" && <CodeHomeCard />}
      {kind === "summary" && <SummaryCard />}
      {kind === "requirements" && <RequirementsCard />}
    </div>
  );
}
