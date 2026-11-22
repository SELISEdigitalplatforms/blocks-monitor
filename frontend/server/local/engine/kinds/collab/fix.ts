// The engine's analysis of a bug report from the release assistant (src/domain/assistant.ts BugAnalysis): which
// feature it touches, the cause in the code, the evidence, the fix plan and its impact. Pure: facts in, analysis out.
import type { BugAnalysis, CodeRef, Severity } from "../../../../../src/domain/assistant";
import type { ChatRole } from "../../../../../src/domain/agentChat";
import { str } from "../../context.ts";
import { cap, clip, hashOf, lower, statementsOf, wordsOf } from "../../text.ts";
import {
  codeAreaOf,
  codePaths,
  environmentsWith,
  latestRelease,
  lockedFeatureRefs,
  matchChange,
  matchFeature,
  matchStory,
  type CodeArea,
  type CodePaths,
  type CollabFacts,
  type FeatureFact,
} from "./facts.ts";

interface AreaRule {
  cause: (c: { feature: string; tz: string }) => string;
  webWhy: string;
  apiWhy: string;
  plan: (c: { feature: string }) => string[];
  covers: string;
  /** The step that makes it happen. */
  trigger: string;
  severity: Severity;
  hours: number;
}

const AREA: Record<CodeArea, AreaRule> = {
  upload: {
    cause: () =>
      "The photo is kept only in the screen's memory until the record is sent. When the phone locks or the connection drops before the upload finishes, the file reference is lost and the record is saved without it.",
    webWhy: "Clears the pending files when the page is hidden",
    apiWhy: "Accepts the record without checking that its attachments arrived",
    plan: () => ["Keep pending photos in the offline store until the server confirms them", "Retry an interrupted upload before the record is completed", "Show the upload state on the record and test an interrupted upload"],
    covers: "uploads over a stable connection only",
    trigger: "Take the photo while the connection drops, then complete the record",
    severity: "high",
    hours: 4,
  },
  sync: {
    cause: () =>
      "Changes queued without signal are sent again after a reconnect, and the server does not recognise a repeated change, so the second copy is applied on top of the first.",
    webWhy: "Sends the whole queue again after a reconnect",
    apiWhy: "Applies every change without checking its change id",
    plan: () => ["Send each queued change with its own id", "Ignore a change id the server has already applied", "Add a test that reconnects twice during one change"],
    covers: "a single reconnect only",
    trigger: "Switch the network off, make the change, switch it back on twice",
    severity: "high",
    hours: 3,
  },
  pdf: {
    cause: () =>
      "The PDF is rendered from the record as it was loaded when the screen opened, not from the saved record. Changes made after opening are stored but never reach the template.",
    webWhy: "Saves the change but keeps the old data for the report",
    apiWhy: "Builds the PDF from the cached record instead of the saved one",
    plan: () => ["Render the PDF from the saved record", "Reload the report data after every save", "Add a test that edits the record before the PDF is made"],
    covers: "reports made right after the first save only",
    trigger: "Change the record after opening it, then make the PDF",
    severity: "medium",
    hours: 2,
  },
  signature: {
    cause: () =>
      "The signature is attached to the record only when the signing screen is closed with Done. A signature confirmed with the back gesture is shown on screen but never saved.",
    webWhy: "Saves the signature in the Done handler only",
    apiWhy: "Accepts a completed record without a signature",
    plan: () => ["Save the signature as soon as the stroke ends", "Refuse to complete a record that needs a signature and has none", "Test closing the signing screen with the back gesture"],
    covers: "signing with the Done button only",
    trigger: "Sign and close the signing screen with the back gesture",
    severity: "high",
    hours: 3,
  },
  time: {
    cause: (c) =>
      `Times are stored in UTC but compared and shown without converting to ${c.tz}, so entries close to midnight and around the clock change land on the wrong day.`,
    webWhy: "Formats the stored UTC time without the time zone",
    apiWhy: "Groups the entries by the UTC date",
    plan: (c) => [`Convert every stored time to the local time zone before it is grouped or shown`, `Use the same date helper on the screen and in the server for ${lower(c.feature)}`, "Add tests for entries just before and after midnight"],
    covers: "times in the middle of the day only",
    trigger: "Record an entry shortly before midnight local time",
    severity: "medium",
    hours: 2,
  },
  money: {
    cause: () =>
      "Line amounts are rounded before they are added up and the VAT is calculated on the rounded lines, so the total can differ by a few cents from the one the ERP calculates.",
    webWhy: "Rounds each line before the total",
    apiWhy: "Calculates the VAT on rounded line amounts",
    plan: () => ["Add up the unrounded line amounts and round the total once", "Calculate the VAT on the unrounded total, as the ERP does", "Compare the totals with the ERP on a set of real orders in a test"],
    covers: "orders with a single line only",
    trigger: "Order several lines whose prices round differently",
    severity: "medium",
    hours: 2,
  },
  mail: {
    cause: () =>
      "The notification is queued only for the person who created the record. The recipients named in the setting are read but never added to the message.",
    webWhy: "Saves the recipients without validating them",
    apiWhy: "Sends to the creator only and ignores the configured recipients",
    plan: () => ["Send to every recipient of the setting", "Skip and log an address that is not valid instead of dropping the message", "Add a test with several recipients"],
    covers: "the creator as the only recipient",
    trigger: "Name a second recipient in the setting and trigger the message",
    severity: "medium",
    hours: 2,
  },
  auth: {
    cause: () =>
      "Access is checked against the role in the session issued at sign-in. A role changed afterwards only applies after the next sign-in, so the person keeps the old access until then.",
    webWhy: "Keeps the role from the sign-in for the whole session",
    apiWhy: "Checks the role from the token instead of the current membership",
    plan: () => ["Check the current role on every request", "Refresh the session when a role changes", "Add a test that changes a role during a session"],
    covers: "roles that do not change during a session",
    trigger: "Change the person's role while they are signed in",
    severity: "high",
    hours: 3,
  },
  list: {
    cause: () =>
      "The list is loaded once with the filter of the moment and kept for the session. Records changed elsewhere afterwards do not appear until the page is reloaded.",
    webWhy: "Caches the filtered list for the whole session",
    apiWhy: "Filters on the status the record had when it was created",
    plan: () => ["Filter on the current status in the query", "Reload the list when the screen is opened again", "Add a test that changes a record while the list is open"],
    covers: "a freshly loaded list only",
    trigger: "Change a record in another window, then go back to the list",
    severity: "medium",
    hours: 2,
  },
  status: {
    cause: () =>
      "The screen shows the status from the last change it made itself. A change made by the server (after an import or by another person) is stored but not reloaded, so the old status stays on screen.",
    webWhy: "Shows the locally kept status instead of the stored one",
    apiWhy: "Updates the status without a change marker the screen could check",
    plan: () => ["Reload the record when the screen comes back into view", "Return the stored status after every change", "Add a test with a status changed by the server"],
    covers: "changes made on this screen only",
    trigger: "Let the server change the status, then look at the screen",
    severity: "medium",
    hours: 2,
  },
  import: {
    cause: () => "The import skips rows whose optional columns are empty instead of using the defaults, and reports the skipped rows only in the server log.",
    webWhy: "Shows the import as complete without the skipped rows",
    apiWhy: "Skips a row with an empty optional column",
    plan: () => ["Use the defaults for empty optional columns", "List the rows that could not be imported in the result", "Add a test with empty optional columns"],
    covers: "files with every column filled",
    trigger: "Import a file with an empty optional column",
    severity: "medium",
    hours: 3,
  },
  form: {
    cause: () => "The field is checked in the form only. The server accepts the empty value, so a form sent before it finished loading saves the record incomplete.",
    webWhy: "Validates the field on the screen only",
    apiWhy: "Accepts the record without the required field",
    plan: () => ["Check the required fields on the server", "Keep the send button disabled until the form has loaded", "Add a test that sends the form while it is loading"],
    covers: "a form that has finished loading",
    trigger: "Send the form while it is still loading",
    severity: "medium",
    hours: 2,
  },
  screen: {
    cause: () => "After the action completes, the screen keeps the data it loaded when it opened. It is not reloaded, so it shows the earlier state until it is opened again.",
    webWhy: "Does not reload the data after the action",
    apiWhy: "Answers without the updated record",
    plan: () => ["Return the updated record from the server", "Show the returned record on the screen", "Add a test for the screen after the action"],
    covers: "the first load of the screen only",
    trigger: "Complete the action and look at the screen without reloading",
    severity: "low",
    hours: 1,
  },
};

