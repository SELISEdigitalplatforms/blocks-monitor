/** scope.open for Business Analysis: the Scope & success step's own entry op (functions/project/ops/scope/open.ts),
 *  sent once per project while the page is open and the project has reached Scope & success, exactly as the former
 *  Scope page sends it on entry (components/scope/blocks/BlocksScopeView.tsx). It queues the business analyst's
 *  scope.draft job (features, user stories and milestones drafted from the approved requirements) and repairs an
 *  interrupted lock or unlock. Without it the scope of a project approved on this page was never drafted. */
import { useEffect, useRef } from "react";
import { useMutation, useMutationState } from "@tanstack/react-query";
import { scopeMutationOptions, type ScopeOpenAnswer, type ScopeOpenArgs } from "@/blocks/scope/mutations";
import { scopeErrorMessage } from "@/blocks/scope/messages";
import { stepIndex, type JourneyStep } from "@/domain/journey";

export const scopeOpenKey = (projectId: string) => ["analysis", "scope.open", projectId] as const;

/** True when the page should send scope.open now: the project is at Scope & success or past it (the op only repairs
 *  there), the workspace is known, and it was not sent for this project yet on this page (pure). */
export function shouldOpenScope(o: { projectId: string; workspaceId: string | null; step: JourneyStep | null; sentFor: string | null }): boolean {
  if (!o.projectId || !o.workspaceId || !o.step || o.sentFor === o.projectId) return false;
  return stepIndex(o.step) >= stepIndex("scope");
}

/** Sends scope.open once per project when the step is reached (also when the requirements are approved on this page). */
export function useOpenScopeOnEntry({ projectId, workspaceId, step }: { projectId: string; workspaceId: string | null; step: JourneyStep | null }): void {
  const open = useMutation({
    ...scopeMutationOptions<ScopeOpenArgs, ScopeOpenAnswer>(workspaceId ?? "", "scope.open"),
    mutationKey: scopeOpenKey(projectId),
  });
  const sentFor = useRef<string | null>(null);
  useEffect(() => {
    if (!shouldOpenScope({ projectId, workspaceId, step, sentFor: sentFor.current })) return;
    sentFor.current = projectId;
    open.mutate({ projectId });
  }, [projectId, workspaceId, step]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** The plain message of this page's last scope.open that failed (null: none failed, or a later one went through). */
export function useScopeOpenError(projectId: string): string | null {
  const states = useMutationState<{ status: string; error: unknown }>({
    filters: { mutationKey: scopeOpenKey(projectId) },
    select: (m) => ({ status: m.state.status, error: m.state.error }),
  });
  const last = states[states.length - 1];
  return last && last.status === "error" ? scopeErrorMessage(last.error) : null;
}
