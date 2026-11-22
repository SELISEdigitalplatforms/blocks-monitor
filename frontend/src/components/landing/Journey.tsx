/** 02 · How it works: the lifecycle, stage by stage: Business, Product sanitization, Requirements & objective, Scope
 *  confirmation, Board, Build, Release, each with a small scene drawn in code (theme colours only). You bring the
 *  business input and settle the product with your experts; MADP agents write the requirements, the objective and the
 *  specification, then build, verify and release (with a showcase report to share). Violet appears only where the
 *  factory writes something (objective, scope). */
import type { CSSProperties, ReactNode } from "react";
import {
  BookOpen, Check, ClipboardList, CodeXml, DoorOpen, Factory, FileText, FlaskConical, Image, Link2, Mail, MessageSquareText, Compass, Scale, Rocket, ScanEye,
  ShieldCheck, StickyNote, Upload,
} from "lucide-react";
import { STAGES } from "@/data/pipeline";
import type { StageId } from "@/data/types";
import { t, useT } from "@/i18n";
import { cn } from "@/lib/cn";
import { Container, Section, SectionHeader, rich, stageCode } from "./parts";
import { Reveal } from "./motion";

const v = (vars: Record<string, string | number>) => vars as CSSProperties;

/* ── 1 · business ──────────────────────────────────────────────────────────────── */
function BusinessVisual() {
  const t = useT();
  /* the left column is placed from the left, the right one from the right, each chip at most 46% wide: the two columns
     can never meet, at any card width */
  const files: { icon: typeof Mail; label: string; at: CSSProperties; r: number }[] = [
    { icon: Mail, label: t("landing.journey.fileEmail", "Email thread"), at: { left: "6%", top: 20 }, r: -7 },
    { icon: StickyNote, label: t("landing.journey.fileNotes", "Meeting notes"), at: { right: "8%", top: 12 }, r: 5 },
    { icon: FileText, label: t("landing.journey.fileBrief", "Brief.pdf"), at: { left: "12%", top: 66 }, r: 3 },
    { icon: Image, label: t("landing.journey.fileScreenshot", "Screenshot"), at: { right: "5%", top: 62 }, r: -4 },
  ];
  return (
    <>
      <div className="absolute inset-x-4 bottom-4 top-[52%] flex items-end justify-center rounded-[14px] border-2 border-dashed border-ink3/25 pb-3 text-[12px] font-medium text-ink3">
        <span className="flex items-center gap-1.5"><Upload size={13} strokeWidth={1.75} /> {t("landing.journey.attachFiles", "Attach files, any format")}</span>
      </div>
      {files.map(({ icon: Icon, label, at, r }, i) => (
        <div key={label} className="lp-drop absolute flex max-w-[46%] items-center gap-2 rounded-xl bg-surface px-3 py-2 text-[12px] font-medium text-ink shadow-float dark:border dark:border-line"
          style={{ ...at, ...v({ "--lp-r": `${r}deg`, "--lp-i": i }) }}>
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-surface2 text-ink2"><Icon size={13} strokeWidth={1.75} /></span>
          <span className="truncate">{label}</span>
        </div>
      ))}
    </>
  );
}

/* ── 2 · product sanitization ───────────────────────────────────────────────── */
function Sanitization() {
  const t = useT();
  const rows = [
    { icon: MessageSquareText, label: t("landing.journey.clarifications", "Clarifications"), w: "72%" },
    { icon: Scale, label: t("landing.journey.decisions", "Decisions"), w: "58%" },
    { icon: Compass, label: t("landing.journey.technicalDirection", "Technical direction"), w: "66%" },
  ];
  return (
    <div className="absolute inset-0 flex flex-col justify-center gap-2.5 p-4">
      {rows.map(({ icon: Icon, label, w }, i) => (
        <div key={label} className="lp-pop flex items-center gap-2 rounded-xl bg-surface px-3 py-2.5 text-[12px] font-medium text-ink shadow-card dark:border dark:border-line" style={v({ "--lp-i": i })}>
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-surface2 text-ink2"><Icon size={13} strokeWidth={1.75} /></span>
          <span className="shrink-0">{label}</span>
          <span className="ml-auto h-1.5 rounded-full bg-ink3/30" style={{ width: `calc(${w} - 90px)`, minWidth: 16 }} />
        </div>
      ))}
    </div>
  );
}

