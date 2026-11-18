import { useProjectList } from "@/madp/blocks/projects";
import { Card, EmptyState } from "@/madp/ui/kit";
import { Rocket } from "lucide-react";
import { Navigate } from "react-router-dom";

export default function BlocksRelease() {
  const list = useProjectList();
  const projects = list.data ?? [];
  const latest = projects.find((p) => p.status === "active");

  if (list.isPending) return <div className="h-64 rounded-xl bg-muted/20 animate-pulse" />;
  if (!latest) return <Card><EmptyState icon={<Rocket size={48} strokeWidth={1.5} />} title="No releases yet" text="Complete the build first to release." /></Card>;
  return <Navigate to={`../p/${latest.id}/delivered`} replace />;
}
