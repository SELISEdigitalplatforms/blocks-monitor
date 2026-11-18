import { parseFeatureRef, workspaceRoleOf, type Lane } from "@/madp/data/changes";
import { useParams } from "react-router-dom";
import { isBlocksProjectId } from "@/madp/domain/projects";
import { useBlocksChangeAccess } from "./blocksChanges";
import { closeChangeRequest, dismissChangeRequest, parseChangeParam, useChangeUi, type ChangeOpen, type ChangeTarget } from "./changeUiState";

export { closeChangeRequest, dismissChangeRequest, parseChangeParam, useChangeUi };
export type { ChangeTarget };

export type WorkspaceRole = ReturnType<typeof workspaceRoleOf>;

export interface ParamDraft { id: string; projectId: string; number: number; status: string; lane?: Lane; featureRef?: string }

/** What the ?change=<number> parameter asks for, given the project's requests, whether a panel is open and the dismissed number. */
export function changeParamAction(p: {
  param: string | null; projectId: string | null; requests: ParamDraft[]; isOpen: boolean; dismissed: number | null;
}): { open: ChangeOpen | null; dismissed: number | null; removeParam: boolean } {
  if (p.param === null) return { open: null, dismissed: null, removeParam: false };
  const n = parseChangeParam(p.param);
  const draft = n === null ? null : p.requests.find((r) => r.projectId === p.projectId && r.number === n && r.status === "draft") ?? null;
  if (!draft) return { open: null, dismissed: p.dismissed, removeParam: true };
  if (p.isOpen || n === p.dismissed) return { open: null, dismissed: p.dismissed, removeParam: false };
  const lane = draft.lane ?? "change";
  const parsed = lane !== "add" && draft.featureRef ? parseFeatureRef(draft.featureRef) : null;
  const target = parsed ? { type: parsed.type, id: parsed.id, title: "", text: "" } : null;
  return { open: { lane, target, origin: target, draftId: draft.id }, dismissed: p.dismissed, removeParam: false };
}

/** Opens the change request panel. Blocks change requests are server records, so there is no local draft to reopen. */
export function openChangeRequest(p: { lane: Lane; target: ChangeTarget | null }) {
  useChangeUi.setState({ open: { lane: p.lane, target: p.target, origin: p.target, draftId: null } });
}

/** Whether change requests exist yet (the project has a dev release) and what the signed-in role may do with them. */
export function useChangeAccess(): { available: boolean; canRun: boolean; role: WorkspaceRole } {
  const id = useParams().id;
  const blocks = useBlocksChangeAccess(id);
  if (isBlocksProjectId(id)) return { available: blocks.available, canRun: blocks.canRun, role: blocks.role === "viewer" ? "viewer" : "member" };
  return { available: false, canRun: false, role: "viewer" };
}
