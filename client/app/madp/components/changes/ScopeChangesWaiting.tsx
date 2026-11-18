/** The changes kept for Scope & success (approved change requests the analysis routed through scope), on the Scope &
 *  success page: each with its words and the way to its change request page, where an approver can build it now as a
 *  change. Nothing shows when there are none. Reads the project's change requests; writes nothing. */
import { Link } from "react-router-dom";
import { History } from "lucide-react";
import { useT } from "@/madp/i18n";
import { Card } from "@/madp/ui/kit";
import { useDeliveryContext } from "@/madp/blocks/delivery/context";
import { useChangeRequests } from "@/madp/blocks/delivery/hooks";
import type { DeliveryChangeRequest } from "@/madp/blocks/delivery/types";
import { changeCode } from "@/madp/domain/delivery";
import { JOURNEY_SLUG } from "@/madp/domain/journey";
import { byNewestNumber } from "@/madp/lib/newest";
import { analysisOf, changeStage, decisionOf } from "./changeFlow";

/** The change requests that wait for a new scope version, newest first (pure). */
export function changesKeptForScope(requests: readonly DeliveryChangeRequest[]): DeliveryChangeRequest[] {
  return byNewestNumber(requests.filter((cr) => changeStage(cr.status, analysisOf(cr), decisionOf(cr)) === "scope"), (cr) => cr.number);
}

const excerpt = (s: string, max = 280): string => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).replace(/\s+\S*$/, "")}…`;
};

export function ScopeChangesWaiting({ projectId }: { projectId: string }) {
  const t = useT();
  const ctx = useDeliveryContext(projectId);
  const requests = useChangeRequests(ctx);
  const kept = changesKeptForScope(requests.data);
  if (!kept.length) return null;
  return (
    <Card title={<span className="inline-flex items-center gap-2"><History size={16} strokeWidth={1.75} aria-hidden />{t("changes.kept.title", "Changes kept for Scope & success")}</span>}>
      <p className="text-[13px] leading-relaxed text-ink2">
        {t("changes.kept.text", "These approved changes go beyond the locked scope. Each one can be built now as a change to what is there from its page.")}
      </p>
      <ul className="mt-3 flex min-w-0 flex-col gap-3" aria-label={t("changes.kept.title", "Changes kept for Scope & success")}>
        {kept.map((cr) => {
          const code = changeCode(cr);
          return (
            <li key={cr.id} className="min-w-0 rounded-block bg-surface2 px-3.5 py-3">
              <p className="text-[14px] font-medium text-ink [overflow-wrap:anywhere]">{code} · {cr.title || code}</p>
              {cr.description && <p className="mt-1 text-[13px] leading-relaxed text-ink2 [overflow-wrap:anywhere]">{excerpt(cr.description)}</p>}
              <Link to={`/p/${projectId}/${JOURNEY_SLUG.build}?cr=${cr.number}`}
                className="mt-2 inline-block text-[13px] font-medium text-accent underline-offset-2 hover:underline">{t("build.step.change.open", "Open {code}", { code })}</Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
