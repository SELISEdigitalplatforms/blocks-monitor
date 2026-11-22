// Builds of a product leave neutral history and code (official/neutral.ts, official/build.ts): a commit's subject and
// body are in the product's words, never the task, a change request code, planning notes, people or internal
// codenames, and no tool trailer; the lane's task has the codenames, the host's private terms and the planning notes
// taken out and tells the agents to keep them out of the code.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { commitOf, describeWork, laneArgs, type WorkAsk } from "../../server/local/engine/official/build.ts";
import { CODENAMES, isPlanningNote, NEUTRAL_RULE, privateTerms, scrubTask, STAND_IN, withoutTerms, type Terms } from "../../server/local/engine/official/neutral.ts";
import type { BuildTicket, ChangeBrief } from "../../server/local/engine/build/prompt.ts";

const NONE: Terms = { codenames: [], private: [] };
const TERMS: Terms = { codenames: ["AGIS"], private: ["Anna Muster", "anna.muster@example.com", "owner-login"] };

const ticket = (n: number, extra: Partial<BuildTicket> = {}): BuildTicket => ({
  id: `t${n}`, number: n, title: `Ticket ${n}`, description: `Do thing ${n}.`, acceptance: [`criterion ${n}a`], feature: "", done: false, ...extra,
});
const change = (extra: Partial<ChangeBrief> = {}): ChangeBrief => ({
  kind: "feature",
  summary: "Sales orders can be invoiced in parts: each partial invoice takes chosen lines or a share of the total, and the order shows what is still to invoice.",
  touches: [], acceptanceCriteria: [], answers: [], risks: [], conflicts: [], ...extra,
});
const ask = (label: string, goal = "", extra: Partial<WorkAsk> = {}): WorkAsk => ({ product: "PrimaBook", label, goal, tickets: [ticket(6)], built: [], later: [], ...extra });

/** The lane's own subject and body (the official engine's quick_ops.commit_subject/commit_body): "<type>(<repo>): ",
 *  a body wrapped at 72 columns. */
function laneMessage(c: { title: string; summary: string }, repo = "api"): string {
  const m = /^(feat|fix): (.*)$/.exec(c.title)!;
  const wrap = (text: string): string[] => {
    const out: string[] = [];
    let line = "";
    for (const w of text.split(" ")) {
      if (line && `${line} ${w}`.length > 72) {
        out.push(line);
        line = w;
      } else line = line ? `${line} ${w}` : w;
    }
    return line ? [...out, line] : out;
  };
  return [`${m[1]}(${repo}): ${m[2]}`, ...(c.summary ? ["", ...c.summary.split("\n\n").flatMap(wrap)] : [])].join("\n");
}

const LEAKS = /agis|parity|priorit|must\b|anna|muster|example\.com|owner-login|MADP|Factory|Claude|Co-Authored|CR-\d|Quick lane|#|Why:/i;

