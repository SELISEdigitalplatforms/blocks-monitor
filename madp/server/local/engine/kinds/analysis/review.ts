// requirements.draft with purpose "suggestions": a review of the current requirements. Each finding is a Suggestion
// a person can accept (it becomes a new requirement with the suggestion's title and text) or dismiss: the gaps a
// reviewer looks for — vague words without a target, no response times, accessibility, retention of personal data,
// failure cases, notifications, history, languages, password reset, export.
import type { Row } from "../../../../../functions/_lib/gateway";
import type { JobRun } from "../../run.ts";
import { num, str, strs } from "../../context.ts";
import { cap, clip, hashOf, listOf } from "../../text.ts";
import { actorIn, actorLabel, mainActor, readFacts } from "./facts.ts";
import { thingsIn } from "./grammar.ts";
import { before, similar } from "./own.ts";
import { productNounOf } from "./topics.ts";

export interface PlannedSuggestion {
  local: string;
  Key: string;
  Title: string;
  Text: string;
}

const VAGUE = /\b(fast|quick(?:ly)?|easy|easily|simple|simply|user-friendly|intuitive|modern|flexible|seamless(?:ly)?|as soon as possible|efficient(?:ly)?)\b/i;

export function planSuggestions(run: JobRun): PlannedSuggestion[] {
  const p = run.p;
  const facts = readFacts(p);
  const ids = new Set(strs(run.input.requirementIds));
  const reqs = before(run, "Requirement")
    .filter((r) => r.Status !== "dropped" && (ids.size === 0 || ids.has(str(r.ItemId))))
    .sort((a, b) => num(a.Number) - num(b.Number));
  const obj = run.p.rows("Objective")[0];
  const text = (r: Row) => `${str(r.Title)} ${str(r.Text)} ${strs(r.AcceptanceCriteria).join(" ")}`;
  const corpus = `${reqs.map(text).join("\n")}\n${str(obj?.Statement)} ${strs(obj?.AcceptanceCriteria).join(" ")}`.toLowerCase();
  const has = (re: RegExp) => re.test(corpus);
  const first = (re: RegExp) => reqs.find((r) => re.test(text(r)));
  const label = (r: Row) => `R${num(r.Number)} "${str(r.Title)}"`;
  const actor = mainActor(facts);
  const who = actorLabel(actor.name);
  const noun = productNounOf(p.name, p.brief);
  const things = thingsIn(`${corpus} ${facts.all}`, 2);
  const peak = facts.lines.find((l) => /\bpeak\b/i.test(l.text))?.text.replace(/^peak\s*[:,]?\s*/i, "");
  const swiss = /switzerland|swiss|zurich|bern|basel|geneva|lausanne|lucerne/i.test(`${str(p.project.ClientRegion)} ${facts.all}`);
  const count = actor.count ? (actor.count >= 1000 ? actor.count.toLocaleString("de-CH").replace(/[’\u2019]/g, "'") : String(actor.count)) : "";
  const out: PlannedSuggestion[] = [];
  const add = (Key: string, Title: string, Text: string) => out.push({ local: `s-${Key}`, Key, Title: clip(Title, 200), Text: clip(Text, 5000) });

  const vague = reqs.find((r) => VAGUE.test(`${str(r.Title)} ${str(r.Text)}`));
  if (vague) {
    const word = VAGUE.exec(`${str(vague.Title)} ${str(vague.Text)}`)![1]!.toLowerCase();
    add(
      `measurable-r${num(vague.Number)}`,
      `Measurable target for ${str(vague.Title).replace(/^./, (c) => c.toLowerCase())}`,
      `${label(vague)} says "${word}", which cannot be tested. A target such as "opens within 2 seconds${count ? ` for ${count} ${who}` : ""}" makes it checkable in the acceptance test.`,
    );
  }
  if (!has(/\b(seconds?|response time|within \d|load time|performance|peak)\b/)) {
    add(
      "response-times",
      "Response times under load",
      `No requirement sets a response time. With ${count ? `about ${count} ${who}` : who}${peak ? ` and the peak ${peak.toLowerCase()}` : ""}, pages should answer within 2 seconds and uploads confirm within 30 seconds.`,
    );
  }
  const upload = first(/\bupload/i);
  if (upload && !has(/\b(fail|fails|failed|error|too large|rejected|retry)\b/)) {
    const uploader = actorLabel(actorIn(facts, `${str(upload.Title)} ${str(upload.Text)}`) ?? actor.name);
    const what = thingsIn(`${str(upload.Title)} ${str(upload.Text)}`, 2);
    add(
      "upload-errors",
      "Clear message when an upload fails",
      `${label(upload)} covers uploading ${what.length ? listOf(what) : "files"}; it does not say what ${uploader} see when an upload fails or a file is too large, nor whether they can try again.`,
    );
  }
  if (!has(/\b(retention|retain|kept for|deleted|deletion|anonymi[sz]|years)\b/)) {
    add(
      "data-retention",
      "Retention and deletion of personal data",
      `No requirement says how long ${things.length ? `the ${listOf([...things, "personal data"])}` : "the records and the personal data"} are kept. The revised Data Protection Act (nFADP) asks for a defined retention period and deletion afterwards.`,
    );
  }
  const decided = reqs.find((r) => /\b(approv\w*|reject\w*|status|sign-off)\b/i.test(`${str(r.Title)} ${str(r.Text)}`));
  if (decided && !has(/\b(e-?mail|notif\w*|informed|sms|reminder)\b/)) {
    add(
      "status-emails",
      "E-mail when the status changes",
      `${cap(who)} only learn about the outcome of ${label(decided)} by opening the ${noun}. A short e-mail when the status changes saves follow-up calls.`,
    );
  }
  if (decided && !has(/\b(history|audit|logged|recorded|trail)\b/)) {
    add("decision-history", "History of every decision", `${label(decided)} has no trace of who decided what and when. Auditors and support need that history.`);
  }
  if (!has(/\b(accessib\w*|wcag|screen reader|contrast|keyboard)\b/)) {
    add(
      "accessibility",
      "Accessible to WCAG 2.1 AA",
      `${cap(who)} use the ${noun} on their own devices; meeting WCAG 2.1 AA (contrast, keyboard use, screen readers) keeps it usable for everyone.`,
    );
  }
  if (swiss && !has(/\b(language|german|french|italian|translat\w*)\b/)) {
    add("ui-languages", "German and French user interface", `The ${noun} serves ${who} in Switzerland; no requirement names the languages of the screens and e-mails.`);
  }
  const login = first(/\b(sign in|login|log in|password|account|activate)\w*/i);
  if (login && !has(/\b(reset|forgot\w*|new code|re-?send)\b/)) {
    add("password-reset", "Self-service password reset", `${label(login)} covers signing in, not what happens when ${who} forget their password or lose their code.`);
  }
  const list = first(/\b(list|overview|see|sees|report)\b/i);
  if (list && !has(/\b(export|excel|csv|download|pdf)\b/)) {
    add("excel-export", "Export lists to Excel", `${label(list)} shows a list on screen; the team will want to filter it and take it to a meeting as an Excel file.`);
  }

  // Not what is already suggested (any status) or already required.
  const existing = before(run, "Suggestion");
  const fresh = out.filter(
    (s) =>
      !existing.some((e) => str(e.Key) === s.Key || similar(str(e.Title), s.Title, 0.6)) &&
      !reqs.some((r) => similar(str(r.Title), s.Title, 0.7)),
  );
  const n = fresh.length >= 4 && hashOf(`review:${run.id}`) % 2 === 0 ? 4 : 3;
  return fresh.slice(0, Math.min(n, fresh.length));
}
