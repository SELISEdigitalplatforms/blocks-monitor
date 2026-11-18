/**
 * Blocks shell wrapper for the MADP Analysis workflow.
 * - If no MADP project exists: auto-creates one, then navigates to Business step
 * - If a project exists: navigates to the project's current step
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useProjectList } from "@/madp/blocks/projects";
import { useCreateProjectOnce } from "@/madp/blocks/projects/mutations";
import { useProjectStore } from "@seliseblocks/genesis-os/store";
import { newRequestId } from "@/madp/blocks/fn";
import { Banner, Button, Card, EmptyState } from "@/madp/ui/kit";
import { FileText, Loader2, Plus } from "lucide-react";

export default function BlocksAnalysis() {
  const list = useProjectList();
  const { create, isPending } = useCreateProjectOnce();
  const [failure, setFailure] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const navigate = useNavigate();

  const projects = list.data ?? [];
  const latest = projects.find((p) => p.status === "active");

  const blocksProject = useProjectStore((s) => s.selectedProject);
  const proj = blocksProject as Record<string, unknown> | null;
  const blocksName = (proj?.Name ?? proj?.name ?? proj?.ProjectName ?? proj?.projectName ?? "Project") as string;

  // Get the current itemId from the URL to build absolute paths
  const currentPath = window.location.pathname;
  const itemIdMatch = currentPath.match(/\/app\/([^/]+)\//);
  const itemId = itemIdMatch?.[1] ?? "";

  // Redirect when project exists or just created
  useEffect(() => {
    if (created && itemId) {
      navigate(`/app/${itemId}/p/${created}/business`, { replace: true });
    } else if (latest && itemId) {
      navigate(`/app/${itemId}/p/${latest.id}/business`, { replace: true });
    }
  }, [created, latest, navigate, itemId]);

  if (list.isPending) {
    return (
      <div className="flex flex-col gap-6">
        <div className="h-9 w-72 rounded-full bg-muted/40 animate-pulse" />
        <div className="h-64 rounded-xl bg-muted/20 animate-pulse" />
      </div>
    );
  }

  if (list.isError) {
    return <Card><Banner tone="danger" title="Could not load" text="Please try again later." /></Card>;
  }

  // If we already know there's a project, show loading while redirect fires
  if (latest || created) {
    return <div className="h-64 rounded-xl bg-muted/20 animate-pulse" />;
  }

  const handleInitialize = () => {
    setFailure(null);
    create(
      { name: blocksName, projectType: "greenfield" },
      newRequestId(),
    ).then(
      (r) => setCreated(r.project.id),
      () => setFailure("Could not initialize the MADP workflow. Please try again."),
    );
  };

  return (
    <Card>
      {failure && <div className="mb-4"><Banner tone="danger" title="Initialization failed" text={failure} /></div>}
      <EmptyState
        icon={<FileText size={48} strokeWidth={1.5} className="opacity-50" />}
        title="Start your analysis"
        text={`Initialize the MADP workflow for "${blocksName}" to begin uploading documents, writing your brief, and running the AI-powered business analysis.`}
        action={
          <Button variant="primary" icon={isPending ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />} disabled={isPending} onClick={handleInitialize}>
            {isPending ? "Initializing…" : "Start MADP Workflow"}
          </Button>
        }
      />
    </Card>
  );
}
