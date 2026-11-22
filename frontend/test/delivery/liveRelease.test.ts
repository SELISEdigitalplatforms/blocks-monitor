// The Release page for an existing product attached as it is live (and every other project): where it runs, the
// release history's commits, "idea to first release", and what "Send vX for approval" moves.
//   npx vitest run --config test/delivery/vitest.config.ts liveRelease
import { describe, expect, it } from "vitest";
import {
  commitLabel, firstNoteText, firstReleaseFact, promotionMoveText, releaseMilestones, sendLabel, shortCommit, whereItRuns, whereLine, whereValue,
  type EnvironmentFact,
} from "@/components/delivery/liveRelease";
import { releaseNotes, releaseStep, type StepChange, type StepPolicy, type StepRelease } from "@/components/delivery/releaseStep";
import { liveFacts } from "@/blocks/delivery/environments";
import { parseLiveProductSnapshot } from "@/domain/liveProduct";
import { parseRelease } from "@/blocks/delivery/types";
import { changeCode, environmentStates } from "@/domain/delivery";

const rel = (environment: string, version: string, extra: Partial<StepRelease> = {}): StepRelease => ({
  id: `${environment}-${version}`, environment, version, releasedAt: "2026-11-05T10:00:00.000Z", url: `https://${environment}.app.slsblx.com`,
  releasedByUserId: "u-jan", changeRequestIds: [], ...extra,
});
const cr = (number: number, status: string, version: string | null, lane = "change"): StepChange =>
  ({ id: `cr-${number}`, number, lane, title: `Change ${number}`, status, version });
const stageDocumented: EnvironmentFact = {
  environment: "stage", url: "https://stage.primabook.slsblx.com", branch: "stage", documentedAt: "2026-11-09T02:10:00.000Z",
};
const fmt = (at: string) => at.slice(0, 10);

describe("the release history names its commit", () => {
  it("a recorded commit shows its short form; a missing or odd one says commit unknown", () => {
    expect(shortCommit("4F1C2D9E8B7A6F5E4D3C2B1A0F9E8D7C6B5A4F3E")).toBe("4f1c2d9");
    expect(commitLabel("4f1c2d9e8b7a")).toBe("commit 4f1c2d9");
    expect(commitLabel(null)).toBe("commit unknown");
    expect(commitLabel("")).toBe("commit unknown");
    expect(commitLabel("file-map 24986 chars")).toBe("commit unknown");
  });

  it("a release row's SourceCommit is read, and a missing one never makes the release unreadable", () => {
    const row = { ItemId: "r1", ProjectId: "p1", Environment: "dev", Version: "0.8.0", Url: "https://x.slsblx.com", ChangeRequestIds: [], ReleasedAt: "2026-11-05T16:59:59.914Z" };
    const withCommit = parseRelease({ ...row, SourceCommit: "a1b2c3d4e5f6" });
    const without = parseRelease({ ...row, SourceCommit: null });
    expect(withCommit.ok && withCommit.value.sourceCommit).toBe("a1b2c3d4e5f6");
    expect(without.ok && without.value.sourceCommit).toBeNull();
  });

  it("each release note carries its commit (null: unknown)", () => {
    const notes = releaseNotes({
      devHistory: [rel("dev", "0.2.0", { sourceCommit: "abcdef1234" }), rel("dev", "0.1.0")], changes: [], milestones: [],
      after: null, upTo: null, code: changeCode,
    });
    expect(notes.map((n) => [n.version, n.commit])).toEqual([["0.2.0", "abcdef1234"], ["0.1.0", null]]);
  });
});

