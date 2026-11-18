import { useEffect, useState } from "react";
import { t, useT } from "@/madp/i18n";
import { useQueries, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { Navigate, Outlet, useLocation, useParams } from "react-router-dom";
import { useBlocksContext } from "@/madp/blocks/context";
import { blocksItemOptions } from "@/madp/blocks/data/hooks";
import { blocksKeys } from "@/madp/blocks/data/keys";
import { switchWorkspace } from "@/madp/blocks/workspaces/sync";
import { useProject } from "@/madp/blocks/projects/reads";
import { isBlocksProjectId } from "@/madp/domain/projects";
import { JOURNEY_SLUG } from "@/madp/domain/journey";
import { stepPath } from "@/madp/domain/phases";
import { preloadStepChunk, prefetchProjectStep, stepSlugOf } from "@/madp/components/project/stepPrefetch";
import { ProjectNav } from "@/madp/components/project/ProjectNav";
import { TeamLauncher } from "@/madp/components/team";
import { Banner, Button } from "@/madp/ui/kit";

function Skeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-6">
      <div className="h-9 w-72 rounded-full bg-ink/[0.06]" />
      <div className="hatched h-64 rounded-card bg-surface/60" />
    </div>
  );
}

/** The layout of /p/:id: makes the project in the route the active one, or sends an unknown id to the projects. */
export function ProjectRoute() {
  const { id = "" } = useParams();
  return isBlocksProjectId(id) ? <BlocksProjectRoute id={id} /> : <Navigate to="/projects" replace state={{ notice: missingNotice() }} />;
}

/** What the projects page says when a project or step link leads nowhere (read at render time). */
export const missingNotice = () => t("project.route.missing", "This item no longer exists.");

/** Looks the project up in each other active workspace (one parallel wave); resolves the workspace that holds it, or null. */
export async function findProjectElsewhere(
  fetchOne: (workspaceId: string) => Promise<boolean>,
  workspaces: readonly { id: string; status: string }[],
  activeId: string | null,
): Promise<string | null> {
  const others = workspaces.filter((w) => w.status === "active" && w.id !== activeId);
  const found = await Promise.all(others.map((w) => fetchOne(w.id).then((ok) => (ok ? w.id : null), () => null)));
  return found.find((x): x is string => x !== null) ?? null;
}

export type ProjectRouteDecision = "wait" | { switchTo: string } | "missing" | "render";

/** What the route does: waits until the workspace list is known, switches to the workspace that holds the project, or gives up. */
export function projectRouteDecision(i: {
  read: "loading" | "found" | "missing" | "deleting";
  workspacesReady: boolean;
  elsewhere: "loading" | { foundIn: string | null };
  switchedTo: string | null;
}): ProjectRouteDecision {
  if (i.read === "loading") return "wait";
  if (i.read === "found") return "render";
  if (i.read === "deleting") return "missing";
  if (!i.workspacesReady || i.elsewhere === "loading") return "wait";
  const found = i.elsewhere.foundIn;
  if (!found) return "missing";
  return i.switchedTo === found ? "wait" : { switchTo: found };
}

type ProbeRow = { ItemId: string; WorkspaceId: string; Name: string };

/** The cross-workspace probe: the same single-id read, but under its own key so its 3-field row never stands in for the full project. */
export function probeProjectOptions(workspaceId: string, id: string) {
  const base = blocksItemOptions<ProbeRow>("Project", id, { workspaceId, fields: ["ItemId", "WorkspaceId", "Name"] });
  return { ...base, queryKey: [...base.queryKey, "probe"] as const, retry: false as const };
}

/** After switching to the workspace that holds the project: drop the probe row and re-read the full project. */
export function afterProjectSwitch(client: QueryClient, workspaceId: string, projectId: string): void {
  const key = blocksKeys.item(workspaceId, "Project", projectId);
  client.removeQueries({ queryKey: [...key, "probe"] });
  void client.invalidateQueries({ queryKey: key });
}

