import { useProjectList } from "@/madp/blocks/projects";
import { Card, EmptyState } from "@/madp/ui/kit";
import { Hammer } from "lucide-react";
import { Navigate } from "react-router-dom";

export default function BlocksBuild() {
  const list = useProjectList();
  const projects = list.data ?? [];
  const latest = projects.find((p) => p.status === "active");

  if (list.isPending) return <div className="h-64 rounded-xl bg-muted/20 animate-pulse" />;
  if (!latest) return <Card><EmptyState icon={<Hammer size={48} strokeWidth={1.5} />} title="No active build" text="Start the analysis first to begin building." /></Card>;
  return <Navigate to={`../p/${latest.id}/build`} replace />;
}
