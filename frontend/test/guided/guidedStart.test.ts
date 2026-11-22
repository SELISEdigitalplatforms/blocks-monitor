import { describe, expect, it } from "vitest";
import {
  EMPTY_ANSWERS, STEPS, joinAnswer, looksLikeSecret, nextStep, prevStep, resumeStep, sanitiseAnswers, suggestedRepoName, toCreateArgs, validateStep,
  type StartAnswers,
} from "../../src/domain/guidedStart";
import { progressPercent } from "../../src/ui/ShimmerProgress";

const base: StartAnswers = {
  ...EMPTY_ANSWERS, kind: "new", name: "Depot Shift Planner", description: "Depot leads plan shifts; drivers see their rota.",
  goalTags: ["Save time"], users: "Depot leads",
};
const repo = { owner: "kestrel-freight", name: "dock-planner-web", branch: "main" };

describe("steps", () => {
  it("runs kind → about → where → ready and back (the objective and users are the product manager's to ask)", () => {
    expect(STEPS).toEqual(["kind", "about", "where", "ready"]);
    expect(nextStep("about")).toBe("where");
    expect(nextStep("kind")).toBe("about");
    expect(nextStep("ready")).toBe("ready");
    expect(prevStep("about")).toBe("kind");
    expect(prevStep("kind")).toBe("kind");
  });

  it("resumes a draft at the first unfinished step, never past the saved one", () => {
    expect(resumeStep("goal", base)).toBe("goal");
    expect(resumeStep("where", { ...base, name: "" })).toBe("about");
    expect(resumeStep("ready", { ...base, kind: null })).toBe("kind");
  });
});

describe("validateStep", () => {
  it("asks for a choice on the first step", () => {
    expect(validateStep("kind", EMPTY_ANSWERS).kind).toBeTruthy();
    expect(validateStep("kind", base)).toEqual({});
  });

  it("needs a name and a description of a sentence", () => {
    const e = validateStep("about", { ...EMPTY_ANSWERS, description: "app" });
    expect(e.name).toBeTruthy();
    expect(e.description).toMatch(/more/);
    expect(validateStep("about", base)).toEqual({});
    expect(validateStep("about", { ...base, name: "x".repeat(81) }).name).toBeTruthy();
  });

  it("takes a goal and users from chips or words", () => {
    expect(validateStep("goal", { ...base, goalTags: [], goal: "" }).goal).toBeTruthy();
    expect(validateStep("goal", { ...base, goalTags: [], goal: "Customers book online" })).toEqual({});
    expect(validateStep("goal", { ...base, users: "", userTags: [] }).users).toBeTruthy();
    expect(validateStep("goal", { ...base, users: "", userTags: ["Customers"] })).toEqual({});
  });

  it("new product: MADP Factory keeps the code by default; GitHub, when chosen, needs the connection", () => {
    expect(EMPTY_ANSWERS.repoChoice).toBe("factory");
    expect(validateStep("where", base)).toEqual({});
    expect(validateStep("where", { ...base, repoChoice: null })).toEqual({});
    expect(validateStep("where", { ...base, repoChoice: "factory" })).toEqual({});
    expect(validateStep("where", { ...base, repoChoice: "create" }).newRepoName).toBeTruthy();
    expect(validateStep("where", { ...base, repoChoice: "create" }, "kestrel")).toEqual({});
    expect(validateStep("where", { ...base, repoChoice: "existing" }).repo).toBeTruthy();
    expect(validateStep("where", { ...base, repoChoice: "existing", repo })).toEqual({});
    expect(validateStep("where", { ...base, repoChoice: "create", startBranch: "bad branch" }).startBranch).toBeTruthy();
    expect(validateStep("where", { ...base, repoChoice: "create", newRepoName: "ignored legacy name" }, "kestrel")).toEqual({});
  });

  it("existing product: the repository is optional, web addresses are checked, never passwords", () => {
    const ex: StartAnswers = { ...base, kind: "existing" };
    expect(validateStep("where", ex)).toEqual({});
    expect(validateStep("where", { ...ex, repoLater: true })).toEqual({});
    expect(validateStep("where", { ...ex, repo: { owner: "", name: "x", branch: "main" } }).repo).toBeTruthy();
    expect(validateStep("where", { ...ex, repo, appUrl: "not a url" }).appUrl).toBeTruthy();
    expect(validateStep("where", { ...ex, repo, appUrl: "app.example.com" })).toEqual({});
    expect(validateStep("where", { ...ex, repo, testEnv: "yes" }).testUrl).toBeTruthy();
    expect(validateStep("where", { ...ex, repo, testEnv: "yes", testUrl: "test.example.com", testAccess: "Password: hunter2" }).testAccess).toMatch(/password/i);
    expect(validateStep("where", { ...ex, repo, testEnv: "no" })).toEqual({});
  });
});

