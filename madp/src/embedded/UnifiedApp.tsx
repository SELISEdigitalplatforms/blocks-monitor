import { Component, useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { LucideProvider } from "lucide-react";
import { claimCacheFor } from "@/blocks/queryClient";
import { bindShellSessionRefresh, useSession } from "@/blocks/session";
import { useWorkspaces } from "@/blocks/workspaces/store";
import { bindTokenSource } from "@/blocks/client";
import { useDemo } from "@/state/store";
import { Banner, Button } from "@/ui/kit";
import { ToastHost } from "@/ui/Toast";
import { ProjectWorkspace } from "./ProjectWorkspace";
import { useShellContext } from "./context";
import { navigateBlocks } from "./protocol";
import { parseShellBootstrap, type ShellBootstrap as Bootstrap } from "./bootstrapContract";

export async function bootstrapShell(expectedTenant: string): Promise<Bootstrap> {
  const response = await fetch("/api/shell/bootstrap", { credentials: "same-origin", headers: { "X-Madp-Expected-Tenant": expectedTenant } });
  if (!response.ok) throw new Error(response.status === 401 ? "Your Blocks session could not be verified. Return to Blocks and sign in again." : response.status === 409 ? "The Blocks project changed in another window. Reopen this project from Blocks." : "The MADP workspace could not be opened. Try again in a moment.");
  const data = parseShellBootstrap(await response.json(), expectedTenant);
  if (!data) {
    throw new Error("The MADP workspace did not match the selected Blocks project. Reopen the project from Blocks.");
  }
  return data;
}

function accept(data: Bootstrap) {
  claimCacheFor(data.profile.userId);
  useSession.setState({ status: "signed-in", profile: data.profile, notice: null });
  useWorkspaces.setState({ ready: true, workspaceId: data.workspace.id, userId: data.profile.userId, email: data.profile.email, isSuperAdmin: false,
    workspaces: [data.workspace], me: data.member, members: [data.member], team: [data.member], customRoles: [data.customRole], platformPermissions: [],
    bootstrapPending: false, bootstrapError: null, loadError: null });
}
async function refreshShell() {
  const tenant = useShellContext.getState().context?.project.tenantId;
  if (!tenant) return undefined;
  try { accept(await bootstrapShell(tenant)); } catch { /* The shell retains control of authentication. */ }
  return undefined;
}
bindTokenSource({ accessToken: () => undefined, onUnauthorized: refreshShell });
bindShellSessionRefresh(refreshShell);

class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <div className="p-6"><Banner tone="danger" title="MADP could not open this view."
    action={<Button onClick={() => window.location.reload()}>Reload workspace</Button>} /></div> : this.props.children; }
}

export function UnifiedApp() {
  const context = useShellContext((s) => s.context);
  const [accepted, setAccepted] = useState<Bootstrap | null>(null);
  const bootstrap = useQuery({ queryKey: ["blocks-shell", context?.project.tenantId],
    queryFn: () => bootstrapShell(context!.project.tenantId), enabled: Boolean(context), retry: false, staleTime: 0, refetchInterval: 60_000 });
  useEffect(() => {
    if (!context) return;
    document.documentElement.dataset.theme = context.theme;
    useDemo.setState({ theme: context.theme });
  }, [context?.theme]);
  useEffect(() => {
    if (!bootstrap.data || !context || bootstrap.data.tenantId.toLowerCase() !== context.project.tenantId.toLowerCase()) return;
    accept(bootstrap.data);
    setAccepted(bootstrap.data);
  }, [bootstrap.data, context?.project.tenantId]);
  const current = context && accepted?.tenantId.toLowerCase() === context.project.tenantId.toLowerCase() ? accepted : null;
  return <LucideProvider><Boundary><div className="madp-embedded bg-canvas text-ink">
    {!context ? <div role="status" className="p-6 text-ink2">Waiting for the selected Blocks project…</div> : <>
      <header className="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-6 py-3">
        <div className="min-w-0 flex-1"><div className="text-[13px] text-ink3">MADP · {context.project.environment}</div>
          <div className="truncate text-[16px] font-medium">{context.project.name}</div></div>
        <Button size="sm" variant="ghost" onClick={() => navigateBlocks("projects")}>Blocks projects</Button>
        <Button size="sm" variant="secondary" onClick={() => navigateBlocks("repositories")}>Repositories</Button>
      </header>
      {bootstrap.isError ? <div className="p-6"><Banner tone="danger" title={bootstrap.error instanceof Error ? bootstrap.error.message : "The workspace could not be opened."}
        action={<Button variant="secondary" onClick={() => void bootstrap.refetch()}>Try again</Button>} /></div>
        : !current ? <div role="status" className="p-6 text-[14px] text-ink2">Opening your Blocks project workspace…</div>
        : <ProjectWorkspace key={`${current.profile.userId}:${current.project.id}`} project={current.project} />}
    </>}
    <ToastHost />
  </div></Boundary></LucideProvider>;
}
