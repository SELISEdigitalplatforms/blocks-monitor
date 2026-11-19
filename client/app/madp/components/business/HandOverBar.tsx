/** The page's one primary action: "Hand over to product" before the hand-over, "Continue to Product sanitization" after. */
import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Send } from "lucide-react";
import { Banner, Button, Modal } from "@/madp/ui/kit";
import { useRouteProject } from "@/madp/blocks/projects/reads";
import { useMemberName } from "@/madp/blocks/projects/context";
import { useHandOver } from "@/madp/blocks/projects/mutations";
import { messageFor, messageKeyOf } from "@/madp/blocks/projects/messages";
import { useT } from "@/madp/i18n";
import type { ProjectRecord } from "@/madp/blocks/projects/records";
import { useNewSinceHandOver, type DocTreeData } from "@/madp/blocks/projects/docReads";
import { handOverState } from "./businessUi";
import { prefixPath } from "@/madp/lib/pathPrefix";


export function HandOverBar({ project, data, canEdit }: { project: ProjectRecord; data: DocTreeData | undefined; canEdit: boolean }) {
  const t = useT();
  const navigate = useNavigate();
  const route = useRouteProject();
  const handOver = useHandOver();
  const by = useMemberName(project.handedOverByUserId ?? "");
  const since = useNewSinceHandOver(project.id);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const state = handOverState({
    project,
    counts: { notes: data ? data.counts.notes : 0, readyFiles: data ? data.counts.readyFiles : 0 },
    hasScratch: Boolean(data?.scratch),
    canEdit,
    newCount: since.count,
    handedOverByName: project.handedOverByUserId ? by : null,
  });

  const busy = useRef(false);
  const run = async () => {
    if (busy.current) return;
    busy.current = true;
    setError(null);
    try {
      await handOver.run({ projectId: project.id });
      setConfirm(false);
    } catch (e) {
      setConfirm(false);
      if (messageKeyOf(e) === "business.alreadyHandedOver") route.refetch();
      else setError(messageFor(e));
    } finally {
      busy.current = false;
    }
  };

  const reasonId = "hand-over-reason";
  return (
    <div className="mb-6">
      {error && <Banner tone="danger" className="mb-3" title={error} />}
      <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4 sm:gap-y-2">
        {state.mode === "after" ? (
          <>
            <p className="min-w-0 flex-1 text-[14px] text-ink2">{state.summary}</p>
            <Button variant="primary" iconRight={<ArrowRight size={16} strokeWidth={1.75} />}
              onClick={() => navigate(prefixPath(`/p/${project.id}/sanitization`))}>{state.label}</Button>
          </>
        ) : (
          <>
            {state.reason && <p id={reasonId} className="min-w-0 flex-1 text-[13px] text-ink3">{state.reason}</p>}
            <Button variant="primary" className="sm:ml-auto" disabled={state.disabled || handOver.isPending}
              aria-describedby={state.reason ? reasonId : undefined}
              icon={<Send size={16} strokeWidth={1.75} aria-hidden />} onClick={() => setConfirm(true)}>{handOver.isPending ? t("analysis.business.handingOver", "Handing over…") : state.label}</Button>
          </>
        )}
      </div>
      <Modal open={confirm} onClose={() => setConfirm(false)} title={t("analysis.business.handOver", "Hand over to product")}
        footer={(
          <>
            <Button variant="secondary" disabled={handOver.isPending} onClick={() => setConfirm(false)}>{t("analysis.business.cancel", "Cancel")}</Button>
            <Button variant="primary" disabled={handOver.isPending} onClick={() => void run()}>
              {handOver.isPending ? t("analysis.business.handingOver", "Handing over…") : t("analysis.business.handOverShort", "Hand over")}
            </Button>
          </>
        )}>
        <p className="text-[14px] text-ink2">{t("analysis.business.handOverConfirm", "Hand over the business input to Product sanitization? You can keep adding material; new items are marked New since hand-over.")}</p>
      </Modal>
    </div>
  );
}
