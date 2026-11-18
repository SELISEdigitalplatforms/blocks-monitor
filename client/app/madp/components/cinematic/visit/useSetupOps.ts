/** The office's Project Setup writes, wired to the app's own hooks and pipelines (the same ones the New project dialog,
 *  the Share material window and the Start project analysis window use):
 *   - create: useCreateProjectOnce with the guided start's arguments (toCreateArgs), keyed by the request id;
 *   - upload: the "Client documents" folder (found, or created once) and the upload pipeline per file, then the business
 *     agent is woken to read what nobody has read yet (project.setup.agent.wake, as Project setup does when it opens);
 *   - handOver: business.handOver (one that already happened counts as done), then the brief is built, exactly as the
 *     Start project analysis window does it. */
import { useMemo, useRef } from "react";
import { newRequestId } from "@/madp/blocks/fn";
import { useProjectsContext } from "@/madp/blocks/projects";
import { messageFor, messageKeyOf } from "@/madp/blocks/projects/messages";
import { useCreateProjectOnce, useHandOver } from "@/madp/blocks/projects/mutations";
import type { DocTreeData } from "@/madp/blocks/projects/docReads";
import { toCreateArgs } from "@/madp/domain/guidedStart";
import { CLIENT_DOCS_FOLDER, findTopFolder } from "@/madp/components/setup/shareModel";
import * as real from "../journey/real";
import type { SetupOps } from "./setupTalk";

const ALREADY = "business.alreadyHandedOver";

export function useSetupOps(tree: DocTreeData | undefined): SetupOps {
  const ctx = useProjectsContext();
  const { create } = useCreateProjectOnce();
  const handOver = useHandOver();
  const latest = useRef({ ws: ctx.workspaceId ?? "", tree, create, handOver });
  latest.current = { ws: ctx.workspaceId ?? "", tree, create, handOver };
  // one folder request per project and visit (a second batch of files finds the folder the first one made)
  const folders = useRef(new Map<string, Promise<string>>());

  return useMemo<SetupOps>(() => ({
    newRequestId,
    message: messageFor,

    create: async (answers, login, requestId) => {
      const r = await latest.current.create(toCreateArgs(answers, login), requestId);
      return r.project.id;
    },

    upload: async (projectId, files, onRow) => {
      const { ws, tree: t } = latest.current;
      let folder = folders.current.get(projectId);
      if (!folder) {
        const found = t ? findTopFolder(t.folders, CLIENT_DOCS_FOLDER) : null;
        folder = found ? Promise.resolve(found) : real.clientDocsFolder(ws, projectId, newRequestId());
        folders.current.set(projectId, folder);
        folder.catch(() => folders.current.delete(projectId));
      }
      const folderId = await folder;
      let used = t?.counts.usedBytes ?? 0;
      let count = t?.counts.files ?? 0;
      let filed = 0;
      const failed: { name: string; message: string }[] = [];
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const problem = await real.uploadFile(ws, { projectId, folderId, file: f, usedBytes: used, fileCount: count }, (phase) => onRow(i, { phase }));
        if (problem === null) {
          filed++;
          used += f.size;
          count++;
          onRow(i, { phase: "done" });
        } else {
          failed.push({ name: f.name, message: problem });
          onRow(i, { phase: "failed", message: problem });
        }
      }
      if (filed > 0) await real.wakeAgent(ws, projectId);
      return { filed, failed };
    },

    handOver: async (projectId) => {
      try {
        await latest.current.handOver.run({ projectId });
      } catch (e) {
        if (messageKeyOf(e) !== ALREADY) throw e;
      }
      // the brief is built from the extracted files (fire and forget; Business Analysis shows its state)
      fetch(`/api/brief/${encodeURIComponent(projectId.toUpperCase())}/build`, { method: "POST" }).catch(() => undefined);
    },
  }), []);
}
