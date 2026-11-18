/** The empty state of an environment that is not released yet, with "Promote to stage" once dev is released. */
import { ArrowUpRight, Server } from "lucide-react";
import { canRunChanges, FIRST_VERSION, versionLabel } from "@/madp/data/changes";
import { VIEWER_TIP } from "@/madp/data/rbac";
import { ViewOnlyNote } from "@/madp/components/workspace/ViewOnlyNote";
import { useWorkspaces } from "@/madp/state/workspaces";
import { Button, Card, EmptyState } from "@/madp/ui/kit";
import { useT } from "@/madp/i18n";

export function EnvNotReleased({ devVersion, canPromote, promoting, onPromote }: {
  devVersion: string | null; canPromote: boolean; promoting: boolean; onPromote: () => void;
}) {
  const t = useT();
  const role = useWorkspaces((s) => s.me?.role ?? "viewer");
  const mayRun = canRunChanges(role);
  const noteId = "env-not-released-note";
  return (
    <Card>
      <EmptyState
        icon={<Server size={22} strokeWidth={1.75} />}
        title={t("project.overview.stageNotReleased", "Stage is not released yet")}
        text={t("project.overview.devRuns", "Dev runs {version}. Promote it to stage when its approvals are complete; deployment waits for the MADP engine.", { version: versionLabel(devVersion ?? FIRST_VERSION) })}
        action={canPromote ? (
          <div className="flex flex-col items-center">
            <Button variant="primary" iconRight={<ArrowUpRight size={16} strokeWidth={1.75} aria-hidden />} onClick={onPromote}
              disabled={promoting || !mayRun} title={mayRun ? undefined : VIEWER_TIP} aria-describedby={mayRun ? undefined : noteId}>{t("project.overview.promote", "Promote to stage")}</Button>
            {!mayRun && <ViewOnlyNote id={noteId} text={VIEWER_TIP} />}
          </div>
        ) : undefined} />
    </Card>
  );
}
