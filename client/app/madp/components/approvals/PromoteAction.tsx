import { useEffect, useRef, useState } from "react";
import { Rocket } from "lucide-react";
import { Button } from "@/madp/ui/kit";
import type { DeliveryContext } from "@/madp/blocks/delivery/context";
import type { PolicyRecord, RequestRecord } from "@/madp/blocks/delivery/types";
import { useReleasePromote } from "@/madp/blocks/delivery/actions";
import { canPromote, type GatedEnvironment } from "@/madp/domain/promotion";
import { useT } from "@/madp/i18n";
import { envInSentence, policyGap } from "./approvalsUi";

/** Promotes a version once its approvals hold. Nothing is deployed yet, so success never claims it is live. */
export function PromoteAction({ ctx, environment, version, policy, request, primary }: {
  ctx: DeliveryContext;
  environment: GatedEnvironment;
  version: string | null;
  policy: PolicyRecord | null;
  request: RequestRecord | null;
  primary: boolean;
}) {
  const t = useT();
  const promote = useReleasePromote(ctx);
  // production is confirmed with the version named; stage promotes in one click
  const [confirming, setConfirming] = useState(false);
  // the outcome belongs to this environment and version: it does not follow the user to another tab
  const reset = useRef(promote.reset);
  reset.current = promote.reset;
  useEffect(() => { reset.current(); setConfirming(false); }, [environment, version]);
  if (version === null) return null;
  const gap = policyGap(environment, policy);
  const check = gap === null && policy ? canPromote(policy.policy, request?.request ?? null, version) : null;
  const allowed = ctx.can("release.promote");
  const enabled = gap === null && !!check?.ok && allowed;
  const reason = gap ?? (check && !check.ok ? check.reason : !allowed ? t("platform.approvals.promote.managerReleases", "Your release manager releases it.") : null);
  const env = envInSentence(environment);
  const whyId = `promote-why-${environment}`;
  return (
    <div>
      <Button variant={primary ? "primary" : "secondary"} data-primary={primary ? "true" : undefined}
        icon={<Rocket size={16} strokeWidth={1.75} />} disabled={!enabled || promote.pending}
        aria-describedby={reason ? whyId : undefined}
        onClick={() => { if (environment === "production") setConfirming(true); else void promote.run({ environment, version }); }}>
        {promote.pending ? t("platform.approvals.promote.releasing", "Releasing…") : t("platform.approvals.promote.button", "Release v{version} to {env}", { version, env })}
      </Button>
      {confirming && enabled && (
        <div role="group" aria-label={t("platform.approvals.promote.confirmGroup", "Confirm the promotion")} className="mt-2 flex flex-wrap items-center gap-2 text-[13px]">
          {t("platform.approvals.promote.confirmQuestion", "Release v{version} to {env}? Production is what your users work with.", { version, env })}
          <Button size="sm" variant="ghost" disabled={promote.pending} onClick={() => setConfirming(false)}>{t("platform.approvals.promote.notYet", "Not yet")}</Button>
          <Button size="sm" variant="primary" disabled={promote.pending}
            onClick={() => { void promote.run({ environment, version }).then(() => setConfirming(false)); }}>{t("platform.approvals.promote.release", "Release")}</Button>
        </div>
      )}
      {reason && <p id={whyId} className="mt-2 text-[13px] text-ink3">{reason}</p>}
      {promote.error && <p role="alert" className="mt-2 text-[13px] text-danger">{promote.error}</p>}
      {promote.success && <p role="status" className="mt-2 text-[13px] text-success">{t("platform.approvals.promote.released", "Released. It goes live in a moment.")}</p>}
    </div>
  );
}
