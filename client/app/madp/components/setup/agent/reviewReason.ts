import { t } from "@/madp/i18n";

/** Why a person can read the findings but not add them: the project has moved past setup, or their role can't edit it. */
export function reviewReadOnlyReason(o: { inSetup: boolean; canEdit: boolean }): { title: string; text: string } | null {
  if (!o.inSetup) {
    return {
      title: t("shell.setup.review.pastSetupTitle", "Your project has moved past setup"),
      text: t("shell.setup.review.pastSetupText", "These findings can't be added to the setup any more. Your business analyst reads the same material, so they carry into the next steps. To change what the product must do, use Goals & requirements."),
    };
  }
  if (!o.canEdit) {
    return {
      title: t("shell.setup.review.readOnlyTitle", "You can read these findings, but not add them"),
      text: t("shell.setup.review.readOnlyText", "Only people who can edit the project setup can add or ignore them. Ask a workspace admin if you need to."),
    };
  }
  return null;
}
