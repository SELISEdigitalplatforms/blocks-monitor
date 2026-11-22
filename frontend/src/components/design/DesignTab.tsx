/** Look & feel is a generated, versioned Figma Make deliverable, never a manual editor. */
import type { ReqTab } from "@/components/requirements/requirementsTab";
import { useT } from "@/i18n";

export interface DesignTabProps {
  projectId: string;
  editable: boolean;
  readOnlyReason: "closed" | "permission" | null;
  onOpenTab: (tab: ReqTab) => void;
  onEditingChange?: (editing: boolean) => void;
}

export function DesignTab(_props: DesignTabProps) {
  const t = useT();
  return <a href="#doc-look" className="text-[14px] font-medium text-accent underline">{t("analysis.design.tab.review", "Review the generated Figma Make screens in Look & feel")}</a>;
}
