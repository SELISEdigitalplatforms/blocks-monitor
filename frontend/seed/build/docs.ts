// Business step: the project's folders, notes (call notes, e-mail threads), the scratch pad and uploaded files.
// Notes and files share one SortOrder sequence per folder (steps of 1024), like the docs ops.
import { storedNameOf } from "../core/files";
import { row, t, type Ctx } from "./ctx";

export async function seedDocs(c: Ctx): Promise<void> {
  const docs = c.plan.docs;
  const order = new Map<string, number>();
  const nextOrder = (folder: string): number => {
    const n = (order.get(folder) ?? 0) + 1024;
    order.set(folder, n);
    return n;
  };

  for (const f of docs.folders) {
    const at = t(c, f.at);
    const id = await row(
      c,
      "DocFolder",
      `folder-${f.key}`,
      { ParentId: f.parent ? c.refs.get(`folder:${f.parent}`) ?? "" : "", Name: f.name, Kind: f.kind, SortOrder: nextOrder(`folders:${f.parent ?? ""}`), Status: "active" },
      { by: f.by, at },
    );
    c.refs.set(`folder:${f.key}`, id);
  }

  if (docs.scratch) {
    const at = t(c, docs.scratch.at);
    await row(c, "DocNote", "note-scratch-pad", { FolderId: "", Title: "Scratch pad", BodyMd: docs.scratch.body, SortOrder: 0, IsScratchPad: true }, { by: docs.scratch.by, at });
  }

  for (const n of docs.notes) {
    const at = t(c, n.at);
    const folderId = n.folder ? c.refs.get(`folder:${n.folder}`) ?? "" : "";
    const id = await row(
      c,
      "DocNote",
      `note-${n.key}`,
      { FolderId: folderId, Title: n.title, BodyMd: n.body, SortOrder: nextOrder(folderId), IsScratchPad: false },
      { by: n.by, at, updatedAt: n.edited ? t(c, n.edited) : at },
    );
    c.refs.set(`note:${n.key}`, id);
  }

  for (const f of docs.files) {
    const at = t(c, f.at);
    const stored = await c.s.file(f.file);
    const folderId = f.folder ? c.refs.get(`folder:${f.folder}`) ?? "" : "";
    const id = await row(
      c,
      "DocFile",
      `file-${f.key}`,
      {
        FolderId: folderId,
        Name: stored.name,
        StoredName: storedNameOf(stored.name, stored.ext),
        Mime: stored.mime,
        SizeBytes: stored.bytes.length,
        StorageObjectId: stored.fileId,
        SortOrder: nextOrder(folderId),
        Status: "ready",
      },
      { by: f.by, at },
    );
    c.refs.set(`file:${f.key}`, id);
  }
}