describe("where it runs: every environment the records know", () => {
  it("development from its releases, staging documented from the live product, production not released", () => {
    const states = environmentStates([rel("dev", "0.8.0")]);
    const w = whereItRuns(states, [{ environment: "dev", url: null, branch: "dev", documentedAt: null }, stageDocumented]);
    expect(w.dev).toMatchObject({ version: "0.8.0", state: "live", branch: "dev", factoryRelease: true, host: "dev.app.slsblx.com", documentedAt: null });
    expect(w.stage).toMatchObject({ version: null, state: "live", branch: "stage", factoryRelease: false, host: "stage.primabook.slsblx.com", documentedAt: stageDocumented.documentedAt });
    expect(w.production).toMatchObject({ version: null, state: "none", factoryRelease: false });
  });

  it("a live environment is never 'Not released yet'; only one nothing is known about is", () => {
    const w = whereItRuns(environmentStates([rel("dev", "0.8.0")]), [stageDocumented]);
    expect(whereValue(w.dev)).toBe("v0.8.0");
    expect(whereValue(w.stage)).toBe("Live");
    expect(whereValue(w.production)).toBe("Not released yet");
    expect(whereLine(w.stage, fmt)).toBe("Live before the Factory released here · documented from the live product on 2026-11-09. The version it runs is not recorded yet.");
    expect(whereLine(w.dev, fmt)).toBe("Since 2026-11-05");
    expect(whereLine(w.production, fmt)).toBeNull();
  });

  it("a documented version is shown; a release without an address is released, not live", () => {
    const w = whereItRuns(environmentStates([rel("stage", "1.0.0", { url: "" })]), [{ ...stageDocumented, environment: "production", version: "1.0.0" }]);
    expect(w.stage).toMatchObject({ state: "released", version: "1.0.0", url: null });
    expect(whereValue(w.production)).toBe("v1.0.0");
    expect(whereLine(w.production, fmt)).not.toContain("not recorded");
  });

  it("only an https address counts", () => {
    const w = whereItRuns(environmentStates([]), [{ ...stageDocumented, url: "javascript:alert(1)" }]);
    expect(w.stage).toMatchObject({ url: null, state: "none" });
  });

  it("before it is documented: the branch the Factory builds development from is an attached product's code branch; nothing is assumed for staging", () => {
    expect(liveFacts({ type: "brownfield", repoBranch: "dev" }, null).facts).toEqual([{ environment: "dev", url: null, branch: "dev", documentedAt: null }]);
    expect(liveFacts({ type: "greenfield", repoBranch: "main" }, null).facts).toEqual([]);
    expect(liveFacts({ type: "brownfield", repoBranch: " " }, null).facts).toEqual([]);
    expect(liveFacts(null, null)).toMatchObject({ facts: [], documentedAt: null });
  });

  it("once documented: every environment of the snapshot with its address and branch, and the documented releases with their commits", () => {
    const snapshot = parseLiveProductSnapshot(JSON.stringify({
      version: 1, documentedAt: "2026-11-09T02:10:00.000Z", jobId: "j1", product: "primabook",
      environments: [
        { environment: "dev", branch: "dev", url: "https://dev.primabook.slsblx.com", version: "0.8.0", commits: [] },
        { environment: "stage", branch: "stage", url: "https://stage.primabook.slsblx.com", version: "", commits: [] },
      ],
      releases: [
        { environment: "stage", version: "0.5.0", commit: "", releasedAt: "2026-10-13T10:00:00.000Z", documented: true },
        { environment: "dev", version: "0.8.0", commit: "a".repeat(40), releasedAt: "2026-11-05T16:59:59.914Z", documented: false },
      ],
    }));
    const f = liveFacts({ type: "brownfield", repoBranch: "dev" }, snapshot);
    expect(f.documentedAt).toBe("2026-11-09T02:10:00.000Z");
    expect(f.facts).toEqual([
      { environment: "dev", url: "https://dev.primabook.slsblx.com", branch: "dev", version: "0.8.0", documentedAt: "2026-11-09T02:10:00.000Z" },
      { environment: "stage", url: "https://stage.primabook.slsblx.com", branch: "stage", version: null, documentedAt: "2026-11-09T02:10:00.000Z" },
    ]);
    expect([...f.documented]).toEqual(["stage@0.5.0"]);
    expect(f.commits.get("dev@0.8.0")).toBe("a".repeat(40));
    expect(f.commits.has("stage@0.5.0")).toBe(false);

    // a documented release on staging: live, its version, but not the Factory's release
    const w = whereItRuns(environmentStates([rel("dev", "0.8.0"), rel("stage", "0.5.0", { url: "" })]), f.facts, f.documented);
    expect(w.stage).toMatchObject({ version: "0.5.0", state: "live", factoryRelease: false, documented: true, host: "stage.primabook.slsblx.com" });
    expect(whereLine(w.stage, fmt)).toBe("Since 2026-11-05 · documented from the live product on 2026-11-09");
    expect(w.dev).toMatchObject({ factoryRelease: true, documented: false });
  });

  it("a documented release is marked in the notes and is never the Factory's first release", () => {
    const notes = releaseNotes({
      devHistory: [rel("dev", "0.2.0"), rel("dev", "0.1.0")], changes: [], milestones: [], after: null, upTo: null, code: changeCode,
      documented: new Set(["dev@0.1.0"]),
    });
    expect(notes.map((n) => [n.version, n.first, n.documented])).toEqual([["0.2.0", true, false], ["0.1.0", false, true]]);
  });

  it("the Release step's chip says 'live' for staging that is live without a Factory release", () => {
    const policy = (environment: "stage" | "production"): StepPolicy => ({
      id: `pol-${environment}`, environment,
      policy: { environment, steps: [{ type: "architect", required: true, approverUserIds: ["u-a"] }, { type: "security", required: true, approverUserIds: ["u-b"] }, { type: "qa", required: true, approverUserIds: ["u-c"] }] },
    } as never);
    const base = {
      states: environmentStates([rel("dev", "0.8.0")]), requests: [], policies: [policy("stage"), policy("production")], changes: [],
      userId: "u-k", can: { approve: true, promote: true, request: true }, nameOf: (id: string) => id,
    };
    const live = releaseStep({ ...base, liveWithoutRelease: ["stage"] });
    expect(live.chips.find((c) => c.id === "stage")).toMatchObject({ value: "live", state: "done" });
    expect(live.chips.find((c) => c.id === "production")).toMatchObject({ value: "not yet" });
    expect(releaseStep(base).chips.find((c) => c.id === "stage")).toMatchObject({ value: "not yet" });
  });
});

