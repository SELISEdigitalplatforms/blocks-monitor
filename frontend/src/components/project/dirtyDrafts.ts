/** Text the person typed and has not sent yet, per project: the Team panel's composers and the Business Analysis
 *  answer box register here while they hold unsent text, so leaving the project (LeaveProjectDialog) can say so. Only a
 *  flag and a label are kept, never the text. */
import { useEffect, useId, useMemo } from "react";
import { create } from "zustand";

interface Draft { projectId: string; label: string }

export const useDirtyDrafts = create<{ drafts: Readonly<Record<string, Draft>> }>(() => ({ drafts: {} }));

/** While `dirty`, this composer holds unsent text on the project; `label` completes "You have an unsent …"
 *  ("message to your tech lead"). */
export function useDirtyDraft(projectId: string, label: string, dirty: boolean): void {
  const id = useId();
  useEffect(() => {
    if (!dirty || !projectId) return;
    useDirtyDrafts.setState((s) => ({ drafts: { ...s.drafts, [id]: { projectId, label } } }));
    return () => useDirtyDrafts.setState((s) => {
      const drafts = { ...s.drafts };
      delete drafts[id];
      return { drafts };
    });
  }, [id, projectId, label, dirty]);
}

/** The unsent drafts of one project (pure). */
export function draftsOf(drafts: Readonly<Record<string, Draft>>, projectId: string): { id: string; label: string }[] {
  return Object.entries(drafts).filter(([, d]) => d.projectId === projectId).map(([id, d]) => ({ id, label: d.label }));
}

export function useProjectDrafts(projectId: string): { id: string; label: string }[] {
  const drafts = useDirtyDrafts((s) => s.drafts);
  return useMemo(() => draftsOf(drafts, projectId), [drafts, projectId]);
}
