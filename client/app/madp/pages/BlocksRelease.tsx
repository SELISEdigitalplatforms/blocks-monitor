import { useParams } from "react-router-dom";
import { useProjectListAll } from "@/madp/blocks/projects/reads";
import { Card, EmptyState } from "@/madp/ui/kit";
import { Rocket } from "lucide-react";
import { Navigate } from "react-router-dom";

export default function BlocksRelease() {
  const { itemId = "" } = useParams();
  const list = useProjectListAll();
  const projects = list.data ?? [];
  const linked = projects.find((p) => p.status === "active" && (p as unknown as Record<string, unknown>).blocksProjectRef === itemId);

  if (list.isPending) return <div className="h-64 rounded-xl bg-muted/20 animate-pulse" />;
  if (!linked) return <Card><EmptyState icon={<Rocket size={48} strokeWidth={1.5} />} title="No releases yet" text="Complete the build first to release." /></Card>;
  return <Navigate to={`/app/${itemId}/p/${linked.id}/delivered`} replace />;
}
