import { create } from "zustand";
import { parseShellContext, type BlocksShellContext } from "./protocol";

export const useShellContext = create<{ context: BlocksShellContext | null }>(() => ({ context: null }));

export function startShellBridge(): () => void {
  const receive = (event: MessageEvent) => {
    if (event.origin !== window.location.origin || event.source !== window.parent || window.parent === window) return;
    const context = parseShellContext(event.data);
    if (context) {
      document.documentElement.dataset.blocksTenant = context.project.tenantId;
      useShellContext.setState({ context });
    }
  };
  window.addEventListener("message", receive);
  if (window.parent !== window) window.parent.postMessage({ type: "madp:ready", version: 1 }, window.location.origin);
  return () => window.removeEventListener("message", receive);
}
