/** What a change's own checks found on development (changeChecksUi.ts): on a change whose checks failed, what does not
 *  work (the failing checks by name, with a short reason, and beside each what a fix round's diagnosis said), what
 *  happens next and who acts, the fix rounds so far, and the secondary actions (put development back, run the checks
 *  again, mark a failing check "known before this change" with a short reason). The checks that still fail as they did
 *  before the change are always listed apart. After a revert or a fix that passed, one plain line says so. The
 *  project's policy for failed checks can be changed here. */
import { useState } from "react";
import { CircleAlert, History, RotateCcw, Undo2 } from "lucide-react";
import { Button, Card, Input } from "@/ui/kit";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/dates";
import { t, useT } from "@/i18n";
import type { ChecksPolicy } from "@/domain/changeChecks";
import { MARK_REASON_MAX, MAX_AUTO_FIX_ROUNDS } from "@/domain/changeChecks";
import { failingWords, nextWords, policyWords, roundWords, type ChangeChecksState, type KnownLine } from "./changeChecksUi";

const SHOWN = 8;

type Check = { repo: string; name: string };

export function ChangeChecksCard({ state, what, policy, canRun, onRevert, onRecheck, onPolicy, onMark, onUnmark, busy, error, success, codeOf }: {
  state: ChangeChecksState;
  /** "CR-015" for a change's id (the change whose run passed a check again); "" when it is not known. */
  codeOf?: (changeId: string) => string;
  /** "CR-005", "CR-005 increment 1 of 3" */
  what: string;
  policy: ChecksPolicy;
  canRun: boolean;
  onRevert: () => void;
  /** Runs the checks again ("Finish the steps after the deploy"); absent: it cannot help now. */
  onRecheck?: () => void;
  onPolicy: (p: ChecksPolicy) => void;
  /** Marks a failing check "known before this change" with a short reason (resolves true when saved). */
  onMark?: (c: Check, reason: string) => Promise<boolean>;
  /** Takes a person's mark back. */
  onUnmark?: (c: Check) => void;
  busy?: boolean;
  error?: string | null;
  success?: string | null;
}) {
  const t = useT();
  const [marking, setMarking] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  if (!state.broken && !state.next && !state.reverted && !state.fixed && !state.known.length && !state.passSince) return null;
  const keyOf = (c: Check) => `${c.repo}:${c.name}`;
  const saveMark = async (c: Check) => {
    if (!onMark || reason.trim().length < 3) return;
    if (await onMark(c, reason.trim())) { setMarking(null); setReason(""); }
  };
  const working = state.next?.who === "team";
  const asks = state.next?.who === "you";
  const policyControls = (
    <div className="mt-3 flex flex-col gap-2 border-t border-line pt-3 text-[12px] text-ink3">
      <p>{policyWords(policy)}</p>
      {canRun && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={policy.autoFixRounds > 0} disabled={busy}
              onChange={(e) => onPolicy({ ...policy, autoFixRounds: e.target.checked ? MAX_AUTO_FIX_ROUNDS : 0 })} />
            {t("changes.checks.card.autoFix", "Fix on its own (up to {count} rounds)", { count: MAX_AUTO_FIX_ROUNDS })}
          </label>
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={policy.autoRevert} disabled={busy}
              onChange={(e) => onPolicy({ ...policy, autoRevert: e.target.checked })} />
            {t("changes.checks.card.autoRevert", "Then put development back on its own")}
          </label>
        </div>
      )}
    </div>
  );

  const knownList = state.known.length > 0 && (
    <KnownList known={state.known} canRun={canRun} busy={busy} onUnmark={onUnmark} />
  );

  if (!state.broken && !working) {
    return (
      <Card tone="soft">
        {state.reverted ? (
          <>
            <p className="text-[14px] font-medium text-ink">{t("build.step.change.putBack", "Development was put back without {what}", { what })}</p>
            <p className="mt-1 text-[13px] leading-relaxed text-ink2">
              {state.reverted.version
                ? t("changes.checks.card.revertedVersion", "Its own checks still failed after its fix rounds, so development is back on the last build whose checks passed ({version}). Its tickets are open again; its next build gets what the checks found.", { version: state.reverted.version })
                : t("changes.checks.card.reverted", "Its own checks still failed after its fix rounds, so development is back on the last build whose checks passed. Its tickets are open again; its next build gets what the checks found.")}
            </p>
          </>
        ) : state.fixed ? (
          <p className="text-[13px] leading-relaxed text-ink2">
            {state.fixed.version
              ? t("changes.checks.card.fixedVersion", "Its checks on development pass since fix round {round} ({version}).", { round: state.fixed.round, version: state.fixed.version })
              : t("changes.checks.card.fixed", "Its checks on development pass since fix round {round}.", { round: state.fixed.round })}
          </p>
        ) : state.passSince ? (
          <PassSince state={state} codeOf={codeOf} />
        ) : null}
        {state.rounds.length > 0 && <Rounds state={state} />}
        {knownList}
        {success && !error && <p role="status" className="mt-2 text-[13px] text-[rgb(var(--c-success-text))]">{success}</p>}
        {error && <p role="alert" className="mt-2 text-[13px] text-danger">{error}</p>}
      </Card>
    );
  }

  const failing = state.failing;
  return (
    <section id="cr-checks" tabIndex={-1} aria-label={t("changes.checks.card.found", "What the checks found")} className="scroll-mt-[calc(var(--project-nav-h,var(--topbar-h,0px))+24px)] outline-none">
      <Card>
        <div className="flex flex-col gap-3">
          <p className="flex items-start gap-2 text-[14px] text-ink">
            <CircleAlert size={16} strokeWidth={1.75} aria-hidden className="mt-0.5 shrink-0 text-[rgb(var(--c-warning-text))]" />
            <span className="min-w-0 break-words">
              <span className="font-medium">{state.version ? t("changes.checks.card.notUsableVersion", "{what} is on development as {version}, but not usable yet:", { what, version: state.version }) : t("changes.checks.card.notUsable", "{what} is on development, but not usable yet:", { what })}</span> {failingWords(state)}.
            </span>
          </p>
          {failing.length > 0 ? (
            <ul className="flex flex-col gap-1.5 text-[13px] leading-relaxed text-ink2">
              {failing.slice(0, SHOWN).map((f) => (
                <li key={keyOf(f)} className="min-w-0 break-words">
                  <span className="font-medium text-ink">{f.repo ? `${f.repo} · ` : ""}{f.name}</span>
                  {f.reason ? <span> — {f.reason}</span> : null}
                  {f.diagnosed && (
                    <span className="mt-0.5 block text-[12px] text-ink3">
                      {f.diagnosed.cause ? t("changes.checks.card.diagnosedCause", "The fix round's diagnosis puts it in the environment, not the code: {cause}", { cause: f.diagnosed.cause }) : t("changes.checks.card.diagnosed", "The fix round's diagnosis puts it in the environment, not the code")}
                      {f.diagnosed.evidence.length ? ` (${f.diagnosed.evidence.join("; ")})` : ""}. {t("changes.checks.card.stillCounts", "Its checks still count it as failed.")}
                    </span>
                  )}
                  {canRun && onMark && !working && (marking === keyOf(f) ? (
                    <span className="mt-1.5 flex flex-wrap items-center gap-2">
                      <label className="sr-only" htmlFor={`known-${keyOf(f)}`}>{t("changes.checks.card.why", "Why it failed before this change")}</label>
                      <Input id={`known-${keyOf(f)}`} value={reason} maxLength={MARK_REASON_MAX} disabled={busy} autoFocus
                        placeholder={t("changes.checks.card.whyPlaceholder", "Why it failed before this change (e.g. out of date since 12 Oct)")}
                        onChange={(e) => setReason(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") void saveMark(f); if (e.key === "Escape") setMarking(null); }}
                        className="min-w-0 flex-1 basis-64 text-[13px]" />
                      <Button size="sm" variant="secondary" disabled={busy || reason.trim().length < 3} onClick={() => void saveMark(f)}>{t("changes.checks.card.mark", "Mark as known")}</Button>
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => setMarking(null)}>{t("changes.checks.card.cancel", "Cancel")}</Button>
                    </span>
                  ) : (
                    <button type="button" disabled={busy} onClick={() => { setMarking(keyOf(f)); setReason(""); }}
                      className="ml-2 text-[12px] text-ink3 underline underline-offset-2 hover:text-ink disabled:opacity-50">
                      {t("changes.checks.card.knownBefore", "Known before this change")}
                    </button>
                  ))}
                </li>
              ))}
              {failing.length > SHOWN && <li className="text-ink3">{t("changes.checks.card.moreInDetails", "… and {count} more (in Details · the build report)", { count: failing.length - SHOWN })}</li>}
            </ul>
          ) : state.broken ? (
            <p className="text-[13px] text-ink3">{t("changes.checks.card.whichInDetails", "Which checks fail is in Details · the build report.")}</p>
          ) : null}
          {state.next && (
            <p role={working ? "status" : undefined} className={cn("text-[13px] leading-relaxed", asks ? "text-ink" : "text-ink2")}>{nextWords(state.next, policy)}</p>
          )}
          {state.rounds.length > 0 && <Rounds state={state} />}
          {knownList}
          {asks && canRun && (
            <div className="flex flex-wrap items-center gap-3">
              <Button size="sm" variant="secondary" icon={<Undo2 size={14} strokeWidth={1.75} aria-hidden />} disabled={busy} onClick={onRevert}>
                {t("changes.checks.card.revert", "Put development back")}
              </Button>
              {onRecheck && (
                <Button size="sm" variant="secondary" icon={<RotateCcw size={14} strokeWidth={1.75} aria-hidden />} disabled={busy} onClick={onRecheck}>
                  {t("changes.checks.card.recheck", "Run the checks again")}
                </Button>
              )}
              <span className="text-[12px] text-ink3">{t("changes.checks.card.revertHint", "Putting development back takes {what} off it (staging and production are never touched); it can be built again after.", { what })}</span>
            </div>
          )}
          {success && !error && <p role="status" className="text-[13px] text-[rgb(var(--c-success-text))]">{success}</p>}
          {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
        </div>
        {policyControls}
      </Card>
    </section>
  );
}

/** The checks that still fail as they did before the change: never the change's failure, always listed, with why. */
function KnownList({ known, canRun, busy, onUnmark }: { known: KnownLine[]; canRun: boolean; busy?: boolean; onUnmark?: (c: Check) => void }) {
  const t = useT();
  return (
    <div className="mt-3 border-t border-line pt-3">
      <p className="flex items-center gap-1.5 text-[13px] font-medium text-ink">
        <History size={14} strokeWidth={1.75} aria-hidden className="shrink-0 text-ink3" />
        {t("changes.checks.card.knownTitle", "Known before this change: still failing, not this change's")}
      </p>
      <ul aria-label={t("changes.checks.card.knownBefore", "Known before this change")} className="mt-1.5 flex flex-col gap-1.5 text-[13px] leading-relaxed text-ink2">
        {known.slice(0, SHOWN).map((k) => (
          <li key={`${k.repo}:${k.name}`} className="min-w-0 break-words">
            <span className="font-medium text-ink">{k.repo ? `${k.repo} · ` : ""}{k.name}</span>
            {k.reason ? <span> — {k.reason}</span> : null}
            <span className="block text-[12px] text-ink3">
              {k.evidence ? `${k.evidence.charAt(0).toUpperCase()}${k.evidence.slice(1)}.` : ""}
              {canRun && onUnmark && k.mark && (
                <button type="button" disabled={busy} onClick={() => onUnmark({ repo: k.repo, name: k.name })}
                  className="ml-2 underline underline-offset-2 hover:text-ink disabled:opacity-50">
                  {t("changes.checks.card.unmark", "Take the mark back")}
                </button>
              )}
            </span>
          </li>
        ))}
        {known.length > SHOWN && <li className="text-ink3">{t("changes.checks.card.moreInDetails", "… and {count} more (in Details · the build report)", { count: known.length - SHOWN })}</li>}
      </ul>
    </div>
  );
}

function Rounds({ state }: { state: ChangeChecksState }) {
  const t = useT();
  return (
    <ul aria-label={t("changes.checks.card.rounds", "Fix rounds")} className="mt-1 flex flex-col gap-1 text-[12px] text-ink3">
      {state.rounds.map((r) => <li key={r.round}>{roundWords(r)}</li>)}
    </ul>
  );
}

/** A change whose own checks failed, each of them passing since on a later version (changeChecksUi.ts passSince):
 *  usable; its own failed run and where each check passed again stay readable. */
function PassSince({ state, codeOf }: { state: ChangeChecksState; codeOf?: (changeId: string) => string }) {
  const t = useT();
  const p = state.passSince!;
  const own = state.ownRun;
  const by = (changeId: string) => codeOf?.(changeId) ?? "";
  return (
    <div className="flex flex-col gap-1.5 text-[13px] leading-relaxed text-ink2">
      <p className="text-[14px] text-ink">{passSinceLine(p, by(p.changeId))}</p>
      {own && (
        <p>
          {t("changes.checks.card.ownFailed", "Its own checks failed on {where}: {what}.", {
            where: `${own.version || t("changes.checks.card.development", "development")}${own.at ? ` (${formatDateTime(own.at)})` : ""}`,
            what: own.failing.length === 1 ? own.failing[0]!.name : t("changes.checks.card.testFiles", "{count} test files", { count: own.failing.length }),
          })}
          {" "}{p.files.length === 1 ? t("changes.checks.card.passedAgainOne", "It passed again in a later run on development:") : t("changes.checks.card.passedAgainMany", "Each passed again in a later run on development:")}
        </p>
      )}
      <ul className="flex flex-col gap-0.5">
        {p.files.slice(0, SHOWN).map((f) => (
          <li key={`${f.repo}:${f.name}`} className="min-w-0 break-words">
            <span className="text-ink">{f.repo ? `${f.repo} · ` : ""}{f.name}</span> — {t("changes.checks.card.passesSince", "passes since {since}", { since: f.version || formatDateTime(f.at) })}{by(f.changeId) ? ` (${by(f.changeId)})` : ""}
          </li>
        ))}
        {p.files.length > SHOWN && <li className="text-ink3">{t("changes.checks.card.more", "… and {count} more", { count: p.files.length - SHOWN })}</li>}
      </ul>
    </div>
  );
}

/** "Its checks pass on development since 0.15.0 (after CR-015)." (pure). */
export function passSinceLine(p: { version: string; at: string }, by: string): string {
  const since = p.version || formatDateTime(p.at);
  return by ? t("changes.checks.card.passSinceAfter", "Its checks pass on development since {since} (after {by}).", { since, by }) : t("changes.checks.card.passSince", "Its checks pass on development since {since}.", { since });
}
