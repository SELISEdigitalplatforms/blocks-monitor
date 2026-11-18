import { ShieldCheck } from "lucide-react";
import { Chip } from "@/madp/ui/kit";
import type { IamStatus } from "@/madp/blocks/iam";
import { formatDateTime } from "@/madp/lib/dates";
import { useT } from "@/madp/i18n";

/** One plain line: where roles and permissions are managed and when Blocks OS IAM was last synced. */
export function IamSourceLine({ status }: { status: IamStatus | undefined }) {
  const t = useT();
  if (!status) return null;
  const synced = formatDateTime(status.sync?.syncedAt);
  const iam = status.source === "iam";
  const text = iam
    ? (synced
      ? t("platform.iam.source.iamSynced", "Managed in Blocks OS IAM · last synced {synced}", { synced })
      : t("platform.iam.source.iamNotSynced", "Managed in Blocks OS IAM · not synced yet"))
    : (synced
      ? t("platform.iam.source.factorySynced", "Managed in MADP Factory · last synced to Blocks OS IAM {synced}", { synced })
      : t("platform.iam.source.factoryNotSynced", "Managed in MADP Factory · not synced to Blocks OS IAM yet"));
  return (
    <p className="flex flex-wrap items-center gap-2 text-[13px] text-ink2" data-rbac-source={status.source}>
      <ShieldCheck size={16} strokeWidth={1.75} aria-hidden className="text-ink3" />
      <span>{text}</span>
      {!status.available && <Chip tone="warning">{t("platform.iam.source.unreachable", "IAM can't be reached")}</Chip>}
    </p>
  );
}
