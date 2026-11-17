/** The two windows the office opens over the room, each the app's own screen:
 *  - "Where it lives": the New project dialog's own step (WhereNewStep: MADP Factory or GitHub, connected for real;
 *    WhereExistingStep for a product that is live), checked with the dialog's own rules;
 *  - "The analysis": the Business Analysis page's own parts (their summaries and their content, with comments and
 *    edits), opened at the part the conversation points at. */
import { useEffect, useId, useState } from "react";
import { useT } from "@/i18n";
import { useGithubStatus } from "@/blocks/github";
import { codeHomeOf, suggestedRepoName, validateStep, type StartAnswers } from "@/domain/guidedStart";
import { stepIndex } from "@/domain/journey";
import { WhereExistingStep, WhereNewStep } from "@/components/guided/GuidedSteps";
import { BRIEF_PART_VIEWS } from "@/components/analysis-next/parts/brief";
import { SCOPE_PART_VIEWS } from "@/components/analysis-next/parts/scope";
import { DOC_PARTS, DOC_PART_LABEL, PART_STATUS_LABEL, type AnalysisCtx, type DocPart, type PartSummary } from "@/components/analysis-next/model";
import { ScopeFeedbackProvider } from "@/components/scope/blocks/ScopeFeedback";
import { RequirementsStep } from "@/components/analysis-next/analyst/RequirementsStep";
import { ScopeStep } from "@/components/analysis-next/analyst/ScopeStep";
import { Button, Drawer, Modal } from "@/ui/kit";
import { cn } from "@/lib/cn";
import { ChevronDown } from "lucide-react";
import { useChat } from "./chat";
import { useVisit } from "./store";

/* ── where the code lives ────────────────────────────────────────────────── */

/** What the choice reads as in the conversation. */
function whereText(a: StartAnswers, login: string | null, t: ReturnType<typeof useT>): string {
  if (a.kind === "existing") return a.appUrl.trim() ? t("studio.office.visit.where.liveAt", "It runs at {url}", { url: a.appUrl.trim() }) : t("studio.office.visit.where.detailsGiven", "Here are the details");
  const home = codeHomeOf(a);
  if (home === "factory") return t("studio.office.visit.setup.whereFactory", "Keep it in MADP Factory");
  if (home === "create") return t("studio.office.visit.setup.newRepo", "A new private repository: {repo}", { repo: `${login ?? "GitHub"}/${suggestedRepoName(a)}` });
  return a.repo ? t("studio.office.visit.where.useRepo", "Use {repo}", { repo: `${a.repo.owner}/${a.repo.name}` }) : "";
}

export function WhereSheet() {
  const t = useT();
  const open = useVisit((s) => s.whereOpen);
  const a = useVisit((s) => s.draft.answers);
  const setDraft = useVisit((s) => s.setDraft);
  const openWhere = useVisit((s) => s.openWhere);
  const github = useGithubStatus();
  const login = github.data?.connected ? github.data.login ?? null : null;
  const [shown, setShown] = useState(false);
  const headingId = useId();

  // "Connect GitHub" opens on the GitHub side of the choice
  useEffect(() => {
    if (!open) { setShown(false); return; }
    const d = useVisit.getState().draft.answers;
    if (d.kind === "new" && codeHomeOf(d) === "factory") setDraft({ repoChoice: "create" });
  }, [open, setDraft]);

  const errors = shown ? validateStep("where", a, login) : {};
  const close = () => openWhere(false);
  const use = () => {
    if (Object.keys(validateStep("where", a, login)).length) { setShown(true); return; }
    setDraft({}, { whereDone: true });
    close();
    const chat = useChat.getState();
    chat.you(whereText(a, login, t));
    void chat.say("assistant", a.kind === "existing"
      ? t("studio.office.visit.where.thanksLive", "Thank you, that helps your team find the product.")
      : codeHomeOf(a) === "factory" ? t("studio.office.visit.setup.factoryOk", "Done. MADP Factory keeps the code safe, and you can connect GitHub any time later.")
      : t("studio.office.visit.where.githubOk", "Noted. The repository is set up with the project."));
  };

  return (
    <Modal open={open} onClose={close} width={880} title={t("studio.office.visit.where.title", "Where it lives")}
      footer={<>
        <Button variant="ghost" onClick={close}>{t("studio.office.visit.where.cancel", "Cancel")}</Button>
        <Button variant="primary" onClick={use}>{t("studio.office.visit.where.use", "Use this")}</Button>
      </>}>
      {a.kind === "existing"
        ? <WhereExistingStep a={a} set={(p) => setDraft(p)} errors={errors} headingId={headingId} />
        : <WhereNewStep a={a} set={(p) => setDraft(p)} errors={errors} headingId={headingId} />}
    </Modal>
  );
}

