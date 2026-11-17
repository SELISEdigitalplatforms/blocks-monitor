import { Eye } from "lucide-react";
import { Chip } from "@/ui/kit";
import { useT } from "@/i18n";

export function AuditedChip() {
  const t = useT();
  return <Chip tone="warning" icon={<Eye size={14} strokeWidth={1.75} />} title={t("platform.auditedChip.title", "Every view and change here is kept in the audit log.")}>{t("platform.auditedChip.label", "Recorded")}</Chip>;
}