/* ── 3 · requirements & objective ───────────────────────────────────────────── */
function Requirements() {
  const t = useT();
  const points = [
    { text: t("landing.journey.reqRepeat", "Repeat the last order"), src: t("landing.journey.srcEmail", "Email") },
    { text: t("landing.journey.reqCutoff", "Order cut-off at 18:00"), src: t("landing.journey.srcOrderForm", "Order form") },
  ];
  return (
    <div className="absolute inset-0 flex flex-col gap-2 p-4">
      {points.map((p, i) => (
        <div key={p.text} className="lp-pop flex items-center justify-between gap-2 rounded-xl bg-surface px-3 py-2 text-[12px] shadow-card dark:border dark:border-line" style={v({ "--lp-i": i })}>
          <span className="min-w-0 font-medium leading-snug text-ink">{p.text}</span>
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent"><Link2 size={11} strokeWidth={2} />{p.src}</span>
        </div>
      ))}
      <div className="lp-pop mt-auto rounded-xl bg-ai-soft px-3 py-2.5" style={v({ "--lp-i": 2 })}>
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-[11px] font-medium text-ai"><Factory size={12} strokeWidth={1.75} /> {t("landing.journey.writtenByFactory", "Written by the factory")}</span>
          <span className="lp-pop flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-[11px] font-medium text-white" style={v({ "--lp-i": 4 })}>
            <Check size={11} strokeWidth={2} /> {t("landing.journey.confirmed", "Confirmed")}
          </span>
        </div>
        <div className="mt-1.5 truncate text-[13px] font-medium leading-snug text-ink">{t("landing.journey.objective", "Customers place and track orders online")}</div>
      </div>
    </div>
  );
}