/** A Blocks project: resolved from its Project record. */
function BlocksProjectRoute({ id }: { id: string }) {
  const t = useT();
  const query = useProject(id);
  const client = useQueryClient();
  const project = query.data;
  const { workspaceId, workspaces, workspacesLoaded } = useBlocksContext();
  // start the step's chunk and first-paint reads at once, in the same commit as the project read (no serial gate)
  const slug = stepSlugOf(useLocation().pathname);
  useEffect(() => {
    if (!slug) return;
    preloadStepChunk(slug);
    if (workspaceId) prefetchProjectStep(client, workspaceId, id, slug);
  }, [workspaceId, id, slug]); // eslint-disable-line react-hooks/exhaustive-deps
  // the list is known once it has settled (also when empty or failed); a context without the flag counts as loaded when it has a list
  const workspacesReady = workspacesLoaded ?? Array.isArray(workspaces);
  const missing = query.data === null;
  const others = missing && workspacesReady ? workspaces.filter((w) => w.status === "active" && w.id !== workspaceId) : [];
  // one parallel wave of single-id reads; the row policies decide what each workspace returns
  const elsewhere = useQueries({
    queries: others.map((w) => probeProjectOptions(w.id, id)),
  });
  const foundIn = missing ? (others.find((_, i) => elsewhere[i]?.data) ?? null) : null;
  const [switched, setSwitched] = useState<string | null>(null);
  const [switchFailed, setSwitchFailed] = useState(false);
  const decision = projectRouteDecision({
    read: query.data === undefined ? "loading" : query.data === null ? "missing" : query.data.status === "deleting" ? "deleting" : "found",
    workspacesReady,
    elsewhere: elsewhere.some((q) => q.isLoading) ? "loading" : { foundIn: foundIn?.id ?? null },
    switchedTo: switched,
  });
  const switchTo = typeof decision === "object" ? decision.switchTo : null;
  useEffect(() => {
    if (!switchTo) return;
    setSwitched(switchTo);
    void switchWorkspace(switchTo).then((r) => { if (!r.ok) setSwitchFailed(true); else afterProjectSwitch(client, switchTo, id); }, () => setSwitchFailed(true));
  }, [switchTo, client, id]);

  const failed = (
    <Banner tone="danger" title={t("project.route.loadFailed", "This project could not be loaded.")} action={<Button size="sm" variant="ghost" onClick={() => { setSwitchFailed(false); setSwitched(null); void query.refetch(); }}>{t("project.route.retry", "Retry")}</Button>} />
  );
  if ((query.error && !project) || switchFailed) return failed;
  // the skeleton is for the first load only: a cached project renders at once while TanStack refreshes it
  if ((decision === "wait" && !project) || typeof decision === "object") return <Skeleton />;
  if (decision === "missing" || !project) return <Navigate to="/projects" replace state={{ notice: missingNotice() }} />;
  return <><ProjectNav projectId={id} /><TeamLauncher projectId={id} /><Outlet /></>;
}

/** The index of /p/:id: opens the project where it stands (the same step the shell links to). */
export function ProjectEntry() {
  const { id = "" } = useParams();
  return isBlocksProjectId(id) ? <BlocksProjectEntry id={id} /> : <Navigate to="/projects" replace state={{ notice: missingNotice() }} />;
}

function BlocksProjectEntry({ id }: { id: string }) {
  const t = useT();
  const query = useProject(id);
  const step = query.data ? JOURNEY_SLUG[query.data.step] : null;
  useEffect(() => { if (step) preloadStepChunk(step); }, [step]);
  if (query.error && query.data === undefined) return <Banner tone="danger" title={t("project.route.loadFailed", "This project could not be loaded.")} action={<Button size="sm" variant="ghost" onClick={() => void query.refetch()}>{t("project.route.retry", "Retry")}</Button>} />;
  if (query.data === undefined) return <Skeleton />;
  if (query.data === null || query.data.status === "deleting") return <Navigate to="/projects" replace state={{ notice: missingNotice() }} />;
  return <Navigate to={stepPath(id, query.data.step)} replace />;
}
