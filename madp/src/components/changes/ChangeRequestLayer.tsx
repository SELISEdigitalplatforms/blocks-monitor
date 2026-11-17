import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { Drawer } from "@/ui/kit";
import { CHANGE_PARAM, crCode } from "@/data/changes";
import { changeParamAction, closeChangeRequest, dismissChangeRequest, parseChangeParam, useChangeUi } from "./changeUi";
import { BlocksChangePanel } from "./BlocksChangePanel";
import { paramDrafts, useBlocksChangeRequests } from "./blocksChanges";
import { isBlocksProjectId } from "@/domain/projects";
import { useT } from "@/i18n";

const QUERY = "(min-width: 768px)";

function useWide() {
  const [wide, setWide] = useState(() => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(QUERY).matches);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(QUERY);
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return wide;
}

/** The one open change request panel: a right drawer on wider screens, a bottom sheet on narrow ones.
 *  The drawer returns focus to whatever opened it when it closes. */
export function ChangeRequestLayer() {
  const id = useParams().id;
  return isBlocksProjectId(id) ? <BlocksLayer projectId={id} /> : null;
}

/** The Blocks drawer: ChangeRequest rows from the Data Gateway, saved through cr.saveDraft / cr.startBuild. */
function BlocksLayer({ projectId }: { projectId: string }) {
  const t = useT();
  const open = useChangeUi((s) => s.open);
  const wide = useWide();
  const rows = useBlocksChangeRequests(projectId).data;
  const draft = open?.draftId ? rows.find((r) => r.id === open.draftId) ?? null : null;
  const ref = open?.target ? `${open.target.type}:${open.target.id}` : "";
  const [params, setParams] = useSearchParams();
  const dismissed = useChangeUi((s) => s.dismissed);
  const param = params.get(CHANGE_PARAM);
  const requests = useMemo(() => paramDrafts(projectId, rows), [projectId, rows]);

  useEffect(() => {
    const a = changeParamAction({ param, projectId, requests, isOpen: !!open, dismissed });
    if (a.open) useChangeUi.setState({ open: a.open });
    if (a.dismissed !== dismissed) useChangeUi.setState({ dismissed: a.dismissed });
    if (a.removeParam) setParams((p) => { const next = new URLSearchParams(p); next.delete(CHANGE_PARAM); return next; }, { replace: true });
  }, [param, projectId, requests, open, dismissed, setParams]);

  useEffect(() => () => closeChangeRequest(), []);

  const close = () => {
    dismissChangeRequest(parseChangeParam(param));
    if (param !== null) setParams((p) => { const next = new URLSearchParams(p); next.delete(CHANGE_PARAM); return next; }, { replace: true });
  };

  return (
    <Drawer open={!!open} onClose={close} width={440} side={wide ? "right" : "bottom"}
      title={draft ? t("changes.layer.title", "{code} · Change request", { code: crCode(draft.number) }) : t("changes.page.title", "Change request")}>
      {open && <BlocksChangePanel key={open.draftId ?? `${open.lane}${ref}`} projectId={projectId} />}
    </Drawer>
  );
}
