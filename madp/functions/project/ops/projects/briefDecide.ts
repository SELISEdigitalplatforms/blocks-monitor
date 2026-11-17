/**
 * project.brief.decide — a person's decision on the Project understanding step's brief, kept as ProjectAnswer rows
 * (one row per item; unique per project and QuestionKey), so every web server and the MADP engine read the same
 * decisions from Blocks instead of a folder on one machine (src/domain/briefDecisions.ts has the keys):
 *
 *   requirement  R-xxxxxxxxxx  confirmed | rejected | null (undo)
 *   conflict     C-xxxxxxxxxx  product_manager | null (undo)
 *   confirm      (no key)      confirmed — "Confirm understanding" (who and when: the row's UpdatedByUserId and Text)
 *
 * The web's brief route calls it as the signed-in person after its own checks (the confirm needs every conflict
 * settled, which only the brief knows); people never call it directly from the page.
 */
import { BRIEF_ANSWER_SCHEMA, briefQuestionKey, isBriefDecision, type BriefDecisionKind } from "../../../../src/domain/briefDecisions";
import { ok, strictArgs, type OpDef } from "./op";

interface DecideArgs {
  projectId: string;
  kind: BriefDecisionKind;
  key: string;
  value: string | null;
}

const FIELDS = ["ItemId", "ProjectId", "QuestionKey", "OptionId", "Text", "UpdatedByUserId", "LastUpdatedDate"];

export const projectBriefDecide: OpDef<DecideArgs, any> = {
  op: "project.brief.decide",
  permission: "business.edit",
  scope: "project",
  parse(args) {
    const a = strictArgs(args, {
      projectId: { type: "string", max: 128 },
      kind: { type: "string", max: 20 },
      key: { type: "string", max: 20, optional: true },
      value: { type: "string|null", max: 30 },
    });
    if (!a.ok) return a as never;
    const v = a.value as { projectId: string; kind: string; key?: string; value: string | null };
    const key = v.key ?? "";
    if (!isBriefDecision(v.kind, key, v.value)) return { ok: false, messageKey: "input.wrongType", params: { key: "value" } };
    return { ok: true, value: { projectId: v.projectId, kind: v.kind as BriefDecisionKind, key, value: v.value } };
  },
  async run(env, a) {
    const projectId = env.project!.id;
    const questionKey = briefQuestionKey(a.kind, a.key);
    const [current] = await env.ports.db.query(BRIEF_ANSWER_SCHEMA, { ProjectId: projectId, QuestionKey: questionKey }, { fields: FIELDS, limit: 1 });
    const text = a.kind === "confirm" ? env.nowIso : "";
    if (a.value === null) {
      if (current) await env.ports.db.remove(BRIEF_ANSWER_SCHEMA, String(current.ItemId));
      return ok({ questionKey, value: null });
    }
    if (current) {
      if (current.OptionId !== a.value || a.kind === "confirm") {
        await env.ports.db.update(BRIEF_ANSWER_SCHEMA, String(current.ItemId), env.stampUpdate({ OptionId: a.value, Text: text }));
      }
    } else {
      await env.insertOnce(BRIEF_ANSWER_SCHEMA, { ProjectId: projectId, QuestionKey: questionKey, OptionId: a.value, Text: text }, questionKey);
    }
    return ok({ questionKey, value: a.value });
  },
};
