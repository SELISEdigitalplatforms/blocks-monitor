/** Unlock the scope and milestones again (until the build starts). */
import { useState } from "react";
import { queryClient } from "@/blocks/queryClient";
import { cachedScopeVersionStatus, isPendingScopeError, rereadScope, useScopeUnlock } from "@/blocks/scope/mutations";
import type { ScopeContext } from "@/blocks/scope/context";
import { scopeErrorMessage } from "@/blocks/scope/messages";
import { Button, Modal } from "@/ui/kit";
import { LockProgress, useSlowNote } from "./LockDialog";
import { t, useT } from "@/i18n";

/** The body only: the dialog title already asks "Unlock scope vN?". */
export const unlockDialogText = (_n: number): string =>
  t("analysis.scope.unlock.text", "The board plan is cancelled, and the scope and milestones open for changes again.");

/** After a timed-out lock or unlock was re-read: did the write land? Unlock lands when the version reads draft, lock when it reads locked. */
export function pendingOutcome(op: "scope.lock" | "scope.unlock", versionStatus: string | null): "landed" | "notLanded" {
  const want = op === "scope.unlock" ? ["draft", "unlocked"] : ["locked"];
  return versionStatus !== null && want.includes(versionStatus) ? "landed" : "notLanded";
}

export function UnlockDialog({ ctx, open, onClose, onUnlocked, projectId, versionId, versionNumber }: {
  ctx: ScopeContext; open: boolean; onClose: () => void; onUnlocked: () => void; projectId: string; versionId: string; versionNumber: number;
}) {
  const t = useT();
  const unlock = useScopeUnlock(ctx);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const busy = unlock.isPending || checking;
  const slow = useSlowNote(unlock.isPending);
  const close = () => { setError(null); onClose(); };
  const confirm = () => {
    setError(null);
    unlock.mutate({ projectId, scopeVersionId: versionId }, {
      onSuccess: () => { onClose(); onUnlocked(); },
      onError: async (e: unknown) => {
        if (!isPendingScopeError(e)) { setError(scopeErrorMessage(e)); return; }
        setChecking(true);
        try {
          await rereadScope(queryClient, ctx.workspaceId ?? "", "scope.unlock", projectId);
          if (pendingOutcome("scope.unlock", cachedScopeVersionStatus(queryClient, ctx.workspaceId ?? "", versionId)) === "landed") {
            setChecking(false);
            onClose();
            onUnlocked();
            return;
          }
        } catch { /* fall through to the error */ }
        setChecking(false);
        setError(scopeErrorMessage(e));
      },
    });
  };
  return (
    <Modal open={open} onClose={close} title={versionNumber > 1 ? t("analysis.scope.unlock.titleVersion", "Unlock scope version {n}?", { n: versionNumber }) : t("analysis.scope.unlock.title", "Unlock the scope?")}
      footer={<>
        <Button variant="ghost" onClick={close} disabled={checking}>{t("analysis.scope.cancel", "Cancel")}</Button>
        <Button variant="secondary" onClick={confirm} disabled={busy}>{busy ? t("analysis.scope.unlock.unlocking", "Unlocking…") : t("analysis.scope.lock.unlock", "Unlock")}</Button>
      </>}>
      <p className="text-[14px] text-ink2">{unlockDialogText(versionNumber)}</p>
      <LockProgress pending={busy} slow={slow} text={checking ? t("analysis.scope.unlock.checking", "Checking whether the unlock went through…") : t("analysis.scope.unlock.unlockingScope", "Unlocking the scope…")} />
      {error && <p role="alert" className="mt-3 text-[13px] text-danger">{error}</p>}
    </Modal>
  );
}
