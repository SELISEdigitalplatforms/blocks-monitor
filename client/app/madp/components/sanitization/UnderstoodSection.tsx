/** "What we understood": the business analyst's picture of the project in 3–4 plain lines, from the brief and the setup
 *  answers (goal, users, must-haves or what should change). Once the first requirements exist, their objective leads
 *  as the business analyst's own sentence. Read only. */
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Lightbulb, PencilLine } from "lucide-react";
import { blocksAllOptions } from "@/madp/blocks/data/hooks";
import { whereOf } from "@/madp/blocks/data/gql";
import type { ProjectRow } from "@/madp/blocks/sanitization/types";
import { detailsFromRow } from "@/madp/domain/setupDetails";
import { Card } from "@/madp/ui/kit";
import { briefAbout, understoodLines } from "./understandingModel";
import { useT } from "@/madp/i18n";

/** The setup answers, read on their own (the shared Project item read keeps its own field list). */
interface SetupRow {
  ItemId: string; Brief?: string | null; Goal?: string | null; TargetUsers?: string | null; AppUrl?: string | null; TestEnv?: string | null;
  SetupMustHaves?: string | null; SetupWorkflows?: string | null; SetupExclusions?: string | null; SetupConstraints?: string | null;
  IntendedChanges?: string | null; IntendedChangeTags?: string | null; ApprovalOwnerUserId?: string | null;
}
const SETUP_ROW_FIELDS = [
  "ItemId", "Brief", "Goal", "TargetUsers", "AppUrl", "TestEnv", "SetupMustHaves", "SetupWorkflows", "SetupExclusions", "SetupConstraints",
  "IntendedChanges", "IntendedChangeTags", "ApprovalOwnerUserId",
] as const;
interface NoteRow { ItemId: string; Title?: string | null; BodyMd?: string | null; IsProjectBrief?: boolean | null; IsScratchPad?: boolean | null }

/** The setup answers and the project in the client's words (also read by the questions' suggested answers; the same
 *  queries, so no second read). */
export function useSetup(workspaceId: string, projectId: string): { row: SetupRow | null; brief: string } {
  const pw = whereOf<SetupRow>();
  const project = useQuery({
    ...blocksAllOptions<SetupRow>("Project", { workspaceId, fields: [...SETUP_ROW_FIELDS], where: pw.eq("ItemId", projectId), maxItems: 1 }),
    enabled: Boolean(workspaceId && projectId),
  });
  const nw = whereOf<NoteRow>();
  const notes = useQuery({
    ...blocksAllOptions<NoteRow>("DocNote", {
      workspaceId, fields: ["ItemId", "Title", "BodyMd", "IsProjectBrief", "IsScratchPad"],
      where: nw.and(nw.eq("ProjectId" as never, projectId as never), nw.eq("Title", "Project brief")), maxItems: 5,
    }),
    enabled: Boolean(workspaceId && projectId),
  });
  const row = project.data?.[0] ?? null;
  const own = (row?.Brief ?? "").trim();
  const note = (notes.data ?? []).find((n) => n.IsProjectBrief) ?? (notes.data ?? []).find((n) => !n.IsScratchPad);
  return { row, brief: own || (note?.BodyMd ? briefAbout(note.BodyMd) : "") };
}

export function UnderstoodSection({ workspaceId, projectId, project, objective, canEdit }: {
  workspaceId: string; projectId: string; project: ProjectRow; objective: string | null; canEdit: boolean;
}) {
  const t = useT();
  const { row, brief } = useSetup(workspaceId, projectId);
  const setup: SetupRow = row ?? { ItemId: projectId };
  const existing = project.RepoMode === "existing";
  const d = detailsFromRow(setup as unknown as Record<string, unknown>);
  const lines = understoodLines({
    existing, objective, brief, goal: setup.Goal ?? "", users: setup.TargetUsers ?? "", mustHaves: d.mustHaves,
    changes: [...d.changeTags, d.intendedChanges.trim()].filter(Boolean),
  });

  return (
    <Card title={t("settings.sanitization.understood.title", "What we understood")} icon={<Lightbulb size={18} strokeWidth={1.75} />}
      action={canEdit && project.Stage === "sanitization" ? (
        <Link to={`/p/${projectId}/business`} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium text-ink2 outline-none transition hover:bg-surface2 hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/50">
          <PencilLine size={14} aria-hidden />{t("settings.sanitization.understood.addMaterial", "Something's off? Add to your material")}
        </Link>
      ) : undefined}>
      {lines.length === 0 ? (
        <p className="text-[14px] text-ink2">{t("settings.sanitization.understood.empty", "The business analyst writes this down while reading your material.")}</p>
      ) : (
        <dl className="flex flex-col gap-2.5">
          {lines.map((l) => (
            <div key={l.label} className="grid min-w-0 gap-0.5 sm:grid-cols-[150px_minmax(0,1fr)] sm:gap-4">
              <dt className="text-[13px] font-medium text-ink3">{l.label}</dt>
              <dd className="min-w-0 break-words text-[15px] leading-snug text-ink">{l.text}</dd>
            </div>
          ))}
        </dl>
      )}
    </Card>
  );
}
