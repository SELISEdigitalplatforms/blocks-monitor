/** Compact icon actions on a project: its wiki, and its live release once there is one. The label is the accessible
 *  name and the tooltip; the click stays on the button, so a table row's own click does not fire. */
import { useNavigate } from "react-router-dom";
import { BookOpen, ExternalLink } from "lucide-react";
import { isLive, type MyProject } from "./parts";
import { IconButton } from "@/madp/ui/kit";
import { useT } from "@/madp/i18n";
import { prefixPath } from "@/madp/lib/pathPrefix";

type Props = { project: Pick<MyProject, "status"> & { id: string; name: string; next: { to: string } }; className?: string };

export function WikiIconButton({ project, className = "h-8 w-8" }: Props) {
  const t = useT();
  const navigate = useNavigate();
  return (
    <IconButton label={t("shell.home.openWikiOf", "Open the wiki of {name}", { name: project.name })} icon={<BookOpen size={16} />} className={className}
      onClick={(e) => { e.stopPropagation(); navigate(prefixPath(`/p/${project.id}/wiki`)); }} />
  );
}

export function LiveIconButton({ project, className = "h-8 w-8" }: Props) {
  const t = useT();
  const navigate = useNavigate();
  if (!isLive(project.status)) return null;
  return (
    <IconButton label={t("shell.home.seeLive", "See {name} live", { name: project.name })} icon={<ExternalLink size={16} />} className={className}
      onClick={(e) => { e.stopPropagation(); navigate(project.next.to); }} />
  );
}
