// The project context, 31.10 additions: the project's own currency (engine-context/currency.ts), people's actions as
// "user" ledger events (userEvents.ts) and the shared files kept in inputs/ (inputs.ts).
//   npx vitest run --config test/engine/vitest.config.ts test/engine/contextPeople.test.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import type { Row } from "../../functions/_lib/gateway";
import { ProjectView } from "../../server/local/engine/context.ts";
import type { RowStore } from "../../server/local/rowStore.ts";
import { currencyCodeIn, currencyIn, money } from "../../server/engine-context/currency.ts";
import { recordUserActions, userActionsOf } from "../../server/engine-context/userEvents.ts";
import { copyInputs } from "../../server/engine-context/inputs.ts";
import { readLedger } from "../../server/engine-context/store.ts";
import { acceptOptions } from "../../server/local/engine/kinds/analysis/ai.ts";
import { currencyRule } from "../../server/local/engine/kinds/scope/designAi.ts";

const made: string[] = [];
const tmp = (name: string) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `madp-people-${name}-`));
  made.push(d);
  return d;
};
afterAll(() => {
  for (const d of made) fs.rmSync(d, { recursive: true, force: true });
});

function storeOf(tables: Record<string, Row[]>): RowStore {
  return {
    rows: (s: string) => tables[s] ?? [],
    get: (s: string, id: string) => (tables[s] ?? []).find((r) => r.ItemId === id),
  } as unknown as RowStore;
}

describe("the project's currency", () => {
  it("is the one the material names, an explicit line first; none named stays neutral", () => {
    expect(currencyCodeIn(["Minimum payout is EUR 50.", "Currency \tEUR at launch", "multiple currencies"])).toBe("EUR");
    expect(currencyCodeIn(["Prices from €9", "a CHF 5 fee was once mentioned", "€19 and €29"])).toBe("EUR");
    expect(currencyCodeIn(["Fees in CHF", "CHF 90 000 budget"])).toBe("CHF");
    expect(currencyCodeIn(["Sellers set a price for each licence."])).toBe("");
    expect(money(24, currencyIn(["EUR 50"]))).toBe("€24.00");
    expect(money(4820, null)).toBe("4,820.00");
    expect(currencyRule({ currency: "EUR" })).toContain("€24.00");
    expect(currencyRule({ currency: "" })).toMatch(/plain numbers/);
  });
});

describe("one-click answers written with the question", () => {
  it("keeps two to four distinct answers, never the page's own choices", () => {
    expect(acceptOptions(["Within 2 working days", "Within 1 working day", "Other", "Not sure", "Within 2 working days"])).toEqual(["Within 2 working days", "Within 1 working day"]);
    expect(acceptOptions(["1. Yes, within 14 days", "- No refunds after payout"])).toEqual(["Yes, within 14 days", "No refunds after payout"]);
    expect(acceptOptions(["Only one"])).toEqual([]);
    expect(acceptOptions("nope")).toEqual([]);
  });
});

