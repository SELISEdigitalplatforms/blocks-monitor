/** Grid or list on the Projects page: a segmented control, the choice remembered per browser (grid by default). */
import { useState } from "react";
import { LayoutGrid, List } from "lucide-react";
import { Segmented } from "@/madp/ui/kit";
import { readProjectsView, writeProjectsView, type ProjectsViewMode } from "./projectCards";
import { useT } from "@/madp/i18n";

export function useProjectsView(): [ProjectsViewMode, (v: ProjectsViewMode) => void] {
  const [view, setView] = useState<ProjectsViewMode>(() => readProjectsView());
  return [view, (v) => { setView(v); writeProjectsView(v); }];
}

export function ViewToggle({ value, onChange, className }: { value: ProjectsViewMode; onChange: (v: ProjectsViewMode) => void; className?: string }) {
  const t = useT();
  return (
    <Segmented<ProjectsViewMode> label={t("shell.projects.showAs", "Show projects as")} value={value} onChange={onChange} className={className}
      options={[
        { value: "grid", label: <span className="inline-flex items-center gap-1.5"><LayoutGrid size={15} strokeWidth={1.75} aria-hidden />{t("shell.projects.grid", "Grid")}</span> },
        { value: "list", label: <span className="inline-flex items-center gap-1.5"><List size={15} strokeWidth={1.75} aria-hidden />{t("shell.projects.list", "List")}</span> },
      ]} />
  );
}
