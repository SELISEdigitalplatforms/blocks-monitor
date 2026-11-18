/** Starts a feature from a requirement nobody uses yet. The title is the requirement's own; the person edits it. */
import { FileText } from "lucide-react";
import { Button, Chip } from "@/madp/ui/kit";
import type { RequirementRecord } from "../../../blocks/scope/records";
import { useT } from "@/madp/i18n";

/** The requirements that no feature references yet. */
export function unusedRequirements(requirements: RequirementRecord[], used: Iterable<string>): RequirementRecord[] {
  const taken = new Set(used);
  return requirements.filter((r) => !taken.has(r.id));
}

export function AddFromRequirements({ requirements, usedRequirementIds, onChoose }: {
  requirements: RequirementRecord[];
  usedRequirementIds: Iterable<string>;
  onChoose: (requirement: RequirementRecord) => void;
}) {
  const t = useT();
  const free = unusedRequirements(requirements, usedRequirementIds);
  if (free.length === 0) return <p className="text-[14px] text-ink2">{t("analysis.scope.addFromReq.allUsed", "Every requirement is already used by a feature.")}</p>;
  return (
    <ul aria-label={t("analysis.scope.addFromReq.aria", "Requirements without a feature")} className="space-y-2">
      {free.map((r) => (
        <li key={r.id} className="flex flex-wrap items-center gap-3 rounded-block bg-surface2 px-4 py-2.5">
          <Chip icon={<FileText size={12} strokeWidth={1.75} aria-hidden />}>{r.code}</Chip>
          <span className="min-w-0 flex-1 text-[14px] text-ink [overflow-wrap:anywhere]">{r.title}</span>
          <Button size="sm" variant="ghost" aria-label={t("analysis.scope.addFromReq.startFrom", "Start a feature from {code}", { code: r.code })} onClick={() => onChoose(r)}>{t("analysis.scope.addFromReq.start", "Start a feature")}</Button>
        </li>
      ))}
    </ul>
  );
}
