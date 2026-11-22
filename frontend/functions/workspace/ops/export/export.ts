// workspace.export: the owner's JSON backup of every workspace record, one budgeted page per call.
// The audit target type is lower-case ("workspace"): the AuditEvent TargetType pattern refuses capitals.
// A view: it reads through the scoped gateway (explicit WorkspaceId filter) and writes one AuditEvent on the first page.
// The cursor (`v1.<schemaIndex>.<gatewayPage>.<offset>`) carries no ids; the workspace always comes from the checked args.
import {
  EXPORT_FORMAT,
  EXPORT_GATEWAY_PAGE_SIZE,
  EXPORT_MIN_REMAINING_MS,
  EXPORT_PAGE_BYTES,
  EXPORT_SCHEMAS,
  EXPORT_START,
  EXPORT_VERSION,
  decodeCursor,
  encodeCursor,
  exportRow,
  fitPage,
  jsonBytes,
  manifestEntries,
  type ExportChunk,
  type ExportFileEntry,
  type ExportPage,
} from "../../../../src/domain/workspaceExport";
import { IMPERSONATION_MESSAGE_KEY } from "../../../../src/domain/security";
import { defineOp, f, v } from "../../../_lib";

/** A single row above this can never fit one 5 MB answer with its envelope. */
export const EXPORT_MAX_ROW_BYTES = 4_500_000;
const ENVELOPE_BYTES = 2_000;

export type WorkspaceExportAnswer = ExportPage & {
  workspace?: { id: string; name: string };
  schemas?: string[];
  exportedAt?: string;
};

export const WORKSPACE_EXPORT_OPS = [
  defineOp({
    op: "workspace.export",
    kind: "view",
    scope: "workspace",
    permission: "workspace.manage",
    args: v.object({ workspaceId: v.id(), cursor: v.optional(v.string({ max: 64 })) }),
    async handler(ctx, args, deps): Promise<WorkspaceExportAnswer> {
      if (ctx.caller.impersonated) deps.fail("forbidden", IMPERSONATION_MESSAGE_KEY);
      const first = !args.cursor;
      const start = first ? EXPORT_START : decodeCursor(args.cursor);
      if (!start) return deps.fail("invalid_input", undefined, { field: "cursor" });
      const workspaceId = String(ctx.workspace?.ItemId ?? "");
      if (!workspaceId) deps.fail("forbidden");

      let name = "";
      if (first) {
        deps.audit({ action: "workspace.exported", targetType: "workspace", targetId: workspaceId });
        name = typeof ctx.workspace?.Name === "string" ? ctx.workspace.Name : "";
      }

      const chunks: ExportChunk[] = [];
      const files: ExportFileEntry[] = [];
      let bytes = ENVELOPE_BYTES;
      let taken = 0;
      let { schemaIndex, gatewayPage, offset } = start;
      let cursor: string | null = null;

      // ONE gateway round per call: the first page of every remaining schema is read in parallel (the cursor's own schema
      // at its gateway page), then the answer is cut at the byte budget in schema order. A page that was not read (the
      // next gateway page of a full schema) ends the call with a cursor, so the client's next call reads it.
      const first0 = schemaIndex;
      const reads = await Promise.all(
        EXPORT_SCHEMAS.slice(first0).map((entry, i) =>
          deps.gw.find(entry.schema, {
            where: f.eq("WorkspaceId", workspaceId),
            fields: entry.fields,
            sort: { field: "CreatedDate", dir: "asc" },
            page: i === 0 ? start.gatewayPage : 1,
            pageSize: EXPORT_GATEWAY_PAGE_SIZE,
          }),
        ),
      );

      while (schemaIndex < EXPORT_SCHEMAS.length) {
        if (taken > 0 && (bytes >= EXPORT_PAGE_BYTES || ctx.remainingMs() < EXPORT_MIN_REMAINING_MS)) {
          cursor = encodeCursor({ schemaIndex, gatewayPage, offset });
          break;
        }
        const entry = EXPORT_SCHEMAS[schemaIndex];
        if (gatewayPage !== (schemaIndex === first0 ? start.gatewayPage : 1)) {
          cursor = encodeCursor({ schemaIndex, gatewayPage, offset });
          break;
        }
        const items = reads[schemaIndex - first0].items;
        const rows = items.map((r) => exportRow(entry.schema, r));
        const manifests = items.map((r) => manifestEntries(entry.schema, r));
        const rowBytes = rows.map((r, i) => jsonBytes(r) + jsonBytes(manifests[i]));
        if (offset < rows.length) {
          if (rowBytes[offset] > EXPORT_MAX_ROW_BYTES) deps.fail("too_large", undefined, { schema: entry.schema });
          const fit = fitPage(rowBytes, offset, EXPORT_PAGE_BYTES - bytes, taken === 0);
          if (fit.taken > 0) {
            const slice = rows.slice(offset, offset + fit.taken);
            const last = chunks[chunks.length - 1];
            if (last && last.schema === entry.schema) last.rows.push(...slice);
            else chunks.push({ schema: entry.schema, rows: slice });
            for (let i = offset; i < offset + fit.taken; i++) files.push(...manifests[i]);
            bytes += fit.bytes;
            taken += fit.taken;
            offset += fit.taken;
          }
          if (offset < rows.length) {
            cursor = encodeCursor({ schemaIndex, gatewayPage, offset });
            break;
          }
        }
        // This gateway page is used up: a full page may have a successor, a short one ends the schema.
        if (items.length >= EXPORT_GATEWAY_PAGE_SIZE) {
          gatewayPage += 1;
        } else {
          schemaIndex += 1;
          gatewayPage = 1;
        }
        offset = 0;
      }

      const data: WorkspaceExportAnswer = { format: EXPORT_FORMAT, version: EXPORT_VERSION, chunks, files, cursor };
      if (first) {
        data.workspace = { id: workspaceId, name };
        data.schemas = EXPORT_SCHEMAS.map((s) => s.schema);
        data.exportedAt = ctx.now.toISOString();
      }
      return data;
    },
  }),
];
