/** Which editors on the Requirements page hold unsaved input. Every editor (a tab's form, an objective or a
 *  requirement's acceptance criteria) reports under its own id, so one closing never clears another that is still open:
 *  Confirm stays disabled while any id is in the set. */
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from "react";

type Report = (id: string, editing: boolean) => void;

/** `ids` with `id` added (editing) or removed; the same set when nothing changes, so React skips the render. Pure. */
export function withEditing(ids: ReadonlySet<string>, id: string, editing: boolean): ReadonlySet<string> {
  if (ids.has(id) === editing) return ids;
  const next = new Set(ids);
  if (editing) next.add(id);
  else next.delete(id);
  return next;
}

const EditingReport = createContext<Report | null>(null);

/** Wraps the page's editors so a nested editor (CriteriaEditor) reports itself with `useReportEditing`. */
export const EditingReportProvider = EditingReport.Provider;

/** The page's guard: whether any editor is open, the report function for the provider, and one stable
 *  `onEditingChange` callback per key for the tabs that report through a prop. */
export function useEditingGuard(): { editing: boolean; report: Report; reporter: (key: string) => (editing: boolean) => void } {
  const [ids, setIds] = useState<ReadonlySet<string>>(() => new Set());
  const report = useCallback<Report>((id, editing) => setIds((s) => withEditing(s, id, editing)), []);
  const callbacks = useRef(new Map<string, (editing: boolean) => void>());
  const reporter = useCallback((key: string) => {
    let cb = callbacks.current.get(key);
    if (!cb) {
      cb = (editing: boolean) => report(key, editing);
      callbacks.current.set(key, cb);
    }
    return cb;
  }, [report]);
  return { editing: ids.size > 0, report, reporter };
}

/** Reports this editor to the page guard while it is open and clears it when it closes or unmounts; a no-op outside
 *  an EditingReportProvider. */
export function useReportEditing(editing: boolean): void {
  const report = useContext(EditingReport);
  const id = useId();
  useEffect(() => {
    if (!report || !editing) return;
    report(id, true);
    return () => report(id, false);
  }, [report, id, editing]);
}
