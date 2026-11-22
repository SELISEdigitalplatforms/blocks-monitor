/**
 * Per item type: which schema and fields a share link reads, when the row may be shown, and its public display
 * draft. Plain strings only; never user ids, emails, storage ids or other rows' data. Pure apart from the one find.
 */
import { f, type Filter } from "../../../_lib/filter";
import type { Row } from "../../../_lib/gateway";
import { safeOutboundUrl, type PublicShareItemDraft, type ShareLinkItemType } from "./contract";

export interface ItemReader {
  find(schema: string, q: { where: Filter; fields: string[]; page: number; pageSize: number }): Promise<{ items: Row[] }>;
}

const MAX_TITLE = 300;
const MAX_DESCRIPTION = 2000;
const MAX_BODY = 100000;

function cut(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

function str(row: Row, k: string): string {
  const v = row[k];
  return typeof v === "string" ? v : "";
}

function int(row: Row, k: string): number {
  const v = row[k];
  return typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.trunc(v)) : 0;
}

interface Mapped {
  item: PublicShareItemDraft;
  fileId: string | null;
}

interface ItemSource {
  schema: string;
  fields: readonly string[];
  ready(row: Row): boolean;
  toPublic(row: Row): Mapped | null;
}

function textItem(
  itemType: ShareLinkItemType,
  title: string,
  body: string,
  format: "plain" | "markdown",
  description?: string,
): Mapped {
  const item: PublicShareItemDraft = {
    itemType,
    kind: "text",
    title: cut(title, MAX_TITLE),
    text: { body: cut(body, MAX_BODY), format },
  };
  if (description) item.description = cut(description, MAX_DESCRIPTION);
  return { item, fileId: null };
}

function fileItem(itemType: ShareLinkItemType, name: string, mime: string, sizeBytes: number, fileId: string, description?: string): Mapped {
  const item: PublicShareItemDraft = {
    itemType,
    kind: "file",
    title: cut(name, MAX_TITLE),
    file: { name: cut(name, MAX_TITLE), mime: cut(mime, 255), sizeBytes },
  };
  if (description) item.description = cut(description, MAX_DESCRIPTION);
  return { item, fileId };
}

function linkItem(itemType: ShareLinkItemType, title: string, rawUrl: string): Mapped | null {
  const safe = safeOutboundUrl(rawUrl);
  if (!safe) return null;
  return { item: { itemType, kind: "link", title: cut(title || safe.host, MAX_TITLE), link: safe }, fileId: null };
}

/** An attachment's external link lives in its Meta JSON as "url". */
function attachmentUrl(row: Row): string {
  try {
    const meta = JSON.parse(str(row, "Meta") || "{}") as unknown;
    if (meta && typeof meta === "object" && typeof (meta as Record<string, unknown>).url === "string") {
      return (meta as Record<string, string>).url;
    }
  } catch {
    // not JSON: no link
  }
  return "";
}

const ATTACHMENT_FIELDS = ["FileId", "FileName", "Mime", "SizeBytes", "Meta", "Status"] as const;

function attachmentSource(itemType: ShareLinkItemType): ItemSource {
  return {
    schema: "Attachment",
    fields: ATTACHMENT_FIELDS,
    ready(row) {
      if (str(row, "FileId") !== "") return str(row, "Status") === "ready";
      return safeOutboundUrl(attachmentUrl(row)) !== null;
    },
    toPublic(row) {
      const fileId = str(row, "FileId");
      const name = str(row, "FileName");
      if (fileId !== "") {
        if (str(row, "Status") !== "ready") return null;
        return fileItem(itemType, name || "Attachment", str(row, "Mime"), int(row, "SizeBytes"), fileId);
      }
      return linkItem(itemType, name, attachmentUrl(row));
    },
  };
}

export const ITEM_SOURCES: Readonly<Record<ShareLinkItemType, ItemSource>> = {
  "doc.file": {
    schema: "DocFile",
    fields: ["Name", "Mime", "SizeBytes", "StorageObjectId", "Status"],
    ready: (row) => str(row, "Status") === "ready" && str(row, "StorageObjectId") !== "",
    toPublic(row) {
      const id = str(row, "StorageObjectId");
      if (str(row, "Status") !== "ready" || id === "") return null;
      return fileItem("doc.file", str(row, "Name") || "File", str(row, "Mime"), int(row, "SizeBytes"), id);
    },
  },
  "doc.note": {
    schema: "DocNote",
    fields: ["Title", "BodyMd"],
    ready: () => true,
    toPublic: (row) => textItem("doc.note", str(row, "Title") || "Note", str(row, "BodyMd"), "markdown"),
  },
  "design.screen": {
    schema: "DesignScreen",
    fields: ["Name", "ImageFileId"],
    ready: () => true,
    toPublic(row) {
      const name = str(row, "Name") || "Screen";
      const image = str(row, "ImageFileId");
      if (image !== "") return fileItem("design.screen", name, str(row, "Mime"), int(row, "SizeBytes"), image);
      return textItem("design.screen", name, "", "plain");
    },
  },
  attachment: attachmentSource("attachment"),
  "wiki.page": {
    schema: "WikiPage",
    fields: ["Title", "BodyMd"],
    ready: () => true,
    toPublic: (row) => textItem("wiki.page", str(row, "Title") || "Wiki page", str(row, "BodyMd"), "markdown"),
  },
  "change.request": {
    schema: "ChangeRequest",
    fields: ["Title", "Description"],
    ready: () => true,
    toPublic: (row) => textItem("change.request", str(row, "Title") || "Change request", str(row, "Description"), "plain"),
  },
  // The share's ItemRef is the Attachment row of the change request's attachment.
  "change.attachment": attachmentSource("change.attachment"),
  "release.preview": {
    schema: "Preview",
    fields: ["Url", "Environment", "Version", "Status"],
    ready: (row) => str(row, "Status") === "ready" && safeOutboundUrl(str(row, "Url")) !== null,
    toPublic(row) {
      if (str(row, "Status") !== "ready") return null;
      const version = str(row, "Version");
      return linkItem("release.preview", version ? `Release preview ${version}` : "Release preview", str(row, "Url"));
    },
  },
  scope: {
    schema: "ScopeVersion",
    fields: ["Title", "Summary"],
    ready: () => true,
    toPublic: (row) => textItem("scope", str(row, "Title") || "Scope", str(row, "Summary"), "plain"),
  },
};

/** One find, pageSize 1: the row of this project (and workspace when given), or null when missing or not ready. */
export async function readSharedItem(
  gw: ItemReader,
  q: { itemType: ShareLinkItemType; itemRef: string; projectId: string; workspaceId?: string },
): Promise<Row | null> {
  const src = ITEM_SOURCES[q.itemType];
  const parts = [f.eq("ItemId", q.itemRef), f.eq("ProjectId", q.projectId)];
  if (q.workspaceId) parts.push(f.eq("WorkspaceId", q.workspaceId));
  const res = await gw.find(src.schema, { where: f.and(...parts), fields: ["ItemId", ...src.fields], page: 1, pageSize: 1 });
  const row = res.items[0];
  if (!row || !src.ready(row)) return null;
  return row;
}

export function publicItemOf(itemType: ShareLinkItemType, row: Row): Mapped | null {
  return ITEM_SOURCES[itemType].toPublic(row);
}
