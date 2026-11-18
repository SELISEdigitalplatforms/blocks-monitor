import { useState } from "react";
import { EngineJobStatus } from "@/madp/components/engine/EngineJobStatus";
import { retryEngineJob, engineErrorMessage } from "@/madp/blocks/engine/actions";
import type { EngineJob } from "@/madp/blocks/engine/types";
import { useT } from "@/madp/i18n";

/** The agent is answering: three dots and a plain line, shown the moment the question is sent. */
export function ThinkingBubble({ name, note }: { name: string; note?: string | null }) {
  const t = useT();
  return (
    <div className="flex w-fit max-w-[85%] items-center gap-2.5 rounded-block bg-surface2 px-3 py-2.5" role="status" aria-live="polite">
      <span aria-hidden className="flex items-center gap-1">
        {[0, 1, 2].map((i) => (
          <span key={i} className="fo-animate-type block h-1.5 w-1.5 rounded-full bg-ink3" style={{ animationDelay: `${i * 120}ms` }} />
        ))}
      </span>
      <span className="text-[13px] text-ink2">{note ? `${name} · ${note}` : t("studio.office.chat.thinking", "{name} is thinking…", { name })}</span>
    </div>
  );
}

const ACTIVE = new Set(["queued", "claimed", "running", "succeeded"]);
/** A question nobody picked up within this time shows its real waiting state instead of the dots. */
const STUCK_MS = 60_000;

/** An open question waits for its answer: the agent is thinking until the reply arrives; a job that stopped shows its
 *  real state with Try again. */
export function ChatJobBubble({ job, canRetry, name }: { job: EngineJob | null; canRetry: boolean; name: string }) {
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

  // queued, working, or finished while its reply is being read: the agent is still "thinking"
  const age = job?.createdAt ? Date.now() - Date.parse(job.createdAt) : 0;
  const stuck = job?.status === "queued" && Number.isFinite(age) && age > STUCK_MS;
  if (!job || (ACTIVE.has(job.status) && !stuck && !error)) {
    const note = job?.status === "running" && job.message && !/^Reading the question/.test(job.message) ? job.message.replace(/\.$/, "…") : null;
    return <ThinkingBubble name={name} note={note} />;
  }

  return (
    <div className="max-w-[92%] rounded-block bg-surface2 px-3 py-2">
      <EngineJobStatus job={job} variant="compact" canRetry={canRetry} onRetry={() => void retry()} retrying={retrying} requestError={error} />
    </div>
  );
}
