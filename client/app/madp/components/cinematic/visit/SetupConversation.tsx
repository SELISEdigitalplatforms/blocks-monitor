/** Project Setup with the MADP Assistant at reception: the guided start's questions until the project exists, then the
 *  Project setup page's Material and "Start project analysis", each as a turn of the conversation (setupTalk.ts) on the
 *  app's own ops (useSetupOps). The checklist the step list shows is the setup page's own (useSetupChecklist), so the
 *  office and the page always agree. What the step has to show besides the words (the files being filed) is a small
 *  line just above the choices. */
import { useEffect, useRef } from "react";
import { useT } from "@/madp/i18n";
import { useCan } from "@/madp/blocks/projects/context";
import { useGithubStatus } from "@/madp/blocks/github";
import type { ProjectRecord } from "@/madp/blocks/projects/records";
import type { DocTreeData } from "@/madp/blocks/projects/docReads";
import { useSetupChecklist } from "@/madp/components/business/SetupChecklistCard";
import { handOverState } from "@/madp/components/business/businessUi";
import { codeHomeDone } from "@/madp/components/business/setupChips";
import { cn } from "@/madp/lib/cn";
import { useChat } from "./chat";
import { pickFiles } from "./OfficeInput";
import { setupAskOf, setupStates, SETUP_ITEMS, type SetupAsk } from "./flow";
import { answerSetup, setupPrompt, type SetupDeps } from "./setupTalk";
import { useSetupOps } from "./useSetupOps";
import { useVisit, type UploadRow } from "./store";

export function SetupConversation({ project, tree, visitor, resumed }: { project: ProjectRecord | null; tree: DocTreeData | undefined; visitor: string; resumed: boolean }) {
  return project ? <AfterCreate project={project} tree={tree} visitor={visitor} resumed={resumed} />
    : <Talk ask={setupAskOf(useVisit.getState().draft, null) ?? "kind"} project={null} tree={tree} visitor={visitor} resumed={false} shared={0} codeDone={false} blocked={null} />;
}

/** The project exists: Material and the hand-over, with the setup page's own checklist and hand-over rules. */
function AfterCreate({ project, tree, visitor, resumed }: { project: ProjectRecord; tree: DocTreeData | undefined; visitor: string; resumed: boolean }) {
  const { facts, values } = useSetupChecklist(project, tree);
  const materialPassed = useVisit((s) => s.materialPassed);
  const canEdit = useCan("business.edit");
  const ask = setupAskOf(useVisit.getState().draft, project, facts.sharedCount, materialPassed);
  const state = handOverState({
    project,
    counts: { notes: tree ? tree.counts.notes : 0, readyFiles: tree ? tree.counts.readyFiles : 0 },
    hasScratch: Boolean(tree?.scratch),
    canEdit,
    newCount: 0,
    handedOverByName: null,
  });
  if (!ask) return null;
  return <Talk ask={ask} project={project} tree={tree} visitor={visitor} resumed={resumed} shared={facts.sharedCount}
    codeDone={codeHomeDone(values.code)} blocked={state.mode === "before" ? state.reason : null} />;
}

