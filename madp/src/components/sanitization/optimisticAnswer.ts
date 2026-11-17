/** Answers that feel immediate: an answer (or "Not sure" / "Later") shows as given at once and the conversation moves on,
 *  while the write runs behind it. The shared question list is patched in place (every reader of it agrees), the section
 *  lays the same change over the rows until the write settles (a poll that lands first cannot undo it), and a write that
 *  fails puts the question back as it was, with the reason and a way to send it again. The server stays the judge. */
import { createContext, useContext, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { clarificationsOptions } from "@/blocks/sanitization/hooks";
import { useAnswerClarification, useDeferClarification } from "@/blocks/sanitization/ops";
import { sanitizationErrorText } from "@/blocks/sanitization/messages";
import { formatNumber } from "@/domain/numbering";

/** `files`: the files sent with the answer (ready uploads of the answer box and their draft key). */
export type AnswerChange = { kind: "answer"; text: string; files?: { attachmentIds: string[]; draftKey: string } } | { kind: "defer"; reason: string };

/** The fields of a question row an answer changes (the rest is kept as it is). */
export interface AnswerableRow {
  ItemId: string;
  Number: number;
  Status: string;
  Answer?: string | null;
  DeferReason?: string | null;
  AnsweredByUserId?: string | null;
  AnsweredAt?: string | null;
  LastUpdatedDate?: string | null;
}

/** The row as it will be once the write lands (pure): answered with the text, or set aside with the reason. */
export function optimisticRow<R extends AnswerableRow>(row: R, change: AnswerChange, userId: string | null, nowIso: string): R {
  if (change.kind === "answer") {
    return { ...row, Status: "answered", Answer: change.text, DeferReason: null, AnsweredByUserId: userId ?? row.AnsweredByUserId ?? null, AnsweredAt: nowIso };
  }
  return { ...row, Status: "deferred", DeferReason: change.reason };
}

/** Only the fields an answer changes (what a failed write puts back, leaving anything newer in the row alone). */
export function answerFields(row: AnswerableRow): Partial<AnswerableRow> {
  return { Status: row.Status, Answer: row.Answer ?? null, DeferReason: row.DeferReason ?? null, AnsweredByUserId: row.AnsweredByUserId ?? null, AnsweredAt: row.AnsweredAt ?? null };
}

/** The rows with the changes still being written laid over them (pure; the same array when nothing is pending). */
export function withPending<R extends AnswerableRow>(rows: readonly R[], pending: ReadonlyMap<string, R>): readonly R[] {
  if (pending.size === 0) return rows;
  return rows.map((r) => {
    const p = pending.get(r.ItemId);
    return p ? { ...r, ...answerFields(p) } : r;
  });
}

export interface AnswerFailure {
  id: string;
  label: string;
  message: string;
  retry: () => void;
}

export interface OptimisticAnswers {
  submit: (row: AnswerableRow, change: AnswerChange) => void;
  isPending: (id: string) => boolean;
}

export const OptimisticAnswersContext = createContext<OptimisticAnswers | null>(null);
export const useOptimisticAnswersContext = () => useContext(OptimisticAnswersContext);

/** The section's side: the writes live here (the section stays mounted while the composer that started one moves on). */
export function useOptimisticAnswers(ctx: { workspaceId: string; projectId: string }, userId: string | null) {
  const qc = useQueryClient();
  const answer = useAnswerClarification(ctx);
  const defer = useDeferClarification(ctx);
  const inFlight = useRef(new Set<string>());
  const [pending, setPending] = useState<ReadonlyMap<string, AnswerableRow>>(new Map());
  const [failure, setFailure] = useState<AnswerFailure | null>(null);
  const key = clarificationsOptions(ctx).queryKey;
  const patch = (id: string, fields: Partial<AnswerableRow>) =>
    qc.setQueryData<AnswerableRow[]>(key, (rows) => rows?.map((r) => (r.ItemId === id ? { ...r, ...fields } : r)));
  const setPendingRow = (id: string, row: AnswerableRow | null) => setPending((m) => {
    const n = new Map(m);
    if (row) n.set(id, row); else n.delete(id);
    return n;
  });

  const submit = (row: AnswerableRow, change: AnswerChange) => {
    // one write per question at a time (a double click sends once)
    if (inFlight.current.has(row.ItemId)) return;
    inFlight.current.add(row.ItemId);
    const before = { ...row };
    const next = optimisticRow(row, change, userId, new Date().toISOString());
    setFailure((f) => (f?.id === row.ItemId ? null : f));
    setPendingRow(row.ItemId, next);
    patch(row.ItemId, answerFields(next));
    const args = { projectId: ctx.projectId, id: row.ItemId, expectedUpdatedAt: row.LastUpdatedDate ?? undefined };
    void (async () => {
      try {
        // a refetch already under way would land the old row over the patch: stop it, then patch again
        await qc.cancelQueries({ queryKey: key }).catch(() => undefined);
        patch(row.ItemId, answerFields(next));
        if (change.kind === "answer") await answer.mutateAsync({ ...args, answer: change.text, ...(change.files ?? {}) });
        else await defer.mutateAsync({ ...args, reason: change.reason });
      } catch (e) {
        patch(row.ItemId, answerFields(before));
        void qc.invalidateQueries({ queryKey: key });
        setFailure({
          id: row.ItemId,
          label: formatNumber("C", row.Number),
          message: sanitizationErrorText(e),
          retry: () => {
            const latest = qc.getQueryData<AnswerableRow[]>(key)?.find((r) => r.ItemId === row.ItemId);
            submit(latest ?? before, change);
          },
        });
      } finally {
        inFlight.current.delete(row.ItemId);
        setPendingRow(row.ItemId, null);
      }
    })();
  };

  const value: OptimisticAnswers = { submit, isPending: (id) => pending.has(id) };
  return { value, pending, failure, dismiss: () => setFailure(null) };
}
