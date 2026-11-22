// Filing: the business agent puts each new document into the folder of its kind (Client documents, Meetings & calls,
// E-mails, Designs & screenshots, Spreadsheets & data), making a folder when the project has none of that name. It
// writes what doc.folder.create and doc.file.move write (the same fields, placement and limits, src/domain/docs.ts),
// files only documents that are not filed yet (at the top level, or in "Client documents" where the Share window puts
// everything), never touches notes (the "Project brief" stays where it is) and never removes anything.
import type { Row } from "../../../../../functions/_lib/gateway";
import { MAX_FOLDERS, checkFolderName, placeBefore } from "../../../../../src/domain/docs";
import { FILING_FOLDERS, FILING_ORDER, filingOf, type FilingKey } from "../../../../../src/domain/setupAgent";
import type { JobRun } from "../../run.ts";
import { num, str } from "../../context.ts";

export interface FilingPlan {
  /** fileId -> where it goes. */
  target: Map<string, FilingKey>;
}

export interface FilingResult {
  outputs: string[];
  /** Documents sorted (moved, or already in the right folder). */
  filed: number;
  /** Folders they are in now. */
  folders: number;
  moved: number;
  created: number;
}

const fold = (s: string): string => s.trim().toLowerCase();

/** The active top-level folder of a name (case and outer spaces ignored). */
export function topFolder(folders: readonly Row[], name: string): Row | undefined {
  return folders.find((f) => str(f.ParentId) === "" && f.Status !== "deleting" && fold(str(f.Name)) === fold(name));
}

/** Which of the new files the agent files, and where (files a person put into a folder of their own stay there). */
export function planFiling(files: readonly Row[], folders: readonly Row[], kindOf: (f: Row) => FilingKey): FilingPlan {
  const client = topFolder(folders, FILING_FOLDERS.client.name);
  const target = new Map<string, FilingKey>();
  for (const f of files) {
    const at = str(f.FolderId);
    if (at !== "" && at !== str(client?.ItemId)) continue;
    target.set(str(f.ItemId), kindOf(f));
  }
  return { target };
}

export const fileKindOf = (f: Row, text = ""): FilingKey => filingOf(str(f.Name), str(f.Mime), text);

export async function fileDocuments(run: JobRun, plan: FilingPlan, onStep?: (i: number, n: number) => Promise<void>): Promise<FilingResult> {
  const outputs: string[] = [];
  const used = new Set<string>();
  let moved = 0;
  let created = 0;
  let filed = 0;
  const keys = FILING_ORDER.filter((k) => [...plan.target.values()].includes(k));
  const folderOf = new Map<FilingKey, string>();
  for (const k of keys) {
    const folders = run.p.rows("DocFolder");
    const have = topFolder(folders, FILING_FOLDERS[k].name);
    if (have) { folderOf.set(k, str(have.ItemId)); continue; }
    if (folders.length >= MAX_FOLDERS) continue;
    const name = checkFolderName(FILING_FOLDERS[k].name);
    if (!name.ok) continue;
    const siblings = folders.filter((f) => str(f.ParentId) === "" && f.Status !== "deleting")
      .map((f) => ({ id: str(f.ItemId), sortOrder: num(f.SortOrder) }))
      .sort((a, b) => a.sortOrder - b.sortOrder);
    const at = placeBefore(siblings, null);
    if (!at.ok) continue;
    for (const r of at.renumber) await run.update("DocFolder", r.id, { SortOrder: r.sortOrder, UpdatedByUserId: run.requester });
    const id = await run.insert("DocFolder", { ParentId: "", Name: name.value, Kind: FILING_FOLDERS[k].kind, SortOrder: at.sortOrder, Status: "active" }, `folder:${k}`);
    folderOf.set(k, id);
    outputs.push(`DocFolder:${id}`);
    created += 1;
    await run.wait(0.6);
  }
  const entries = [...plan.target.entries()];
  for (const [i, [fileId, k]] of entries.entries()) {
    const to = folderOf.get(k);
    const file = run.p.row("DocFile", fileId);
    if (!to || !file || file.Status !== "ready") continue;
    filed += 1;
    used.add(to);
    outputs.push(`DocFile:${fileId}`);
    if (str(file.FolderId) === to) continue;
    const siblings = [...run.p.rows("DocFile"), ...run.p.rows("DocNote")]
      .filter((r) => str(r.FolderId) === to && str(r.ItemId) !== fileId && r.Status !== "deleted")
      .map((r) => ({ id: str(r.ItemId), sortOrder: num(r.SortOrder) }))
      .sort((a, b) => a.sortOrder - b.sortOrder);
    const at = placeBefore(siblings, null);
    if (!at.ok) continue;
    await run.together(async () => {
      for (const r of at.renumber) {
        const schema = run.p.row("DocNote", r.id) ? "DocNote" : "DocFile";
        await run.update(schema, r.id, { SortOrder: r.sortOrder, UpdatedByUserId: run.requester });
      }
      await run.update("DocFile", fileId, { FolderId: to, SortOrder: at.sortOrder, UpdatedByUserId: run.requester });
    });
    moved += 1;
    if (onStep) await onStep(i, entries.length);
    await run.wait(0.45);
  }
  for (const id of used) if (!outputs.includes(`DocFolder:${id}`)) outputs.push(`DocFolder:${id}`);
  return { outputs, filed, folders: used.size, moved, created };
}
