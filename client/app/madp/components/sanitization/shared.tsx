/** Small pieces shared by the Product sanitization sections. */
import type { ReactNode } from "react";
import { Eye, Factory } from "lucide-react";
import { sanitizationErrorText } from "@/madp/blocks/sanitization/messages";
import { SANITIZATION_SECTIONS, type MemberDirectory, type SanitizationSection, type StepAccess } from "@/madp/blocks/sanitization/types";
import { Button, Chip } from "@/madp/ui/kit";
import { formatDateTime } from "@/madp/lib/dates";
import { useT } from "@/madp/i18n";

export type { SanitizationSection };

export interface SectionProps {
  workspaceId: string;
  projectId: string;
  phase: "open" | "completed";
  access: StepAccess;
  members: MemberDirectory;
  /** An existing product (brownfield): a few sections use the product's words. */
  existing?: boolean;
  /** The section's own heading (default: its plain name) and an extra action in its header. */
  title?: string;
  headerAction?: ReactNode;
}

export type WriteState = "idle" | "saving" | "saved" | "error";

/** The result of the last write: quiet while it goes well, visible when it fails. */
export function WriteNote({ state, error, onRetry }: { state: WriteState; error?: unknown; onRetry?: () => void }) {
  const t = useT();
  if (state === "idle") return null;
  if (state === "error") {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-danger">
        <span className="min-w-0 break-words">{sanitizationErrorText(error)}</span>
        {onRetry && <Button size="sm" variant="ghost" onClick={onRetry}>{t("settings.sanitization.shared.retry", "Retry")}</Button>}
      </div>
    );
  }
  return <span role="status" className="text-[12px] text-ink3">{state === "saving" ? t("settings.sanitization.shared.saving", "Saving…") : t("settings.sanitization.shared.saved", "Saved")}</span>;
}

export function ReadOnlyNote({ access }: { access: StepAccess }): ReactNode {
  const t = useT();
  if (access.canEdit) return null;
  return (
    <p className="flex items-start gap-2 rounded-block bg-surface2 px-4 py-3 text-[14px] text-ink2">
      <Eye size={16} aria-hidden className="mt-0.5 shrink-0 text-ink3" />
      <span>
        {access.canComment
          ? t("settings.sanitization.shared.readOnlyComment", "You can read what the business analyst understood and the answers so far, and comment. If a question is addressed to you, you can answer it; the rest is up to the project team.")
          : t("settings.sanitization.shared.readOnly", "You can read what the business analyst understood and the answers so far. If a question is addressed to you, you can answer it; the rest is up to the project team.")}
      </span>
    </p>
  );
}

export function LoadError({ onRetry }: { onRetry: () => void }) {
  const t = useT();
  return (
    <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[14px] text-ink2">
      <span>{t("settings.sanitization.shared.loadError", "Couldn't load this section.")}</span>
      <Button size="sm" variant="ghost" onClick={onRetry}>{t("settings.sanitization.shared.retry", "Retry")}</Button>
    </div>
  );
}

export function formatAt(iso: string | null | undefined): string {
  return formatDateTime(iso);
}

export function FromMadpChip({ label }: { label: string }) {
  return <Chip tone="ai" icon={<Factory size={12} strokeWidth={1.75} />}>{label}</Chip>;
}

export const sectionHref = (projectId: string, section: SanitizationSection | string) =>
  "/p/" + projectId + "/sanitization?section=" + section;

export function sectionFromParam(value: string | null | undefined): SanitizationSection {
  return (SANITIZATION_SECTIONS as readonly string[]).includes(value ?? "") ? (value as SanitizationSection) : "clarifications";
}