/* ── 4 · scope confirmation ──────────────────────────────────────────────────────────────── */
function Scope() {
  const t = useT();
  const rows: { w: string; tag: "must" | "nice" | "later"; tone: string }[] = [
    { w: "78%", tag: "must", tone: "bg-ink text-canvas" },
    { w: "64%", tag: "must", tone: "bg-ink text-canvas" },
    { w: "70%", tag: "nice", tone: "bg-surface2 text-ink2 ring-1 ring-inset ring-line" },
    { w: "52%", tag: "later", tone: "text-ink3" },
  ];
  const tagText = { must: t("landing.journey.tagMust", "Must"), nice: t("landing.journey.tagNice", "Nice"), later: t("landing.journey.tagLater", "Later") };
  return (
    <div className="absolute inset-0 grid grid-cols-[1fr_1.05fr] gap-3 p-4">
      <div className="lp-pop flex flex-col rounded-xl bg-surface p-3 shadow-card dark:border dark:border-line" style={v({ "--lp-i": 0 })}>
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-medium uppercase tracking-wider text-ink3">{t("landing.journey.specification", "Specification")}</span>
          <Factory size={12} strokeWidth={1.75} className="text-ai" aria-label={t("landing.journey.writtenByFactory", "Written by the factory")} />
        </div>
        <div className="mt-2 h-1.5 w-[86%] rounded-full bg-ink/80" />
        <div className="mt-3 space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="h-1.5 rounded-full bg-ink3/30" style={{ width: r.w }} />
              <span className={cn("ml-auto flex shrink-0 items-center gap-1 rounded-full px-1.5 py-px text-[10px] font-medium", r.tone)}>
                {r.tag === "later" && <span className="hatched h-2 w-2 rounded-sm ring-1 ring-inset ring-line" />}
                {tagText[r.tag]}
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="lp-pop flex flex-col overflow-hidden rounded-xl bg-surface p-2 text-ink shadow-card ring-1 ring-line" style={v({ "--lp-i": 1 })}>
        <div className="flex items-center gap-1 px-1 pb-2">
          <span className="h-1.5 w-1.5 rounded-full bg-ink/20" /><span className="h-1.5 w-1.5 rounded-full bg-ink/20" /><span className="h-1.5 w-1.5 rounded-full bg-ink/20" />
          <span className="ml-2 text-[10px] text-ink3">{t("landing.journey.screenPreview", "Screen preview")}</span>
        </div>
        <div className="grid flex-1 grid-cols-[26%_1fr] gap-1.5">
          <div className="space-y-1 rounded-md bg-ink/[0.05] p-1.5">
            <div className="h-1.5 rounded bg-ink/40" /><div className="h-1.5 w-3/4 rounded bg-ink/15" /><div className="h-1.5 w-2/3 rounded bg-ink/15" />
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="grid grid-cols-2 gap-1.5">
              <div className="h-9 rounded-md bg-ink/[0.07]" /><div className="h-9 rounded-md bg-ink/[0.07]" />
            </div>
            <div className="flex-1 rounded-md bg-ink/[0.05]" />
            <div className="ml-auto h-3.5 w-12 rounded-full bg-accent" />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── 5 · board ─────────────────────────────────────────────────────────────── */
function BoardVisual() {
  const t = useT();
  const cols = [
    { name: t("landing.journey.colTodo", "To do"), cards: [70, 56] },
    { name: t("landing.journey.colInProgress", "In progress"), cards: [64] },
    { name: t("landing.journey.colDone", "Done"), cards: [60, 74] },
  ];
  return (
    <div className="absolute inset-0 grid grid-cols-3 gap-2 p-4">
      {cols.map((c, ci) => (
        <div key={c.name} className="flex min-w-0 flex-col gap-1.5 rounded-xl bg-ink/[0.05] p-1.5">
          <span className="truncate px-0.5 text-[10px] font-medium uppercase tracking-wider text-ink3">{c.name}</span>
          {c.cards.map((w, i) => (
            <div key={i} className="lp-pop rounded-md bg-surface p-1.5 shadow-card dark:border dark:border-line" style={v({ "--lp-i": ci + i })}>
              <div className="h-1.5 rounded-full bg-ink3/30" style={{ width: `${w}%` }} />
              {ci === 2 && <span className="mt-1.5 flex items-center gap-1 text-[10px] font-medium text-success"><Check size={10} strokeWidth={2} />{t("landing.journey.proof", "Proof")}</span>}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/* ── 6 · build, verified on its own ─────────────────────────────────────────── */
const STAGE_ICON: Record<StageId, typeof Check> = {
  "01": ClipboardList, "02": CodeXml, "03": ScanEye, "04": FlaskConical, "05": ShieldCheck, "06": BookOpen, "07": DoorOpen, deploy: Rocket,
};

function BuiltLive() {
  const t = useT();
  return (
    <div className="absolute inset-0 flex flex-col justify-center gap-3 px-4">
      <div className="lp-wave grid grid-cols-8 gap-1.5" aria-hidden>
        {STAGES.map((s, i) => {
          const Icon = STAGE_ICON[s.id];
          return (
            <span key={s.id} className="grid aspect-square place-items-center rounded-full bg-surface2 text-ink3" style={v({ "--lp-i": i })}>
              <Icon size={14} strokeWidth={1.75} />
            </span>
          );
        })}
      </div>
      {/* centred under each disc; "Blocks" may reach past its narrow column into the gaps */}
      <div className="grid grid-cols-8 gap-1.5 font-mono text-[10px] uppercase tracking-wide text-ink3" aria-hidden>
        {STAGES.map((s) => <span key={s.id} className="flex justify-center whitespace-nowrap">{stageCode(s)}</span>)}
      </div>
      <div className="mt-2 flex items-center gap-2 rounded-xl bg-surface px-3 py-2 text-[12px] text-ink2 shadow-card dark:border dark:border-line">
        <span className="relative grid h-2 w-2 place-items-center"><span className="lp-ping absolute h-2 w-2 rounded-full bg-accent" /><span className="relative h-2 w-2 rounded-full bg-accent" /></span>
        {t("landing.journey.failedChecks", "Failed checks are fixed and re-verified")}
      </div>
    </div>
  );
}

/* ── 7 · release ────────────────────────────────────────────────────────────── */
function Released() {
  const t = useT();
  return (
    <div className="absolute inset-0 p-4">
      <div className="absolute inset-x-4 top-4 bottom-12 overflow-hidden rounded-xl bg-surface shadow-card dark:border dark:border-line">
        <div className="flex items-center gap-2 border-b border-line px-3 py-2">
          <span className="flex gap-1"><span className="h-1.5 w-1.5 rounded-full bg-ink3/40" /><span className="h-1.5 w-1.5 rounded-full bg-ink3/40" /><span className="h-1.5 w-1.5 rounded-full bg-ink3/40" /></span>
          <span className="flex items-center gap-1.5 rounded-full bg-success-soft px-2 py-0.5 text-[10px] font-medium text-success">
            <span className="h-1.5 w-1.5 rounded-full bg-landing-pass" /> {t("landing.journey.liveOnBlocks", "Live on SELISE Blocks")}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-1.5 p-3">
          <div className="col-span-2 h-12 rounded-md bg-surface2" /><div className="h-12 rounded-md bg-accent-soft" />
          <div className="h-6 rounded-md bg-surface2" /><div className="h-6 rounded-md bg-surface2" /><div className="h-6 rounded-md bg-surface2" />
        </div>
      </div>
      <div className="lp-pop absolute bottom-3 right-3 w-[48%] rounded-xl bg-surface p-3 text-ink shadow-float ring-1 ring-line" style={v({ "--lp-i": 0 })}>
        <div className="text-[10px] font-medium uppercase tracking-wider text-ink3">{t("landing.journey.showcaseReport", "Showcase report")}</div>
        <div className="mt-2 flex h-9 items-end gap-1">
          {[40, 62, 48, 80, 58, 92].map((h, i) => <span key={i} className={cn("flex-1 rounded-sm", i === 5 ? "bg-accent" : "bg-bar/70")} style={{ height: `${h}%` }} />)}
        </div>
      </div>
      <div className="absolute bottom-3 left-4">
        <span className="lp-pop flex items-center gap-1 rounded-full bg-surface px-2 py-1 text-[11px] font-medium text-ink shadow-card dark:border dark:border-line" style={v({ "--lp-i": 1 })}>
          <Check size={11} strokeWidth={2} className="text-success" />{t("landing.journey.everyCheckPassed", "Every check passed")}
        </span>
      </div>
    </div>
  );
}

/* ── the chapter ────────────────────────────────────────────────────────────── */

/** who does the stage's work: you (the business input, the product sanitization with your experts) or MADP agents, which
 *  write the requirements, the objective and the specification (you answer what is missing, confirm, and start the
 *  build in a click), then build and release */
const steps = (): { title: string; text: ReactNode; visual: ReactNode; factory?: boolean }[] => [
  { title: t("landing.journey.step1Title", "Project setup"), text: t("landing.journey.step1Text", "Bring everything from the client: meetings, presentations, ideas and files. Nothing to install."), visual: <BusinessVisual /> },
  { title: t("landing.journey.step2Title", "Understanding your project"), text: t("landing.journey.step2Text", "Clarify, decide and set the technical direction with your tech lead and experts. Out comes requirements v1."), visual: <Sanitization /> },
  { title: t("landing.journey.step3Title", "Goals & requirements"), text: t("landing.journey.step3Text", "Every requirement is traced to its source and checked, with one measurable objective. Confirm it in a click."), visual: <Requirements />, factory: true },
  { title: t("landing.journey.step4Title", "Scope & success"), text: t("landing.journey.step4Text", "Features, user stories, screens, plan and estimate, ready to build. One click starts it."), visual: <Scope />, factory: true },
  { title: t("landing.journey.step5Title", "Board"), text: t("landing.journey.step5Text", "MADP agents manage the board: every ticket moves with its proof."), visual: <BoardVisual />, factory: true },
  { title: t("landing.journey.step6Title", "Build"), text: t("landing.journey.step6Text", "MADP agents plan, code, review, test, secure and document it. A failed check goes back, is fixed and re-verified."), visual: <BuiltLive />, factory: true },
  { title: t("landing.journey.step7Title", "Release"), text: t("landing.journey.step7Text", "Released to dev on SELISE Blocks, smoke-tested, then promoted to stage. With a showcase report to share with stakeholders."), visual: <Released />, factory: true },
];

export function Journey() {
  const t = useT();
  return (
    <Section id="how">
      <Container>
        <SectionHeader id="how" n="02" eyebrow={t("landing.nav.how", "How it works")}
          title={rich(t("landing.journey.title", "Brief in. {dim}"), { dim: <span className="lp-dim text-ink3">{t("landing.journey.titleDim", "Live app out.")}</span> })}
          lede={t("landing.journey.lede", "Write the brief. The factory takes it from requirements to release, and verifies every stage. Ship verified software in days, not months.")} />

        <ol className="mt-16 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {steps().map((s, i) => (
            <Reveal as="li" key={s.title} delay={(i % 3) * 110}
              className="lp-card flex flex-col rounded-card bg-surface p-2.5 shadow-card dark:border dark:border-line">
              <div aria-hidden className="lp-well relative h-[212px] overflow-hidden rounded-block bg-surface2">{s.visual}</div>
              <div className="flex flex-1 flex-col px-4 pb-4 pt-5">
                <div className="flex items-center gap-3">
                  <span className="num grid h-7 min-w-7 place-items-center rounded-full bg-accent-soft px-2 font-mono text-[11px] font-medium text-accent">{String(i + 1).padStart(2, "0")}</span>
                  <h3 className="min-w-0 text-[18px] font-medium leading-tight tracking-tight [text-wrap:balance]">{s.title}</h3>
                  <span className={cn("ml-auto shrink-0 rounded-full px-2.5 py-0.5 text-[12px] font-medium",
                    s.factory ? "bg-accent-soft text-accent" : "text-ink2 ring-1 ring-inset ring-line")}>
                    {s.factory ? t("landing.journey.byFactory", "Factory") : t("landing.journey.byYou", "You")}
                  </span>
                </div>
                <p className="mt-2.5 text-[15px] leading-relaxed text-ink2 [text-wrap:pretty]">{s.text}</p>
              </div>
            </Reveal>
          ))}
        </ol>
      </Container>
    </Section>
  );
}
