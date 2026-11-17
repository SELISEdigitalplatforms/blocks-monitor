// Stored rows -> the pure records src/domain/assistant.ts answers from, plus the insert helpers of the assistant ops.
import { f } from "../../../_lib";
import type { OpDeps, Row } from "../../../_lib";
import type { AssistantRecords } from "../../../../src/domain/assistant";
import type { FactsRows } from "../common/loaders";
import { FIELDS, SCHEMA, num, rowsOf, str, strs } from "../common/records";

const dateOf = (row: Row, k: string): string => {
  const x = row[k];
  if (typeof x === "string") return x;
  if (x instanceof Date && !Number.isNaN(x.getTime())) return x.toISOString();
  return "";
};

const refKey = (ref: string): string => (ref.startsWith("feature:") ? ref.slice("feature:".length) : ref);

export function toAssistantRecords(rows: FactsRows): AssistantRecords {
  const features = rows.features.map((r) => ({ id: str(r, "ItemId"), key: str(r, "Key"), title: str(r, "Title") }));
  const byKey = new Map(features.map((x) => [x.key, x.id]));
  return {
    projectName: str(rows.project, "Name"),
    releases: rows.releases
      .filter((r) => str(r, "Status") === "released")
      .map((r) => ({
        environment: str(r, "Environment"),
        version: str(r, "Version"),
        releasedAt: dateOf(r, "ReleasedAt"),
        changeRequestIds: strs(r, "ChangeRequestIds"),
      })),
    changeRequests: rows.changeRequests.map((r) => ({
      id: str(r, "ItemId"),
      number: num(r, "Number"),
      lane: str(r, "Lane"),
      title: str(r, "Title"),
      status: str(r, "Status"),
      version: str(r, "Version"),
    })),
    tickets: rows.tickets.map((r) => ({ column: str(r, "Column"), ticketType: str(r, "TicketType"), title: str(r, "Title") })),
    features: features.map((x) => ({ id: x.id, ref: `feature:${x.key}`, title: x.title })),
    stories: rows.stories.map((r) => ({
      featureId: byKey.get(refKey(str(r, "FeatureRef"))) ?? str(r, "FeatureRef"),
      title: str(r, "Title"),
    })),
  };
}

/** Insert one row under a per-command key. The insert answers the row's id (also for a repeat of the command): no read-back unless it does not. */
export async function insertOnce(deps: OpDeps, row: Row, key: string): Promise<Row> {
  const res = await deps.gw.insert(SCHEMA.assistant, row, { key });
  if (res.itemId) return { ...row, ItemId: res.itemId };
  const back = rowsOf(
    await deps.gw.find(SCHEMA.assistant, { where: f.eq("RequestKey", deps.ids.local(key)), fields: FIELDS.assistant, page: 1, pageSize: 1 }),
  )[0];
  return back ?? deps.fail("conflict");
}

export const assistantRow = (projectId: string, environment: string, role: "user" | "assistant", text: string, at: string, extra: Row = {}): Row => ({
  ProjectId: projectId,
  Environment: environment,
  Role: role,
  Kind: "text",
  Text: text,
  Points: [],
  RefsJson: "[]",
  AttachmentsJson: "[]",
  FixState: "none",
  At: at,
  ...extra,
});
