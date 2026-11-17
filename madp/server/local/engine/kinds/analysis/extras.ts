// The Requirements document's other lists in the product manager's draft: the key workflows, what is not included and
// the constraints. They come from the project's setup answers (src/domain/requirementsExtras.ts) and from the material
// and the answers as Claude read them with the objective (ai.ts acceptExtras). Written once, when the project has no
// such rows yet: the setup's items under the same RequestKeys the requirements ops import them with (so the draft and
// a person's first edit can never write them twice), Claude's after them (Origin "engine", one stable RequestKey per
// kind and place, so a retried or refreshed draft never writes them twice either). Per list: a list that has rows
// (people edited it, or an earlier draft wrote it) is left as it is; an empty one is still filled. The material's own
// out-of-scope list (outOfScopeItems) fills "Not included" when Claude's answer leaves it empty.
import { detailsFromRow, oneLine } from "../../../../../src/domain/setupDetails";
import { EXTRA_SCHEMA, extrasFromSetup, isExtraKind, type ExtraInput, type ExtraKind } from "../../../../../src/domain/requirementsExtras";
import { STAGED } from "../../ai/check.ts";
import type { JobRun } from "../../run.ts";
import { similar } from "./own.ts";

type Planned = ExtraInput & { at: number; origin: "setup" | "engine" };

const flat = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
/** Two items say the same thing: the same words, or most of their meaningful words (short titles need the first). */
export const sameItem = (a: string, b: string): boolean => flat(a) === flat(b) || similar(a, b, 0.7);

/** The items to write: the setup's first, then Claude's that the setup does not say already, numbered per kind; only
 *  for the lists that have no rows yet (a row of unknown kind keeps them all). */
export function plannedExtras(run: Pick<JobRun, "p">, fromAi: readonly ExtraInput[] = []): Planned[] {
  const rows = run.p.rows(EXTRA_SCHEMA);
  const has = new Set<string>(rows.map((r) => (isExtraKind(r.Kind) ? r.Kind : "*")));
  if (has.has("*")) return [];
  const n: Record<ExtraKind, number> = { workflow: 0, exclusion: 0, constraint: 0 };
  const out: Planned[] = [];
  for (const e of extrasFromSetup(detailsFromRow(run.p.project))) {
    if (has.has(e.kind)) continue;
    n[e.kind] += 1;
    out.push({ ...e, at: n[e.kind], origin: "setup" });
  }
  for (const e of fromAi) {
    if (has.has(e.kind) || out.some((x) => x.kind === e.kind && sameItem(x.title, e.title))) continue;
    n[e.kind] += 1;
    out.push({ ...e, at: n[e.kind], origin: "engine" });
  }
  return out;
}

/** Writes the lists; answers the refs of the rows written. */
export async function writeSetupExtras(run: JobRun, fromAi: readonly ExtraInput[] = []): Promise<string[]> {
  const plan = plannedExtras(run, fromAi);
  const out: string[] = [];
  for (const e of plan) {
    const id = await run.insert(EXTRA_SCHEMA, {
      Kind: e.kind, Title: e.title, Who: e.kind === "workflow" ? e.who : "", Steps: e.kind === "workflow" ? e.steps : [],
      ConstraintKind: e.kind === "constraint" ? e.constraintKind || "other" : "", SortOrder: e.at, Status: "active", Origin: e.origin,
    }, `extra-${e.origin}-${e.kind}-${e.at}`, { requestKey: `extra-${e.origin}:${run.projectId}:${e.kind}:${e.at}` });
    out.push(`${EXTRA_SCHEMA}:${id}`);
  }
  return out;
}

// ------------------------------------------------------------------------------------------------- the material's list

/** A heading that opens what is left out ("8. Not in the first release", "## Out of scope"), with its own items when
 *  they follow on the same line ("Not included: coupons, gift cards"). */
const OUT_HEADING = /^\s*(?:#{1,4}\s*|\d{1,2}[.)]\s*|[-*•]\s*)?(?:\*\*)?(?:not (?:in|part of|included in) (?:the )?(?:first|initial|1st) (?:release|version)|out of scope|not in scope|not included|what we leave out|left out|exclusions?|excluded|later releases?|not (?:at|for) (?:the )?launch)(?:\*\*)?\s*(?::\s*(.*))?$/i;
/** A line that starts the next section. */
const NEXT = /^\s*(?:#{1,4}\s+\S|\d{1,2}[.)]\s+[A-Z]|[A-Z][\w -]{1,30}:\s|## Page \d+)/;
/** In a sentence: "Coupons are out of scope", "A native app is not part of the first release". */
const OUT_PHRASE = /(?:^|[.!?\n]\s*)([A-Z][^.!?\n]{2,110}?)\s+(?:is|are|stays?|remains?)\s+(?:out of scope|not (?:in|part of) (?:the )?(?:first|initial) (?:release|version)|left out(?: of the first (?:release|version))?|for a later (?:release|version))\b/g;

const itemOf = (raw: string): string => {
  const t = oneLine(raw).replace(/^(?:[-*•]\s*|\d+[.)]\s*)/, "").replace(/^(?:and|or|also|no)\s+/i, "").replace(/[.;:,\s]+$/, "").trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "";
};

/** What the material itself says is not in the first release: the items of its out-of-scope sections and sentences,
 *  one each, in its words (pure; at most 12). */
export function outOfScopeItems(texts: readonly string[]): string[] {
  const out: string[] = [];
  const push = (raw: string) => {
    const t = itemOf(raw);
    if (t.length < 3 || t.length > 200 || STAGED.test(t) || out.some((o) => sameItem(o, t))) return;
    out.push(t);
  };
  for (const text of texts) {
    const lines = text.replace(/\r\n/g, "\n").split("\n");
    for (let i = 0; i < lines.length; i++) {
      const h = OUT_HEADING.exec(lines[i]!);
      if (!h) continue;
      const body: string[] = h[1]?.trim() ? [h[1]] : [];
      for (let j = i + 1; j < lines.length && !NEXT.test(lines[j]!); j++) {
        if (!lines[j]!.trim()) { if (body.length) break; continue; }
        body.push(lines[j]!);
      }
      const bulleted = body.length > 1 && body.every((l) => /^\s*(?:[-*•]|\d+[.)])\s+/.test(l));
      // a bulleted list is one item per line; a wrapped paragraph is one list, split at commas and semicolons
      const parts = bulleted ? body : body.join(" ").split(/\s*[;,]\s*|\.\s+/);
      for (const part of parts) push(part);
    }
    for (const m of text.matchAll(OUT_PHRASE)) push(m[1]!);
    if (out.length >= 12) break;
  }
  return out.slice(0, 12);
}

/** Claude's lists, with the material's own out-of-scope items when Claude's answer has none. */
export function withMaterialExclusions(fromAi: readonly ExtraInput[], items: readonly string[]): ExtraInput[] {
  if (fromAi.some((e) => e.kind === "exclusion") || items.length === 0) return [...fromAi];
  return [...fromAi, ...items.map((title) => ({ kind: "exclusion" as const, title, who: "", steps: [], constraintKind: "" as const }))];
}