describe("people's actions in the ledger", () => {
  const P = "p1";
  const tables: Record<string, Row[]> = {
    Project: [{ ItemId: P, WorkspaceId: "w1", Name: "Asset Market", RequirementsConfirmedAt: "2026-10-31T11:41:10Z", RequirementsConfirmedByUserId: "u1" }],
    Membership: [{ WorkspaceId: "w1", UserId: "u1", DisplayName: "Lea Meier" }],
    Clarification: [
      { ItemId: "c1", ProjectId: P, Number: 1, Question: "How fast must new listings be reviewed?", Answer: "Within 2 working days", Status: "answered", AnsweredByUserId: "u1", AnsweredAt: "2026-10-31T11:39:40Z", RequestKey: "engine:j1:1:q-ai-0" },
      { ItemId: "c2", ProjectId: P, Number: 2, Question: "Who sets prices?", Status: "open", RequestKey: "engine:j1:1:q-ai-1" },
    ],
    ScopeVersion: [{ ItemId: "s1", ProjectId: P, Number: 1, Status: "locked", LockedAt: "2026-10-31T11:46:40Z", LockedByUserId: "u1" }],
    Milestone: [{ ItemId: "m1", ProjectId: P, Name: "Browse and list", ScopeVersion: 1, Status: "done", AcceptedAt: "2026-10-31T12:01:30Z", AcceptedByUserId: "u1" }],
    AgentChatMessage: [
      { ItemId: "a1", ProjectId: P, Role: "user", AgentRole: "planner", Text: "What comes first?", AuthorUserId: "u1", At: "2026-10-31T11:49:15Z" },
      { ItemId: "a2", ProjectId: P, Role: "agent", AgentRole: "planner", Text: "The catalogue.", At: "2026-10-31T11:49:24Z" },
    ],
    DocFile: [
      { ItemId: "f1", ProjectId: P, Name: "Brief.pdf", Status: "ready", CreatedByUserId: "u1", CreatedDate: "2026-10-31T11:36:00Z", SizeBytes: 9, RequestKey: "docFile.upload:r1" },
      { ItemId: "f2", ProjectId: P, Name: "Filed.md", Status: "ready", CreatedByUserId: "u1", CreatedDate: "2026-10-31T11:37:00Z", RequestKey: "engine:j0:1:file" },
    ],
  };
  const p = new ProjectView(storeOf(tables), P);

  it("reads who did what and when from the records' own fields", () => {
    const acts = userActionsOf(p, null).map((a) => [a.action, a.ref, a.by, a.at]);
    expect(acts).toEqual([
      ["file.uploaded", "DocFile:f1", "u1", "2026-10-31T11:36:00Z"],
      ["question.answered", "Clarification:c1", "u1", "2026-10-31T11:39:40Z"],
      ["requirements.approved", `Project:${P}`, "u1", "2026-10-31T11:41:10Z"],
      ["scope.locked", "ScopeVersion:s1", "u1", "2026-10-31T11:46:40Z"],
      ["chat.asked", "AgentChatMessage:a1", "u1", "2026-10-31T11:49:15Z"],
      ["milestone.accepted", "Milestone:m1", "u1", "2026-10-31T12:01:30Z"],
    ]);
  });

  it("appends each action once, with the person's name and the context version", () => {
    const dir = tmp("ledger");
    expect(recordUserActions(dir, userActionsOf(p, null), { contextVersion: 7, nameOf: (id) => p.personName(id) })).toBe(6);
    expect(recordUserActions(dir, userActionsOf(p, null), { contextVersion: 8, nameOf: (id) => p.personName(id) })).toBe(0);
    const ev = readLedger(dir).find((e) => e.action === "question.answered")!;
    expect(ev).toMatchObject({ type: "user", by: "u1", byName: "Lea Meier", at: "2026-10-31T11:39:40Z", contextVersion: 7, answer: "Within 2 working days" });
  });
});

describe("shared files kept in inputs/", () => {
  it("copies each file once with its checksum and never one that holds credentials", async () => {
    const dir = tmp("inputs");
    const bytes: Record<string, Uint8Array> = { o1: new TextEncoder().encode("%PDF-1.7 brief"), o2: new TextEncoder().encode("api_key=sk-ant-abcdefghijklmnop12345") };
    let reads = 0;
    const readFile = async (id: string) => { reads += 1; return bytes[id] ?? null; };
    const files = [
      { ref: "DocFile:f1", name: "Asset Market Brief.pdf", mime: "application/pdf", storageObjectId: "o1", sizeBytes: 14 },
      { ref: "DocFile:f2", name: "keys.txt", mime: "text/plain", storageObjectId: "o2", sizeBytes: 36 },
    ];
    const added = await copyInputs({ inputsDir: dir, files, readFile });
    expect(added.map((a) => [a.ref, a.file, a.skipped !== ""])).toEqual([["DocFile:f1", "f1-Asset-Market-Brief.pdf", false], ["DocFile:f2", "", true]]);
    expect(added[0]!.sha256).toBe(createHash("sha256").update(bytes.o1!).digest("hex"));
    expect(fs.readFileSync(path.join(dir, "f1-Asset-Market-Brief.pdf"), "utf8")).toBe("%PDF-1.7 brief");
    expect(fs.readdirSync(dir).sort()).toEqual(["f1-Asset-Market-Brief.pdf", "index.json"]);
    expect(await copyInputs({ inputsDir: dir, files, readFile })).toEqual([]);
    expect(reads).toBe(2);
  });
});

describe("the built-in screens use the project's currency", async () => {
  const { planScreens, screenImage } = await import("../../server/local/engine/kinds/scope/screens.ts");
  const input = (currency: string) => ({
    projectName: "Asset Market", client: "Asset Market GmbH", clientContact: "", industry: "", brief: "A marketplace where creators sell digital assets with a licence.",
    instructions: "", features: [], existing: [], currency,
    requirements: ["Buyers browse and search the catalogue", "Buyers check out their cart and pay", "Creators see their sales"].map((title, i) => ({ key: `r${i}`, title, text: "", category: "functional", criteria: [] })),
  });
  const amounts = (currency: string) => {
    const x = input(currency);
    const plans = planScreens(x);
    // every kind of screen that shows entries (a list, a form with its total), as the plan may pick them
    const shown = plans.flatMap((p) => (["list", "form"] as const).map((kind) => ({ ...p, kind })));
    return JSON.stringify(shown.map((p) => screenImage(p, plans, x).blocks));
  };
  it("EUR from the material, plain amounts when none is named, never CHF by default", () => {
    expect(amounts("EUR")).toMatch(/€\d/);
    expect(amounts("EUR")).not.toContain("CHF");
    expect(amounts("")).not.toMatch(/CHF|€/);
  });
});
