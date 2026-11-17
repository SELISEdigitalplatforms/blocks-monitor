/** The generated screens are reviewed and explicitly approved inside Goals & requirements. */
import { useT } from "@/i18n";
import { Palette } from "lucide-react";
import { DocBlock } from "./ObjectiveTab";
import { MakeDesignPanel } from "@/components/design/MakeDesignPanel";

export function LookAndFeel({ projectId, editable, waiting }: { projectId: string; editable: boolean; waiting: boolean; onChange: () => void }) {
  const t = useT();
  return <section id="doc-look" aria-label={t("analysis.requirements.tabDesign", "Look & feel")} className="scroll-mt-[calc(var(--project-nav-h,var(--topbar-h,0px))+24px)]">
    {/* the design panel draws its own heading, so its approval sits at the section's top right like every approval */}
    {waiting ? <DocBlock title={t("analysis.requirements.tabDesign", "Look & feel")} icon={<Palette size={18} strokeWidth={1.75} />}>
        <p role="status" className="text-[14px] text-ink2">{t("analysis.requirements.lookFeelOnceReady", "Your business analyst will generate the Figma Make screens once the requirements are ready.")}</p>
      </DocBlock>
      : <MakeDesignPanel projectId={projectId} editable={editable} />}
  </section>;
}
