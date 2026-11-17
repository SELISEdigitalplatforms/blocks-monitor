/** Settings → Workspace: the workspace's name. A Workspace admin renames it here (workspace.rename); everyone else reads
 *  it. A saved name is written into the cached workspace lists, so the top-bar switcher and every page change at once. */
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Building2 } from "lucide-react";
import { Button, Card, Input } from "@/ui/kit";
import { renameWorkspace } from "@/blocks/workspaces/ops";
import { currentWorkspace, useWorkspaces } from "@/blocks/workspaces/store";
import { MAX_WORKSPACE_NAME } from "@/domain/tenancy";
import { useCurrentWorkspace, useMe } from "@/state/workspaces";
import { workspaceNameForm } from "./workspaceNameForm";
import { useT } from "@/i18n";

const LABEL = "mb-2 block text-[13px] font-medium text-ink2";

export function WorkspaceNameCard() {
  const ready = useWorkspaces((s) => s.ready);
  const workspace = useCurrentWorkspace();
  const me = useMe();
  if (!workspace) return null;
  // keyed by the workspace: switching workspaces starts a fresh form
  return (
    <WorkspaceNameSection key={workspace.id} ready={ready} permissions={me?.permissions ?? []}
      workspace={{ id: workspace.id, name: workspace.name, status: workspace.status }} />
  );
}

export interface WorkspaceNameSectionProps {
  ready: boolean;
  workspace: { id: string; name: string; status: string };
  /** The signed-in person's permissions in this workspace. */
  permissions: readonly string[];
}

/** `base` is the name the draft started from: it is sent as expectedName, so a rename by someone else is never overwritten unseen. */
type Edit = { base: string; draft: string };

export function WorkspaceNameSection({ ready, workspace, permissions }: WorkspaceNameSectionProps) {
  const t = useT();
  const { id, name: current } = workspace;
  const [edit, setEdit] = useState<Edit>({ base: current, draft: current });
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const inFlight = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);

  // A new saved name (someone else's rename, or a refetch) while the field is untouched: the field follows it.
  useEffect(() => {
    setEdit((e) => (e.draft === e.base ? { base: current, draft: current } : e));
  }, [current]);

  const form = workspaceNameForm({ current, draft: edit.draft, permissions, status: workspace.status, saving });
  const problemId = "workspace-name-problem";
  const noteId = "workspace-name-note";

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (inFlight.current || !form.canSave || form.value === null) return;
    inFlight.current = true;
    setSaving(true);
    setFailure(null);
    setStatus(null);
    try {
      const r = await renameWorkspace({ workspaceId: id, name: form.value, expectedName: edit.base });
      if (r.ok) {
        const saved = r.value.workspace.name;
        setEdit({ base: saved, draft: saved });
        setStatus(t("settings.workspaceName.saved", "Saved. The workspace is now called {name}.", { name: saved }));
      } else {
        setFailure(r.error);
        // The lists were refetched: the next Save is made against the name now shown in the top bar.
        const fresh = r.code === "conflict" ? currentWorkspace(useWorkspaces.getState()) : null;
        if (fresh && fresh.id === id) setEdit((x) => ({ ...x, base: fresh.name }));
      }
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };

  return (
    <div id="workspace" tabIndex={-1} className="scroll-mt-6 outline-none">
      <Card title={t("settings.workspaceName.title", "Workspace")} icon={<Building2 size={18} strokeWidth={1.75} />} bodyClassName="flex flex-col gap-4">
        <p className="max-w-[68ch] text-[14px] text-ink2">
          {t("settings.workspaceName.intro", "The name everyone in this workspace sees, in the top bar and on every page.")}
        </p>
        {!ready ? (
          <div className="h-11 max-w-[520px] animate-pulse rounded-block bg-surface2 motion-reduce:animate-none" role="status" aria-label={t("settings.workspaceName.loading", "Loading the workspace")} />
        ) : form.mode === "edit" ? (
          <form ref={formRef} onSubmit={submit} noValidate className="flex max-w-[520px] flex-col gap-3">
            <div>
              <label htmlFor="workspace-name" className={LABEL}>{t("settings.workspaceName.label", "Workspace name")}</label>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                <Input id="workspace-name" value={edit.draft} maxLength={MAX_WORKSPACE_NAME} autoComplete="off" readOnly={saving}
                  aria-invalid={form.problem ? true : undefined} aria-describedby={form.problem ? problemId : undefined}
                  onChange={(e) => { const draft = e.target.value; setEdit((x) => ({ ...x, draft })); setStatus(null); setFailure(null); }} />
                <Button type="submit" variant="primary" className="shrink-0" disabled={!form.canSave} aria-busy={saving || undefined}>
                  {saving ? t("settings.workspaceName.saving", "Saving…") : t("settings.workspaceName.save", "Save")}
                </Button>
              </div>
              {form.problem && <p id={problemId} className="mt-2 text-[13px] text-danger">{form.problem}</p>}
            </div>
            {failure && <p role="alert" className="text-[13px] text-danger">{failure}</p>}
            {status && <p role="status" className="text-[13px] text-ink2">{status}</p>}
          </form>
        ) : (
          <div>
            <div className={LABEL}>{t("settings.workspaceName.label", "Workspace name")}</div>
            <p className="text-[15px] font-medium [overflow-wrap:anywhere]" aria-describedby={noteId}>{current}</p>
            {/* the same quiet note as the other view-only controls (ViewOnlyNote) */}
            <p id={noteId} className="mt-1.5 text-[12px] text-ink3">{form.readOnlyReason}</p>
          </div>
        )}
      </Card>
    </div>
  );
}
