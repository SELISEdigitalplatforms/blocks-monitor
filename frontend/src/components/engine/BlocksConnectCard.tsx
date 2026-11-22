/** "Connect <product> to Blocks": the card a product's build, change and release pages show while one of its jobs waits
 *  for a person to approve the product's Blocks sign-in on the engine host (src/domain/blocksConnect.ts). The job goes
 *  on by itself once the code is confirmed; an expired code fails the job in plain words and a new start gives a new
 *  code. Everything shown is the job's own line: the link and the code the engine read from the Blocks sign-in. */
import { useState } from "react";
import { Check, Copy, ExternalLink, KeyRound } from "lucide-react";
import { Button } from "@/ui/kit";
import { cn } from "@/lib/cn";
import { useT } from "@/i18n";
import type { EngineJob } from "@/blocks/engine/types";
import { isActiveEngineJob } from "@/blocks/engine/types";
import { CONNECT_EXPIRY_MINUTES, connectOf, type BlocksConnect } from "@/domain/blocksConnect";

/** The sign-in a job waits for, while it is at work (null otherwise). */
export function connectOfJob(job: Pick<EngineJob, "status" | "message"> | null | undefined): BlocksConnect | null {
  return job && isActiveEngineJob(job) ? connectOf(job.message) : null;
}

/** The first job of the list that waits for a Blocks sign-in, with what it asks for. */
export function waitingConnect(jobs: readonly EngineJob[]): { job: EngineJob; connect: BlocksConnect } | null {
  for (const job of jobs) {
    const connect = connectOfJob(job);
    if (connect) return { job, connect };
  }
  return null;
}

function CopyCode({ code }: { code: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* the code stays readable on the card */
    }
  };
  return (
    <Button size="sm" variant="ghost" onClick={() => void copy()}
      icon={copied ? <Check size={14} strokeWidth={1.75} aria-hidden /> : <Copy size={14} strokeWidth={1.75} aria-hidden />}>
      {copied ? t("studio.engine.connect.copied", "Copied") : t("studio.engine.connect.copyCode", "Copy code")}
    </Button>
  );
}

export function BlocksConnectCard({ connect, variant = "full", className }: { connect: BlocksConnect; variant?: "full" | "compact"; className?: string }) {
  const t = useT();
  const title = t("studio.engine.connect.title", "Connect {product} to Blocks", { product: connect.product });
  const link = (
    <a href={connect.url} target="_blank" rel="noopener noreferrer"
      className="inline-flex items-center gap-1 font-medium text-[rgb(var(--c-accent-text))] underline-offset-2 hover:underline">
      {t("studio.engine.connect.openSignIn", "Open the Blocks sign-in")}<ExternalLink size={14} strokeWidth={1.75} aria-hidden />
    </a>
  );
  const code = <span className="num rounded-md bg-surface px-2 py-0.5 font-mono text-[15px] font-semibold tracking-wider text-ink ring-1 ring-line">{connect.code}</span>;
  if (variant === "compact") {
    return (
      <div role="status" className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ink2", className)}>
        <span className="font-medium text-ink">{t("studio.engine.connect.titleCompact", "Connect {product} to Blocks:", { product: connect.product })}</span>
        {link}
        <span className="inline-flex items-center gap-1.5">{t("studio.engine.connect.confirmCodeShort", "confirm code")} {code}</span>
      </div>
    );
  }
  return (
    <section role="status" aria-live="polite" aria-label={title}
      className={cn("rounded-block bg-surface px-5 py-4 shadow-card ring-1 ring-line", className)}>
      <div className="flex items-center gap-2">
        <KeyRound size={18} strokeWidth={1.75} aria-hidden className="shrink-0 text-[rgb(var(--c-accent-text))]" />
        <h3 className="text-[15px] font-medium text-ink">{title}</h3>
      </div>
      <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-[14px] text-ink2">
        <li>{link}</li>
        <li>{t("studio.engine.connect.signInStep", "Sign in with the Blocks account that may deploy this product.")}</li>
        <li className="flex flex-wrap items-center gap-x-2 gap-y-1">{t("studio.engine.connect.confirmCode", "Confirm the code")} {code} <CopyCode code={connect.code} /></li>
      </ol>
      <p className="mt-3 text-[13px] text-ink3">
        {t("studio.engine.connect.expiry", "It expires in about {minutes} minutes. The work goes on by itself once the code is confirmed; if it expires, start it again for a new code.", { minutes: CONNECT_EXPIRY_MINUTES })}
      </p>
    </section>
  );
}

/** The card for the first job of a page that waits for a Blocks sign-in; nothing otherwise. */
export function BlocksConnectNotice({ jobs, className }: { jobs: readonly EngineJob[]; className?: string }) {
  const hit = waitingConnect(jobs);
  return hit ? <BlocksConnectCard connect={hit.connect} className={className} /> : null;
}