function Talk({ ask: given, project, tree, visitor, resumed, shared, codeDone, blocked }: {
  ask: SetupAsk; project: ProjectRecord | null; tree: DocTreeData | undefined; visitor: string; resumed: boolean;
  shared: number; codeDone: boolean; blocked: string | null;
}) {
  const t = useT();
  const draft = useVisit((s) => s.draft);
  const uploads = useVisit((s) => s.uploads);
  // the draft re-renders this component; the ask follows it
  const ask = project ? given : setupAskOf(draft, null) ?? given;
  const ops = useSetupOps(tree);
  const github = useGithubStatus();
  const login = github.data?.connected ? github.data.login ?? null : null;
  const prompt = setupPrompt(ask, {
    draft, visitor, projectName: project?.name ?? "", handOverBlocked: blocked, resumed, githubLogin: login,
    existing: project ? project.type === "brownfield" : draft.answers.kind === "existing",
  });

  const deps = useRef<SetupDeps | null>(null);
  deps.current = {
    ops: { ...ops, pickFiles },
    githubLogin: login,
    chat: { say: useChat.getState().say, you: useChat.getState().you, whileBusy: useChat.getState().whileBusy },
    visit: {
      get: () => useVisit.getState(),
      setDraft: useVisit.getState().setDraft,
      setProject: useVisit.getState().setProject,
      setCreateRequest: useVisit.getState().setCreateRequest,
      passMaterial: useVisit.getState().passMaterial,
      setUploads: useVisit.getState().setUploads,
      openWhere: useVisit.getState().openWhere,
    },
  };

  // the step list: Project setup's checklist
  const setIndicator = useVisit((s) => s.setIndicator);
  const states = setupStates({ ask, created: Boolean(project), codeDone, shared, handedOver: Boolean(project?.handedOverAt) });
  const indicatorKey = JSON.stringify(states);
  useEffect(() => {
    setIndicator({ phase: "setup", items: SETUP_ITEMS.map((id) => ({ id, state: states[id] })), next: null });
  }, [indicatorKey, setIndicator]); // eslint-disable-line react-hooks/exhaustive-deps

  // each time a step comes up: its lines once, and the input for its answer
  const seen = useRef<{ ask: SetupAsk | null; n: number }>({ ask: null, n: 0 });
  if (seen.current.ask !== ask) seen.current = { ask, n: seen.current.n + 1 };
  const turn = `${prompt.key}#${seen.current.n}`;
  const replies = JSON.stringify(prompt.composer.replies ?? []);
  useEffect(() => {
    const chat = useChat.getState();
    prompt.lines.forEach((line, i) => void chat.say("assistant", line, { key: `${turn}:${i}` }));
    const run = (input: { text?: string; reply?: string; files?: File[] }) => { if (deps.current) void answerSetup(ask, input, prompt, deps.current); };
    chat.setComposer({
      ...prompt.composer,
      onSend: (text) => run({ text }),
      onReply: (id) => run({ reply: id }),
      onFiles: prompt.files ? (files) => run({ files }) : undefined,
    });
  }, [turn, replies]); // eslint-disable-line react-hooks/exhaustive-deps
  // Project setup ends (the hand-over): its answers go with it
  useEffect(() => () => useChat.getState().setComposer(null), []);

  if ((ask === "material" || ask === "handOver") && uploads.length > 0) return <UploadsLine rows={uploads} title={t("studio.office.visit.setup.filesTitle", "Client documents")} />;
  return null;
}

/** The files given at reception, each with how far its upload is (the pipeline's real steps). */
function UploadsLine({ rows, title }: { rows: UploadRow[]; title: string }) {
  const t = useT();
  const text = (r: UploadRow) => r.phase === "done" ? t("studio.office.visit.setup.filed", "Filed")
    : r.phase === "failed" ? r.message ?? t("studio.office.visit.setup.notUploaded", "Not uploaded")
    : r.phase === "queued" ? t("studio.office.visit.setup.waiting", "Waiting…")
    : t("studio.office.visit.setup.uploading", "Uploading…");
  return (
    <div className="visit-desk visit-in pointer-events-auto flex w-full max-w-[520px] flex-col gap-1">
      <p className="text-[12px] font-medium text-ink3">{title}</p>
      <ul className="flex flex-col gap-1">
        {rows.map((r, i) => (
          <li key={`${r.name}:${i}`} className="flex items-center gap-3 text-[13px]">
            <span className="min-w-0 flex-1 break-words text-ink">{r.name}</span>
            <span className={cn("shrink-0", r.phase === "done" ? "text-success" : r.phase === "failed" ? "text-danger" : "text-ink3")}>{text(r)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The labels of Project Setup's checklist, as the setup page shows them. */
export function useSetupItemLabels(): Record<(typeof SETUP_ITEMS)[number], string> {
  const t = useT();
  return {
    about: t("studio.office.visit.items.about", "About"),
    where: t("studio.office.visit.items.code", "Code"),
    share: t("studio.office.visit.items.material", "Material"),
    handOver: t("studio.office.visit.items.handOver", "Start project analysis"),
  };
}
