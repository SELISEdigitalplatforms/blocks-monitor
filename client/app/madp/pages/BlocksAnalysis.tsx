/**
 * Blocks shell wrapper for the MADP Analysis workflow.
 * Links each Blocks project to its own MADP project via BlocksProjectRef.
 * - If no MADP project exists for THIS Blocks project: auto-creates one
 * - If a project exists: navigates to the project's current step
 */
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useProjectListAll } from "@/madp/blocks/projects/reads";
import { useCreateProjectOnce } from "@/madp/blocks/projects/mutations";
import { useProjectStore } from "@seliseblocks/genesis-os/store";
import { newRequestId } from "@/madp/blocks/fn";
import { Banner, Button, Card, EmptyState } from "@/madp/ui/kit";
import { FileText, Loader2, Plus } from "lucide-react";

export default function BlocksAnalysis() {
  const list = useProjectListAll();
  const { create, isPending } = useCreateProjectOnce();
  const [failure, setFailure] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const navigate = useNavigate();
  const { itemId = "" } = useParams();

  // Current Blocks project ID from the URL
  const blocksProjectId = itemId;

  const blocksProject = useProjectStore((s) => s.selectedProject);
  const proj = blocksProject as Record<string, unknown> | null;
  const blocksName = (proj?.Name ?? proj?.name ?? proj?.ProjectName ?? proj?.projectName ?? "Project") as string;

  const projects = list.data ?? [];

  // Find the MADP project that belongs to THIS Blocks project (exact match only)
  const madpProject = projects.find(
    (p) => p.status === "active" && p.blocksProjectRef === blocksProjectId
  );

  // Redirect when project exists or just created
  useEffect(() => {
    if (created && itemId) {
      navigate(`/app/${itemId}/p/${created}/business`, { replace: true });
    } else if (madpProject && itemId) {
      const step = madpProject.step ?? "business";
      const page = step === "build" || step === "release" ? step
        : step === "scope" || step === "requirements" || step === "sanitization" || step === "understanding"
          ? "analysis"
          : "business";
      navigate(`/app/${itemId}/p/${madpProject.id}/${page}`, { replace: true });
    }
  }, [created, madpProject, navigate, itemId]);

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

  if (madpProject || created) {
    return <div className="h-64 rounded-xl bg-muted/20 animate-pulse" />;
  }

  // No MADP project for this Blocks project — show initialization
  const handleInitialize = () => {
    setFailure(null);
    create(
      { name: blocksName, projectType: "greenfield", blocksProjectRef: blocksProjectId },
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
