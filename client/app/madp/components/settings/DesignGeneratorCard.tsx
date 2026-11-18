import { Factory, LayoutTemplate, PenTool } from "lucide-react";
import { Card, Chip } from "@/madp/ui/kit";
import { useT } from "@/madp/i18n";

export function DesignGeneratorCard() {
  const t = useT();
  return (
    <div id="design-generator" tabIndex={-1} className="scroll-mt-6 outline-none">
      <Card title={t("settings.designGenerator.title", "Screen designs")} icon={<LayoutTemplate size={18} strokeWidth={1.75} />} bodyClassName="flex flex-col gap-4">
        <p className="max-w-[68ch] text-[14px] text-ink2">
          {t("settings.designGenerator.intro", "Your business analyst generates product screens from the requirements with Figma Make. Review and approve them in Business Analysis → Screens and look & feel.")}
        </p>
        <ul className="flex flex-col gap-3">
          <li className="flex flex-col gap-3 rounded-block bg-surface2 px-4 py-3 sm:flex-row sm:items-center">
            <Factory size={18} strokeWidth={1.75} className="shrink-0 text-ink2" aria-hidden />
            <div className="min-w-0">
              <div className="text-[14px] font-medium">{t("settings.designGenerator.requirementsDriven", "Requirements-driven design")}</div>
              <div className="text-[13px] text-ink2">{t("settings.designGenerator.requirementsDrivenText", "Journeys, visual direction and screens are derived by the business analyst, without a manual design brief.")}</div>
            </div>
            <Chip tone="success" className="self-start sm:ml-auto sm:self-center">{t("settings.designGenerator.on", "On")}</Chip>
          </li>
          <li className="flex flex-col gap-3 rounded-block bg-surface2 px-4 py-3 sm:flex-row sm:items-center">
            <PenTool size={18} strokeWidth={1.75} className="shrink-0 text-ink2" aria-hidden />
            <div className="min-w-0">
              <div className="text-[14px] font-medium">Figma Make</div>
              <div className="text-[13px] text-ink3">{t("settings.designGenerator.provider", "The only design provider · connection managed on the owner engine")}</div>
              <p id="design-generator-plan" className="mt-1 max-w-[68ch] text-[12px] text-ink3">
                {t("settings.designGenerator.plan", "Your business analyst prepares the interactive design from the requirements. Review the screens, request changes and approve the current revision in Screens and look & feel. Your team manages the design service.")}
              </p>
            </div>
          </li>
        </ul>
      </Card>
    </div>
  );
}