const CRITICAL = /\b(data loss|lost (?:all|every)|nobody can|no one can|all users|everyone|cannot (?:log|sign) in|can't (?:log|sign) in|payment|crash(?:es|ed)?)\b/i;
const MINOR = /\b(typo|spelling|label|alignment|aligned|colou?r|font|cosmetic|layout)\b/i;

function timeZoneOf(region: string): string {
  const r = region.toLowerCase();
  if (/germany|deutschland|mannheim|berlin|munich|hamburg/.test(r)) return "Europe/Berlin";
  if (/austria|vienna|wien|graz/.test(r)) return "Europe/Vienna";
  return "Europe/Zurich";
}

/** The first sentence of the report, as a title (at most 120 characters). */
export function titleOf(report: string, feature: string): string {
  const first = (statementsOf(report.replace(/\s+/g, " "))[0] ?? report).trim();
  let t = first
    .replace(/^(?:hi|hello|hey)\b[^,.!?]*[,!.]\s*/i, "")
    .replace(/^(?:it seems (?:that )?|it looks like |i think |apparently |since (?:yesterday|today|this morning|the (?:last |latest )?(?:update|release)|v?\d+\.\d+(?:\.\d+)?),?\s*)/i, "")
    .replace(/[.!?]+$/, "")
    .trim();
  if (t.length > 90) {
    const cut = t.search(/\s(?:when|after|because|although|while|if|since)\s/i);
    if (cut >= 30) t = t.slice(0, cut);
  }
  if (t.length < 12) t = `${feature}: ${t || "unexpected result"}`;
  return clip(cap(t), 120);
}

function severityOf(text: string, rule: AreaRule, env: string): Severity {
  if (CRITICAL.test(text)) return env === "production" ? "critical" : "high";
  if (MINOR.test(text)) return "low";
  return rule.severity;
}

function severityReason(sev: Severity, env: string, feature: string, area: CodeArea): string {
  const where = env === "production" ? "people using the product every day" : env === "stage" ? "the acceptance tests on stage" : "the next release";
  switch (sev) {
    case "critical":
      return `It stops ${lower(feature)} for ${where}; there is no workaround.`;
    case "high":
      return area === "upload" || area === "sync" || area === "signature"
        ? `Records are saved incomplete without anyone noticing; it affects ${where}.`
        : `It gives people the wrong result in ${lower(feature)} and affects ${where}; there is a manual workaround.`;
    case "medium":
      return `The result is wrong in some cases of ${lower(feature)}; no data is lost and the record can be corrected by hand.`;
    default:
      return "Cosmetic only: nothing is lost or calculated wrongly.";
  }
}

function lineOf(seed: string, min: number, span: number): number {
  return min + (hashOf(seed) % span);
}

const base = (p: string): string => p.split("/").pop() ?? p;

export interface AnalysisInput {
  report: string;
  attachments: { name: string; excerpt: string }[];
  env: string;
  region: string;
}

/** The analysis of one bug report. featureRef is always one of the locked milestones' features (or "" without scope). */
export function analyseBug(f: CollabFacts, i: AnalysisInput): BugAnalysis {
  const locked = lockedFeatureRefs(f);
  const text = `${i.report} ${i.attachments.map((a) => `${a.name} ${a.excerpt}`).join(" ")}`;
  const hit = matchFeature(f, text, locked.length ? locked : undefined);
  // A report about something a change brought belongs to that change's feature.
  const change = matchChange(f, text);
  const changeFeature = change && change.status !== "draft" && change.status !== "building" ? f.features.find((x) => x.ref === change.featureRef && (!locked.length || locked.includes(x.ref))) : undefined;
  const feat: FeatureFact | undefined = changeFeature ?? hit?.feature ?? f.features.find((x) => locked.includes(x.ref)) ?? f.features[0];
  const featureTitle = feat?.title ?? f.name;
  const area = codeAreaOf(text);
  const rule = AREA[area];
  const paths: CodePaths = feat ? codePaths(f, feat.key, area) : { web: "web/src/app/App.tsx", api: "api/src/app/service.ts", test: "api/src/app/service.test.ts" };
  const story = feat ? matchStory(feat, text) ?? feat.stories[0] ?? null : null;
  const otherStory = feat?.stories.find((s) => s !== story && wordsOf(`${s.title} ${s.text}`).size > 0 && [...wordsOf(text)].some((w) => wordsOf(`${s.title} ${s.text}`).has(w)));
  const release = latestRelease(f, i.env);
  const sev = severityOf(text, rule, i.env);
  const title = titleOf(i.report || i.attachments[0]?.name || featureTitle, featureTitle);
  const symptom = (statementsOf(i.report.replace(/\s+/g, " "))[0] ?? i.report).trim();
  const actor = story?.actor ? `${/^[aeiou]/i.test(story.actor) ? "an" : "a"} ${story.actor}` : "a user";
  const logLine = i.attachments.map((a) => a.excerpt.split(/\r?\n/).find((l) => /error|exception|fail|warn/i.test(l)) ?? "").find(Boolean);

  const refs: CodeRef[] = [
    { path: paths.web, line: lineOf(`${paths.web}:${title}`, 40, 160), why: rule.webWhy },
    { path: paths.api, line: lineOf(`${paths.api}:${title}`, 30, 190), why: rule.apiWhy },
  ];
  const steps = [
    `Open ${f.name}${release ? ` v${release.version}` : ""} on ${i.env} as ${actor}`,
    story ? cap(story.title.replace(/[.]+$/, "")) : `Go to ${lower(featureTitle)}`,
    rule.trigger,
  ];
  const cameWith = changeFeature && change && change.version ? ` It started with v${change.version}, which brought ${change.code} ${change.title}.` : "";
  const failing = logLine
    ? clip(`${cap(symptom.replace(/[.!?]+$/, "") || "The step fails")}. The attached log shows: ${logLine.trim()}`, 400)
    : clip(`${symptom ? sentence2(symptom) : "The result does not match the story's acceptance criteria."}${cameWith}`, 400);
  const tests = [`${base(paths.test)} covers ${rule.covers}`];
  if (story?.criteria[0]) tests.push(`No test for “${story.criteria[0].replace(/[.]+$/, "")}” in that situation`);

  const roles: ChatRole[] = ["dev", "qa"];
  if (area === "auth") roles.push("secops");
  const envs = environmentsWith(f, i.env);
  const screens = matchScreens(f, `${text} ${featureTitle}`);

  return {
    title,
    summary: clip(
      `In ${lower(featureTitle)}${release ? ` (v${release.version} on ${i.env})` : ""}, ${lower(symptom.replace(/[.!?]+$/, "")) || "the reported step fails"}. ${rule.cause({ feature: featureTitle, tz: timeZoneOf(i.region) }).split(". ")[0]!.replace(/[.]+$/, "")}.`,
      600,
    ),
    severity: sev,
    severityReason: severityReason(sev, i.env, featureTitle, area),
    rootCause: { text: rule.cause({ feature: featureTitle, tz: timeZoneOf(i.region) }), refs },
    evidence: {
      steps,
      failing,
      stories: [story?.title, otherStory?.title].filter((s): s is string => Boolean(s)).slice(0, 2),
      tests,
    },
    plan: { steps: rule.plan({ feature: featureTitle }), files: [paths.web, paths.api], tests: [base(paths.test)] },
    impact: { features: [featureTitle], screens: screens.length ? screens : [featureTitle], environments: envs },
    estimate: { hours: sev === "critical" ? rule.hours + 2 : sev === "low" ? 1 : rule.hours, agentRoles: roles },
    featureRef: feat && locked.includes(feat.ref) ? feat.ref : locked[0] ?? "",
  };
}

const sentence2 = (s: string): string => {
  const t = s.trim().replace(/\s+/g, " ");
  return /[.!?]$/.test(t) ? cap(t) : `${cap(t)}.`;
};

function matchScreens(f: CollabFacts, text: string): string[] {
  const words = wordsOf(text);
  return f.screens
    .map((s) => ({ name: str(s.Name), score: [...wordsOf(str(s.Name))].filter((w) => words.has(w)).length }))
    .filter((s) => s.name && s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map((s) => s.name);
}

/** The one-line text kept with the analysis row (the card shows the analysis itself). */
export function analysisText(a: BugAnalysis): string {
  return `${a.title}. Severity ${a.severity}; about ${a.estimate.hours} h to fix.`;
}