describe("toCreateArgs", () => {
  it("a new product with a new repository in the connected account", () => {
    const a = toCreateArgs({ ...base, repoChoice: "create", repoVisibility: "internal", hasBlocksProject: true, blocksProjectRef: " kf-dock " }, "kestrel");
    expect(a).toMatchObject({
      name: "Depot Shift Planner", projectType: "greenfield", setupStatus: "draft", description: base.description,
      goal: "Save time", targetUsers: "Depot leads",
      newRepoOwner: "kestrel", newRepoName: "depot-shift-planner", repoVisibility: "private", repoBranch: "main", blocksProjectRef: "kf-dock",
    });
    expect(a.repo).toBeUndefined();
    expect(JSON.parse(a.setupAnswers).repoChoice).toBe("create");
  });

  it("a new product kept in MADP Factory sends no repository", () => {
    for (const repoChoice of ["factory", null] as const) {
      const a = toCreateArgs({ ...base, repoChoice, repo }, "kestrel");
      expect(a.repo).toBeUndefined();
      expect(a.newRepoOwner).toBeUndefined();
      expect(a.repoBranch).toBeUndefined();
    }
  });

  it("a new repository without GitHub connected keeps only the choice", () => {
    const a = toCreateArgs({ ...base, repoChoice: "create" }, null);
    expect(a.newRepoOwner).toBeUndefined();
    expect(a.repoBranch).toBeUndefined();
  });

  it("an existing product: repository, addresses, test version and run notes", () => {
    const a = toCreateArgs({
      ...base, kind: "existing", repo, appUrl: "app.example.com", testEnv: "yes", testUrl: "https://test.example.com", testAccess: "Anna from IT",
      runInstructions: "  Hosted by our IT partner.  ", blocksProjectRef: "ignored",
    }, "kestrel");
    expect(a).toMatchObject({
      projectType: "brownfield", repo: "kestrel-freight/dock-planner-web", repoBranch: "main", appUrl: "https://app.example.com",
      runInstructions: "Hosted by our IT partner.",
    });
    expect(JSON.parse(a.testEnv!)).toEqual({ available: "yes", url: "https://test.example.com", accessHow: "Anna from IT" });
    expect(a.newRepoOwner).toBeUndefined();
    expect(a.blocksProjectRef).toBeUndefined();
  });

  it("an existing product with the repository for later sends none", () => {
    const a = toCreateArgs({ ...base, kind: "existing", repoLater: true, testEnv: "unsure" }, null);
    expect(a.repo).toBeUndefined();
    expect(JSON.parse(a.testEnv!)).toEqual({ available: "unsure" });
  });
});

describe("helpers", () => {
  it("joins chips and words", () => {
    expect(joinAnswer(["Save time", "Fewer mistakes"], "")).toBe("Save time, fewer mistakes");
    expect(joinAnswer([], " Book online ")).toBe("Book online");
    expect(joinAnswer(["Customers"], "Drivers")).toBe("Customers. Drivers");
  });

  it("spots secrets but not plain access notes", () => {
    expect(looksLikeSecret("pwd=abc")).toBe(true);
    expect(looksLikeSecret("the password is Summer24")).toBe(true);
    expect(looksLikeSecret("Anna can reset passwords for test accounts")).toBe(false);
  });

  it("suggests a repository name from the project name", () => {
    expect(suggestedRepoName({ name: "Café Order Hub", newRepoName: "" })).toBe("cafe-order-hub");
    expect(suggestedRepoName({ name: "x", newRepoName: "mine" })).toBe("x");
  });

  it("reads back stored answers defensively", () => {
    const a = sanitiseAnswers({ kind: "weird", name: 5, goalTags: ["Save time", "Hack"], repo: { owner: "o", name: "n", branch: "b" }, testEnv: "yes" });
    expect(a.kind).toBeNull();
    expect(a.name).toBe("");
    expect(a.goalTags).toEqual(["Save time"]);
    expect(a.repo).toEqual({ owner: "o", name: "n", branch: "b" });
    expect(a.testEnv).toBe("yes");
    expect(sanitiseAnswers(null)).toEqual(EMPTY_ANSWERS);
  });

  it("fills the progress bar up to the current step", () => {
    expect(progressPercent(1, 5)).toBe(20);
    expect(progressPercent(5, 5)).toBe(100);
    expect(progressPercent(9, 5)).toBe(100);
    expect(progressPercent(1, 0)).toBe(0);
  });
});