describe("a build's commit message", () => {
  it("CR-006 partial invoices: a short imperative subject and what changed for the people who use the product", () => {
    const c = commitOf(ask("CR-006: Partial invoices", "Why: AGIS parity, priority Must. Customers bill a sales order in parts.", { change: change() }), TERMS);
    expect(c).toEqual({
      title: "feat: add partial invoices",
      summary: "Sales orders can be invoiced in parts: each partial invoice takes chosen lines or a share of the total, and the order shows what is still to invoice.",
    });
    expect(laneMessage(c)).toBe(
      "feat(api): add partial invoices\n\n" +
        "Sales orders can be invoiced in parts: each partial invoice takes chosen\nlines or a share of the total, and the order shows what is still to\ninvoice.",
    );
    // an increment of the feature: its own goal, and its part
    const inc = commitOf(
      ask("CR-006: Partial invoices (increment 1 of 3: API and data)", "", {
        change: change({ feature: { increment: 1, of: 3, title: "API and data", goal: "The API stores partial invoices and the amount still to invoice.", parts: ["API"], codeAreas: [], earlier: [], later: [] } }),
      }),
      TERMS,
    );
    expect(inc).toEqual({ title: "feat: add partial invoices (part 1 of 3)", summary: "The API stores partial invoices and the amount still to invoice." });
    // a change or a fix keeps its title's own words; a title that starts with a verb stays
    expect(commitOf(ask("CR-006: Partial invoices", "", { change: change({ kind: "change" }) }), TERMS).title).toBe("feat: partial invoices");
    expect(commitOf(ask("CR-006: Partial invoices", "", { change: change({ kind: "fix" }) }), TERMS).title).toBe("fix: partial invoices");
    expect(commitOf(ask("CR-006: Allow partial invoices", "", { change: change() }), TERMS).title).toBe("feat: allow partial invoices");
    expect(commitOf(ask("CR-006: Sharing of invoices", "", { change: change() }), TERMS).title).toBe("feat: sharing of invoices");
  });

  it("never carries the codename, the planning notes, people, the change request code or a trailer", () => {
    const cases = [
      ask("CR-006: Partial invoices (AGIS parity)", "Why: AGIS parity, priority Must. Customers bill a sales order in parts (asked by Anna Muster)."),
      ask("CR-006: Like AGIS: partial invoices", "Partial invoices as in AGIS. Priority: Must. Requested by anna.muster@example.com. Customers bill a sales order in parts."),
      ask("CR-006: Partial invoices for AGIS customers", "The owner wants this before the demo. Anna Muster said so. Customers bill a sales order in parts. @owner-login please check."),
      ask("CR-006: Partial invoices (see AGIS)", "Partial invoices. Must-have for parity."),
    ];
    for (const a of cases) {
      const c = commitOf(a, TERMS);
      expect(c.title).toMatch(/^feat: partial invoices/);
      expect(laneMessage(c)).not.toMatch(LEAKS);
      expect(c.summary).not.toMatch(/\(\s*\)|\s[,.]/);
    }
    expect(commitOf(cases[0]!, TERMS).summary).toBe("Customers bill a sales order in parts.");
    // a sentence that names a term is left out of the body, a sentence that does not stays
    expect(commitOf(ask("CR-1: Rename the button", "Same label as AGIS. People look for Save."), TERMS).summary).toBe("People look for Save.");
    // nothing left: no body (the lane then writes none; it never falls back to the task when it has a title)
    expect(commitOf(ask("CR-1: Rename the button", "Why: AGIS parity, priority Must."), TERMS).summary).toBe("");
  });

  it("never puts a task or a brief into the body", () => {
    // 05.11: "Quick lane task: # PrimaBook: CR-001 ..." in the body of a PrimaBook commit
    const brief = "# PrimaBook: CR-001\n\n## Goal\nRename the Save preferences button.\n\n## Build this ticket\n### #1 Rename\nAcceptance criteria:\n- The button says Save my preferences.";
    const c = commitOf(ask("CR-001: Profile: rename the Save preferences button", brief), TERMS);
    expect(c.title).toBe("feat: rename the Save preferences button");
    expect(c.summary).not.toMatch(/Goal|ticket|Acceptance|PrimaBook|#/);
    // instructions to the developer and tool words are not about the product
    const told = commitOf(ask("CR-2: Add a CSV export", "You are the developer. Please implement it with Claude. The invoice list can be exported as CSV."), TERMS);
    expect(told.summary).toBe("The invoice list can be exported as CSV.");
    // a long description: whole sentences, about three lines
    const long = commitOf(ask("CR-3: Add a CSV export", "The invoice list can be exported as CSV with the filters applied. ".repeat(8)), TERMS);
    expect(long.summary.length).toBeLessThanOrEqual(220);
    expect(long.summary.endsWith(".")).toBe(true);
    expect(laneMessage(long).split("\n").length).toBeLessThanOrEqual(1 + 1 + 4);
  });

  it("keeps the subject within 72 characters with the lane's scope and the body without a tool line", () => {
    const labels = [
      "CR-006: Partial invoices for sales orders with chosen lines or a share of the total amount and a remaining balance",
      "CR-006: Partial invoices for sales orders with chosen lines or a share of the total amount (increment 2 of 3: Web app)",
      "FX-12: The VAT summary of a partial invoice rounds every line instead of the total of the invoice",
      "Milestone 4: Partial invoices for sales orders with chosen lines or a share of the total amount",
    ];
    for (const label of labels) {
      const c = commitOf(ask(label, "Customers bill a sales order in parts.", { change: change() }), TERMS);
      for (const repo of ["api", "web", "app"]) expect(laneMessage(c, repo).split("\n")[0]!.length).toBeLessThanOrEqual(72);
      expect(c.title).not.toMatch(/\.\.\.|…|CR-|FX-/);
      expect(c.summary).not.toMatch(/MADP|Factory|Change request|Milestone \d|Fix FX/);
    }
    // the lane's options: the same neutral subject and body
    const args = laneArgs(ask("CR-006: Partial invoices (AGIS parity)", "Why: AGIS parity, priority Must. Customers bill a sales order in parts."));
    expect(args.slice(0, 4)).toEqual(["--title", "feat: partial invoices", "--summary", "Customers bill a sales order in parts."]);
  });
});

describe("the lane's task", () => {
  const work = (): WorkAsk =>
    ask("CR-006: Partial invoices (AGIS parity)", "Why: AGIS parity, priority Must.\nCustomers bill a sales order in parts, as in AGIS. Anna Muster wants the AGIS layout.", {
      change: change({ summary: "Partial invoices like AGIS has them.", answers: [{ question: "Same numbering as AGIS?", answer: "Yes" }] }),
      tickets: [ticket(6, { title: "AGIS partial invoices", description: "Priority: Must\nAn invoice takes some of the order's lines (see AGIS).", comments: ["Ask anna.muster@example.com about the AGIS export."] })],
      facts: ["- Currency: CHF."],
      later: ["Increment 2: Web app"],
    });

  it("has the codename, the private terms and the planning notes taken out, and the work kept", () => {
    const md = describeWork(work(), TERMS);
    expect(md).not.toMatch(/agis|anna|muster|example\.com|priority|parity/i);
    expect(md.split("\n")[0]).toBe("PrimaBook: CR-006: Partial invoices");
    expect(md).toContain(`Customers bill a sales order in parts, as in ${STAND_IN}. The team wants ${STAND_IN} layout.`);
    expect(md).toContain(`Partial invoices like ${STAND_IN} has them.`);
    expect(md).toContain(`- Same numbering as ${STAND_IN}? → Yes`);
    expect(md).toContain(`### #6 ${STAND_IN} partial invoices`);
    expect(md).toContain("An invoice takes some of the order's lines.");
    expect(md).toContain("- Currency: CHF.");
    expect(md).toContain("- Increment 2: Web app");
    expect(md).toContain(`## Ground rules`);
    expect(md).toContain(`- ${NEUTRAL_RULE}`);
  });

  it("tells the agents to keep codenames, people and the task's text out of the code, the texts and the commits", () => {
    expect(NEUTRAL_RULE).toMatch(/internal codenames/);
    expect(NEUTRAL_RULE).toMatch(/people's names/);
    expect(NEUTRAL_RULE).toMatch(/code comments, strings, file names or commit messages/);
    // the rule names no codename itself
    for (const c of CODENAMES) expect(NEUTRAL_RULE.toLowerCase()).not.toContain(c.toLowerCase());
    expect(describeWork(ask("CR-1: Rename the button", "People look for Save."), NONE)).toContain(NEUTRAL_RULE);
  });

  it("scrubs line by line and keeps the markdown and product words", () => {
    expect(scrubTask("- AGIS parity\n- Priority: Must\n- The priority must be shown on each task.", TERMS)).toBe("- The priority must be shown on each task.");
    expect(scrubTask("The AGIS export stays readable.", TERMS)).toBe(`The previous software export stays readable.`);
    expect(scrubTask("Bring over AGIS's numbering.", TERMS)).toBe(`Bring over ${STAND_IN}'s numbering.`);
    expect(scrubTask("Employment categories (AGIS parity) with languages.", TERMS)).toBe("Employment categories with languages.");
    expect(scrubTask("Mail anna.muster@example.com for the logo (Anna Muster).", TERMS)).toBe("Mail for the logo.");
    expect(scrubTask("Anna Muster: keep the totals. Anna Muster's list is the reference.", TERMS)).toBe("keep the totals. The team's list is the reference.");
    // code keeps compiling: a neutral identifier
    expect(scrubTask("```ts\nconst agis = loadAGIS(); // AGIS rows\n```", TERMS)).toBe("```ts\nconst legacy = loadLEGACY(); // LEGACY rows\n```");
    // whole words only, any case
    expect(scrubTask("The Magistrat and MAGISTRAT and Agisoft stay.", TERMS)).toBe("The Magistrat and MAGISTRAT and Agisoft stay.");
    expect(withoutTerms("Migrate from agis to the new invoices; AGISExport too.", TERMS)).toBe("Migrate to the new invoices; Export too.");
    // a heading stays a heading
    expect(scrubTask("## Why\nAGIS parity, priority Must.\n## Goal\nCustomers bill in parts.", TERMS)).toBe("## Why\n## Goal\nCustomers bill in parts.");
    expect(isPlanningNote("Why: AGIS parity, priority Must.", TERMS)).toBe(true);
    expect(isPlanningNote("Why: customers bill in parts.", TERMS)).toBe(false);
    expect(isPlanningNote("Tasks have a priority: high, medium or low.", TERMS)).toBe(false);
  });
});

describe("the private terms", () => {
  const termsFile = (lines: string[]) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "terms-"));
    const file = path.join(dir, "private-terms.txt");
    fs.writeFileSync(file, lines.join("\n"));
    return file;
  };

  it("always holds the built-in codenames, case-insensitively", () => {
    expect(CODENAMES).toContain("AGIS");
    expect(privateTerms({})).toEqual({ codenames: ["AGIS"], private: [] });
    expect(privateTerms({ MF_PRIVATE_TERMS_FILE: "/nonexistent/private-terms.txt" })).toEqual({ codenames: ["AGIS"], private: [] });
    const t = privateTerms({});
    for (const s of ["AGIS", "agis", "Agis", "the AGIS's export"]) expect(withoutTerms(s, t)).not.toMatch(/agis/i);
  });

  it("loads the host's private terms file the way the privacy guard does", () => {
    const file = termsFile(["# private terms of this host", "Anna Muster", "anna.muster@example.com", "ab", "", "agis", "  owner-login  "]);
    const t = privateTerms({ MF_PRIVATE_TERMS_FILE: file });
    expect(t).toEqual({ codenames: ["AGIS"], private: ["Anna Muster", "anna.muster@example.com", "owner-login"] });
    // a commit built with the host's terms
    const c = commitOf(ask("CR-7: Add a CSV export", "Anna Muster asked for it. The invoice list can be exported as CSV."), t);
    expect(c.summary).toBe("The invoice list can be exported as CSV.");
    // the file is read again when it changes
    fs.writeFileSync(file, "Anna Muster\nBen Beispiel the second\n");
    expect(privateTerms({ MF_PRIVATE_TERMS_FILE: file }).private).toEqual(["Anna Muster", "Ben Beispiel the second"]);
    expect(withoutTerms("Ask ben  beispiel THE second.", privateTerms({ MF_PRIVATE_TERMS_FILE: file }))).toBe("Ask.");
  });
});
