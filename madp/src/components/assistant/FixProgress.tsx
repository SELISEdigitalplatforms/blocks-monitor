import { useState } from "react";
import { Hammer } from "lucide-react";
import { EngineJobStatus } from "@/components/engine/EngineJobStatus";
import { engineErrorMessage, retryEngineJob } from "@/blocks/engine/actions";
import type { EngineJob } from "@/blocks/engine/types";
import { useT } from "@/i18n";

/** The fix build, as the change.build job of its change request: its real state, nothing simulated. */
export function FixProgress({ job, code, canRetry }: { job: EngineJob | null; code: string; canRetry: boolean }) {
  const t = useT();
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const retry = async () => {
    if (!job) return;
    setRetrying(true);
    setError(null);
    try {
      await retryEngineJob(job.id);
    } catch (e) {
      setError(engineErrorMessage(e));
    } finally {
      setRetrying(false);
    }
  };
  return (
    <div className="space-y-2.5">
      <p className="flex items-center gap-2 text-[13px] font-medium text-ink">
        <Hammer size={15} strokeWidth={1.75} className="shrink-0 text-ink3" aria-hidden />
        {t("assistant.fix.fixing", "Fixing {code}", { code })}
      </p>
      <EngineJobStatus job={job} canRetry={canRetry} onRetry={() => void retry()} retrying={retrying} requestError={error} />
    </div>
  );
}
