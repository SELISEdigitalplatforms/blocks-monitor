/** Create a workspace, then open it. The two steps can fail apart: when the create worked but the switch did not, a
 *  retry with the same name only opens the workspace made the first time, so pressing Create again never makes a twin. */
import { switchWorkspace } from "@/madp/blocks/workspaces/sync";
import { createWorkspace } from "@/madp/blocks/workspaces/ops";
import { t } from "@/madp/i18n";

export type CreatedWorkspace = { name: string; id: string } | null;

/** Where a person lands right after creating a workspace: one landing for the switcher and the empty state. */
export const AFTER_CREATE_PATH = "/dashboard";

export async function createAndOpenWorkspace(
  name: string,
  created: { current: CreatedWorkspace },
): Promise<{ ok: true } | { ok: false; error: string }> {
  let id = created.current?.name === name ? created.current.id : null;
  if (!id) {
    const r = await createWorkspace(name);
    if (!r.ok) return { ok: false, error: r.error };
    id = r.value.workspace.ItemId;
    created.current = { name, id };
  }
  const s = await switchWorkspace(id);
  if (!s.ok) return { ok: false, error: t("shell.workspace.createdNotOpened", "{name} was created, but it could not be opened yet. {error} Try again to open it.", { name, error: s.error }) };
  created.current = null;
  return { ok: true };
}
