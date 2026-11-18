/** Opens Share material from anywhere: `openSetupWindow("share", projectId)`, or the address `?setup=share`
 *  on a project page. Mounted with the app shell. Retired setup windows are not accepted. */
import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { create } from "zustand";
import { useProject } from "@/madp/blocks/projects/reads";
import { ShareMaterialWindow } from "./ShareMaterialWindow";

export type SetupWindowKind = "share";
const KINDS: readonly SetupWindowKind[] = ["share"];
const isKind = (v: unknown): v is SetupWindowKind => (KINDS as readonly unknown[]).includes(v);

interface OpenState { kind: SetupWindowKind | null; projectId: string | null }
export const useSetupWindows = create<OpenState>(() => ({ kind: null, projectId: null }));

export function openSetupWindow(kind: SetupWindowKind, projectId: string): void {
  useSetupWindows.setState({ kind, projectId });
}

export function closeSetupWindow(): void {
  useSetupWindows.setState({ kind: null, projectId: null });
}

const projectIdOf = (path: string): string => /^\/p\/([^/]+)/.exec(path)?.[1] ?? "";

export function SetupWindowsHost() {
  const location = useLocation();
  const navigate = useNavigate();
  const kind = useSetupWindows((s) => s.kind);
  const openFor = useSetupWindows((s) => s.projectId);
  const routeId = projectIdOf(location.pathname);
  const param = new URLSearchParams(location.search).get("setup");

  // ?setup=<kind> on a project page opens that window
  useEffect(() => {
    if (routeId && isKind(param)) openSetupWindow(param, routeId);
  }, [routeId, param]);

  const projectId = openFor ?? "";
  const project = useProject(projectId || null).data ?? null;
  if (!kind || !project) return null;

  const close = () => {
    closeSetupWindow();
    if (param) {
      const q = new URLSearchParams(location.search);
      q.delete("setup");
      const s = q.toString();
      navigate({ pathname: location.pathname, search: s ? `?${s}` : "" }, { replace: true });
    }
  };
  if (kind === "share") return <ShareMaterialWindow project={project} open onClose={close} />;
  return null;
}
