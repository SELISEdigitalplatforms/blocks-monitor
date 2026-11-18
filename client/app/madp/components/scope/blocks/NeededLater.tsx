/** "Needed later" (aside of Scope & success): what the team will be asked for further on and where, so nothing comes as
 *  a surprise. Informational only: nothing here blocks the lock. */
import { Link } from "react-router-dom";
import { Clock3 } from "lucide-react";
import { Card } from "@/madp/ui/kit";
import { requirementsDesignPath } from "../links";
import { t, useT } from "@/madp/i18n";

/** Read at render time: the texts are looked up in the current language when they are read. */
export const NEEDED_LATER = [
  {
    id: "design",
    get title() { return t("analysis.scope.later.designTitle", "UX / Figma link"); },
    get when() { return t("analysis.scope.later.designWhen", "With the design screens"); },
    get text() { return t("analysis.scope.later.designText", "If you have designs in Figma, add the link where the screens are designed."); },
  },
  {
    id: "devtest",
    get title() { return t("analysis.scope.later.devtestTitle", "Development & test setup"); },
    get when() { return t("analysis.scope.later.devtestWhen", "Before Build"); },
    get text() { return t("analysis.scope.later.devtestText", "Where your team builds and tests: environments, test accounts and test data."); },
  },
  {
    id: "staging",
    get title() { return t("analysis.scope.later.stagingTitle", "Staging setup"); },
    get when() { return t("analysis.scope.later.stagingWhen", "Before Release"); },
    get text() { return t("analysis.scope.later.stagingText", "The staging environment and who gets access to try it."); },
  },
] as const;

export function NeededLater({ projectId }: { projectId: string }) {
  const t = useT();
  return (
    <Card title={<span className="inline-flex items-center gap-2"><Clock3 size={16} strokeWidth={1.75} aria-hidden />{t("analysis.scope.later.title", "Needed later")}</span>}>
      <p className="text-[12.5px] text-ink3">{t("analysis.scope.later.nothingNow", "Nothing to do now. You'll be asked for these when they're needed.")}</p>
      <ul className="mt-3 flex flex-col gap-3" aria-label={t("analysis.scope.later.title", "Needed later")}>
        {NEEDED_LATER.map((n) => (
          <li key={n.id} className="text-[13px]">
            <p className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-medium text-ink">{n.title}</span>
              <span className="text-[12px] text-ink3">{n.when}</span>
            </p>
            <p className="mt-0.5 text-ink2">
              {n.text}
              {n.id === "design" && (
                <>{" "}<Link to={requirementsDesignPath(projectId)} className="font-medium text-[rgb(var(--c-accent-text))] underline-offset-2 hover:underline">{t("analysis.scope.later.screensDesign", "Screens & design")}</Link></>
              )}
            </p>
          </li>
        ))}
      </ul>
    </Card>
  );
}