/* ── the analysis ────────────────────────────────────────────────────────── */

const VIEWS = { ...BRIEF_PART_VIEWS, ...SCOPE_PART_VIEWS } as unknown as Record<DocPart, { useSummary: (ctx: AnalysisCtx) => PartSummary; Detail: React.ComponentType<AnalysisCtx> }>;

export function AnalysisSheet({ ctx }: { ctx: AnalysisCtx | null }) {
  const t = useT();
  const part = useVisit((s) => s.sheet);
  const action = useVisit((s) => s.sheetAction);
  const openSheet = useVisit((s) => s.openSheet);
  if (!ctx) return null;
  const locked = !!ctx.step && stepIndex(ctx.step) >= stepIndex("board");
  const onPart = (p: DocPart) => openSheet(p, action);
  return (
    <Drawer open={part !== null} onClose={() => openSheet(null)} width={760}
      title={action === "requirements" ? t("studio.office.visit.sheet.approve", "Approve the requirements") : action === "scope" ? t("studio.office.visit.sheet.lock", "Agree and lock the scope") : t("studio.office.visit.sheet.title", "The analysis")}>
      {part && (
        <ScopeFeedbackProvider locked={locked}>
          {/* the page's own approve card / lock card: the same blockers, checklist, dialog and ops */}
          {action === "requirements" && <div className="mb-5 rounded-card p-4 ring-1 ring-line"><RequirementsStep projectId={ctx.projectId} workspaceId={ctx.workspaceId} onPart={onPart} /></div>}
          {action === "scope" && <div className="mb-5"><ScopeStep projectId={ctx.projectId} onPart={onPart} /></div>}
          <Parts ctx={ctx} at={part} />
        </ScopeFeedbackProvider>
      )}
    </Drawer>
  );
}

function Parts({ ctx, at }: { ctx: AnalysisCtx; at: DocPart }) {
  // every part's summary, in the page's fixed order (the hooks always run the same way)
  const parts = DOC_PARTS.map((p) => VIEWS[p].useSummary(ctx));
  const [open, setOpen] = useState<Set<DocPart>>(() => new Set([at]));
  useEffect(() => {
    setOpen((s) => new Set([...s, at]));
    const id = window.setTimeout(() => document.getElementById(`office-part-${at}`)?.scrollIntoView({ block: "start", behavior: "smooth" }), 80);
    return () => window.clearTimeout(id);
  }, [at]);
  const toggle = (p: DocPart) => setOpen((s) => { const n = new Set(s); if (n.has(p)) n.delete(p); else n.add(p); return n; });
  return (
    <div className="flex flex-col gap-3">
      {DOC_PARTS.map((p, i) => {
        const Detail = VIEWS[p].Detail;
        const s = parts[i];
        const on = open.has(p);
        return (
          <article key={p} id={`office-part-${p}`} className="scroll-mt-4 rounded-card ring-1 ring-line">
            <button type="button" aria-expanded={on} onClick={() => toggle(p)}
              className="flex w-full min-w-0 items-start gap-3 rounded-card px-4 py-3.5 text-left outline-none transition-colors hover:bg-surface2/60 focus-visible:ring-2 focus-visible:ring-accent/50">
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-[15px] font-semibold text-ink"><span className="num text-ink3">{i + 1}.</span> {DOC_PART_LABEL[p]}</span>
                  {!s.loading && <span className="rounded-full bg-surface2 px-2 py-0.5 text-[11px] font-medium text-ink2">{PART_STATUS_LABEL[s.status]}</span>}
                </span>
                <span className={cn("text-[13px] leading-5 text-ink2", !on && "line-clamp-2")}>{s.loading ? "…" : s.summary}</span>
              </span>
              <ChevronDown aria-hidden size={18} className={cn("mt-1 shrink-0 text-ink3 transition-transform", on && "rotate-180")} />
            </button>
            {on && <div className="min-w-0 border-t border-line px-4 py-4"><Detail {...ctx} /></div>}
          </article>
        );
      })}
    </div>
  );
}