describe("idea to first release", () => {
  const devReleases = [{ releasedAt: "2026-11-05T11:20:00.000Z" }, { releasedAt: "2026-11-05T10:17:00.000Z" }];

  it("an existing product attached as it is live never shows 'idea to first release': how long with the Factory and the releases since", () => {
    expect(firstReleaseFact({ attached: true, createdDate: "2026-11-05T09:46:35.746Z", devReleases }))
      .toEqual({ kind: "attached", since: "2026-11-05T09:46:35.746Z", releases: 2, firstAt: "2026-11-05T10:17:00.000Z" });
  });

  it("a project the Factory started: whole days from its start to its first release to development", () => {
    expect(firstReleaseFact({ attached: false, createdDate: "2026-11-01T09:00:00.000Z", devReleases }))
      .toEqual({ kind: "idea", days: 4, from: "2026-11-01T09:00:00.000Z", to: "2026-11-05T10:17:00.000Z" });
    expect(firstReleaseFact({ attached: false, createdDate: null, devReleases }).kind).toBe("unknown");
    expect(firstReleaseFact({ attached: false, createdDate: "2026-11-06T00:00:00.000Z", devReleases }).kind).toBe("unknown");
  });

  it("an attached product's first release is the product as it was, not what milestones delivered", () => {
    expect(firstNoteText(false)).toBe("The first release: everything the milestones delivered.");
    expect(firstNoteText(true)).toContain("the product as it was live, before any change request");
    expect(firstNoteText(true)).not.toMatch(/milestone/i);
    expect(firstNoteText(true, 2)).toContain("with these changes");
  });
});

describe("Send vX for approval says what it moves", () => {
  const changes = [cr(1, "released-dev", "0.2.0"), cr(2, "released-dev", "0.6.0"), cr(4, "released-dev", "0.8.0"), cr(6, "failed", "0.9.0"), cr(5, "review", null)];

  it("the label names the version and where it goes", () => {
    expect(sendLabel("0.8.0", "stage")).toBe("Send v0.8.0 to Staging for approval");
    expect(sendLabel("1.2.0", "production")).toBe("Send v1.2.0 to Production for approval");
  });

  it("the version, from which environment to which, and only the change requests released on development up to it", () => {
    const where = whereItRuns(environmentStates([rel("dev", "0.8.0")]), []);
    expect(promotionMoveText({ target: "stage", version: "0.8.0", where, changes, code: changeCode }))
      .toBe("Once approved, v0.8.0 goes from development to staging with CR-001, CR-002 and CR-004.");
  });

  it("says what the target runs until then: its version, or what it runs now when that is live but not recorded", () => {
    const withStage = whereItRuns(environmentStates([rel("dev", "0.8.0"), rel("stage", "0.7.0")]), []);
    expect(promotionMoveText({ target: "stage", version: "0.8.0", where: withStage, changes: [], code: changeCode }))
      .toBe("Once approved, v0.8.0 goes from development to staging. Staging runs v0.7.0 until then.");
    const documented = whereItRuns(environmentStates([rel("dev", "0.8.0")]), [stageDocumented]);
    expect(promotionMoveText({ target: "stage", version: "0.8.0", where: documented, changes: [], code: changeCode }))
      .toBe("Once approved, v0.8.0 goes from development to staging. Staging keeps what it runs now until then.");
  });

  it("to production it carries what is on staging; a long list stays short", () => {
    const many = [1, 2, 3, 4, 5, 6].map((n) => cr(n, "promoted-stage", "1.0.0"));
    const where = whereItRuns(environmentStates([rel("dev", "1.0.0"), rel("stage", "1.0.0")]), []);
    expect(promotionMoveText({ target: "production", version: "1.0.0", where, changes: many, code: changeCode }))
      .toBe("Once approved, v1.0.0 goes from staging to production with CR-001, CR-002, CR-003 and 3 more.");
  });
});

describe("milestones on an attached product's Release page", () => {
  it("documented milestones are never what the first release delivered, never a locked scope, and show previews only once one exists", () => {
    expect(releaseMilestones(true, 0)).toEqual({ inNotes: false, inHero: false, mayScope: false, showPreviews: false });
    expect(releaseMilestones(true, 2).showPreviews).toBe(true);
    expect(releaseMilestones(false, 0)).toEqual({ inNotes: true, inHero: true, mayScope: true, showPreviews: true });
  });
});
