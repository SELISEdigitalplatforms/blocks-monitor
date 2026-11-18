/** The leave guard of the open project page, mounted with the project switcher. It reads what is unfinished there only
 *  while a menu that can leave the project is open or a switch waits for its answer. The reads and the dialog load with
 *  that first menu (they share the Business Analysis page's and the Team panel's code), so the shell's first load stays
 *  as it was. */
import { lazy, Suspense } from "react";
import { useLeaveGuard, useLeaveGuardHost } from "./leaveGuardStore";

const LeaveProbe = lazy(() => import("./LeaveProjectDialog").then((m) => ({ default: m.LeaveProbe })));

export function LeaveGuardHost({ projectId, projectName }: { projectId: string; projectName: string }) {
  useLeaveGuardHost();
  const request = useLeaveGuard((s) => s.request);
  const warm = useLeaveGuard((s) => s.warm > 0);
  if (!request && !warm) return null;
  return (
    <Suspense fallback={null}>
      <LeaveProbe projectId={projectId} projectName={projectName} request={request} />
    </Suspense>
  );
}
