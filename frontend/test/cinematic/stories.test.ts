import { afterEach, describe, expect, it } from "vitest";
import { GITHUB_ANSWER, buildRealScript, buildScript, codeAnswerText, createArgsOf, type Answers } from "../../src/components/cinematic/journey/script";
import { createArgsFor, startAnswersOf, websiteLabel, websiteNoteBody, websiteOf } from "../../src/components/cinematic/journey/realAnswers";
import { GOAL_CHIPS, USER_CHIPS } from "../../src/domain/guidedStart";
import { DRIVER, STORIES, WEBPILOT, filesReadLine, pickStory } from "../../src/components/cinematic/journey/stories";
import { filmModeEnabled } from "../../src/components/cinematic/journey/filmMode";

const EMPTY: Answers = { visitor: "", name: "", about: "", website: "", audience: "", goal: "", files: [], code: "", repo: "", env: "", followups: [] };

describe("the visit's script", () => {
  it("asks the same questions in the same order for every story", () => {
    const ids = buildScript(DRIVER).map((n) => n.id);
    expect(ids).toEqual(["visitor", "name", "about", "website", "audience", "goal", "files", "summary", "f0", "f1", "f2", "github", "env", "launch"]);
    expect(buildScript(WEBPILOT).map((n) => n.id)).toEqual(ids);
  });

  it("keeps the Driver Delivery App story as it was", () => {
    const s = buildScript(DRIVER);
    const by = (id: string) => s.find((n) => n.id === id)!;
    expect(by("name").scripted).toBe("Driver Delivery App");
    expect(by("name").ask?.placeholder).toBe("e.g. Driver Delivery App");
    expect(by("files").scripted).toEqual(["Delivery note template.pdf", "Ride-along notes.docx", "Route list Winterthur.xlsx"]);
    expect(by("github").walkTalk!(EMPTY)).toEqual(["Now let's set up where your code will live. Engineering is right next door."]);
    expect(DRIVER.requirements(["Yes, the whole route", "Yes, a photo is enough", "Yes, live status"]).map((r) => r.title))
      .toEqual(["Route of the day", "Proof of delivery", "Chilled goods", "Works without signal", "Live delivery status"]);
  });

  it("tells WebPilot with its story facts", () => {
    const s = buildScript(WEBPILOT);
    const by = (id: string) => s.find((n) => n.id === id)!;
    expect(by("name").scripted).toBe("WebPilot");
    expect(by("website").scripted).toBe("webpilot.selise.ch");
    expect(by("audience").ask?.chips).toEqual(["Website owners", "Agencies", "Marketing teams", "Developers"]);
    expect(by("goal").ask?.chips).toEqual(["One readiness score", "Fewer surprises", "Faster fixes", "Grow traffic"]);
    expect(by("files").scripted).toEqual(["WebPilot 2.0 roadmap.pdf", "Customer requests Q3.csv", "Current alert e-mail.eml"]);
    expect(by("f0").say(EMPTY)[0]).toBe("Three quick questions. For AI search, should WebPilot track only how often a site is mentioned, or also which sources the assistants cite?");
    expect(by("f1").say(EMPTY)[0]).toBe("DNS changes take time to spread. Should we check propagation from several regions and alert when they disagree?");
    expect(by("f2").say(EMPTY)[0]).toBe("When should the first SSL alert go out?");
    expect(["f0", "f1", "f2"].map((id) => by(id).ask?.chips)).toEqual([
      ["Mentions and cited sources", "Mentions only"], ["Yes, worldwide", "Only Europe"], ["30 days before expiry", "14 days before expiry"],
    ]);
    // the first chip is the answer given
    expect(["f0", "f1", "f2"].map((id) => by(id).scripted)).toEqual(["Mentions and cited sources", "Yes, worldwide", "30 days before expiry"]);
    expect(by("env").scripted).toBe("Private preview");
  });

  it("shows R1-R7, shaped by the answers", () => {
    const given = WEBPILOT.requirements(["Mentions and cited sources", "Yes, worldwide", "30 days before expiry"]);
    expect(given.map((r) => `${r.id}: ${r.body}`)).toEqual([
      "R1: One Production readiness score per site.",
      "R2: SEO and GEO visibility.",
      "R3: DNS propagation from several regions.",
      "R4: SSL certificate watch, with the first alert 30 days ahead.",
      "R5: Core Web Vitals per page.",
      "R6: Alerts within minutes, by e-mail and in the app.",
      "R7: Every existing site, user and alert history kept.",
    ]);
    const other = WEBPILOT.requirements(["Mentions only", "Only Europe", "14 days before expiry"]);
    expect(other[1].body).toContain("mentions");
    expect(other[2].body).toContain("Europe");
    expect(other[3].body).toContain("14 days");
  });

  it("asks for the files where they are dropped (the stage, shown on the wall screen)", () => {
    for (const story of Object.values(STORIES)) expect(story.filesAsk).toMatch(/ Just drop them here\.$/);
  });

  it("uses none of the words the product never shows", () => {
    for (const story of Object.values(STORIES)) {
      const a = { ...EMPTY, visitor: story.visitor, name: story.name, website: story.website };
      const text = [
        ...buildScript(story).flatMap((n) => [...n.say(a), ...(n.walkTalk?.(a) ?? []), ...(n.ask?.chips ?? []), n.ask?.placeholder ?? "", ...[n.scripted].flat()]),
        ...story.requirements([]).flatMap((r) => [r.title, r.body]),
        story.site.title, story.site.blurb, story.filesRead,
      ].join("\n");
      expect(text).not.toMatch(/\b(demo|mock|sample|fake|test data|prototype|placeholder|lorem|simulated|brownfield|greenfield)\b/i);
      if (story.id === "webpilot") expect(text).not.toMatch(/\b(compliance|security)\b/i);
    }
  });
});

describe("where the code lives", () => {
  const a: Answers = { ...EMPTY, name: "Driver Delivery App", about: "Drivers see the route.", goal: "Replace paper", audience: "Drivers" };

  it("keeps the code in MADP Factory by default, with no GitHub account anywhere", () => {
    for (const story of Object.values(STORIES)) {
      const node = buildScript(story).find((n) => n.id === "github")!;
      expect(node.scripted).toBe("factory");
      expect(node.apply!(a, "factory")).toEqual({ code: "factory", repo: "" });
      expect(node.say(a).join(" ")).toMatch(/MADP Factory/);
      expect(JSON.stringify(story)).not.toMatch(/alpine-fresh"|"selise"/);
    }
    const args = createArgsOf({ ...a, code: "factory" }, null);
    expect(args).toMatchObject({ name: "Driver Delivery App", projectType: "greenfield" });
    expect(args.repo).toBeUndefined();
    expect(args.newRepoOwner).toBeUndefined();
    expect(JSON.parse(args.setupAnswers).repoChoice).toBe("factory");
    expect(codeAnswerText("factory")).toBe("Keep the code in MADP Factory");
  });

  it("uses GitHub only with the account the real connection reports", () => {
    const node = buildScript(DRIVER).find((n) => n.id === "github")!;
    expect(node.apply!(a, `${GITHUB_ANSWER}kestrel`)).toEqual({ code: "github", repo: "kestrel/driver-delivery-app" });
    expect(codeAnswerText(`${GITHUB_ANSWER}kestrel`)).toBe("Use GitHub as @kestrel");
    const env = buildScript(DRIVER).find((n) => n.id === "env")!;
    expect(env.say({ ...a, code: "github", repo: "kestrel/driver-delivery-app" })[0]).toContain("kestrel/driver-delivery-app");
    expect(createArgsOf({ ...a, code: "github" }, "kestrel")).toMatchObject({ newRepoOwner: "kestrel", newRepoName: "driver-delivery-app", repoVisibility: "private" });
    // no real login: no repository is asked for
    expect(createArgsOf({ ...a, code: "github" }, null).newRepoOwner).toBeUndefined();
  });
});

describe("picking the story", () => {
  const store = new Map<string, string>();
  const g = globalThis as unknown as { sessionStorage?: Storage };
  afterEach(() => { store.clear(); delete g.sessionStorage; });

  // with the film mode on (a development build that turns it on): the picker as before
  const pick = (search: string) => pickStory(search, true);

  it("is the real office unless a story is asked for (?story=, kept for the tab, or the recording mode)", () => {
    expect(pick("")).toBeNull();
    expect(pick("?rec=1")).toBe(DRIVER);
    expect(pick("?story=webpilot&rec=1")).toBe(WEBPILOT);
    expect(pick("?story=real&rec=1")).toBeNull();
    g.sessionStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) } as Storage;
    expect(pick("?story=webpilot")).toBe(WEBPILOT);
    expect(pick("?rec=1")).toBe(WEBPILOT);
    expect(pick("")).toBe(WEBPILOT);
    expect(pick("?story=driver")).toBe(DRIVER);
    expect(pick("")).toBe(DRIVER);
    expect(pick("?story=real")).toBeNull();
    expect(pick("")).toBeNull();
    expect(pick("?story=nothing")).toBeNull();
    expect(pick("")).toBeNull();
  });
  it("is always the real office while the film mode is off (the default; never on in a hosted build), and forgets a kept story", () => {
    g.sessionStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) } as Storage;
    store.set("madp.journey.story", "webpilot");
    for (const q of ["", "?rec=1", "?story=webpilot", "?story=driver&rec=1"]) expect(pickStory(q, false)).toBeNull();
    expect(store.has("madp.journey.story")).toBe(false);
    expect(pickStory("?story=driver")).toBeNull(); // the test build does not turn it on
  });
  it("is on only in a development build that turns it on", () => {
    expect(filmModeEnabled({ DEV: true, PROD: false, VITE_FACTORY_FILM_MODE: "1" })).toBe(true);
    expect(filmModeEnabled({ DEV: true, PROD: false })).toBe(false);
    expect(filmModeEnabled({ DEV: false, PROD: true, VITE_FACTORY_FILM_MODE: "1" })).toBe(false);
    expect(filmModeEnabled({ DEV: true, PROD: false, VITE_FACTORY_FILM_MODE: "true" })).toBe(false);
  });
});

describe("the line once files are read", () => {
  it("names the story's own files by what they hold, in any order", () => {
    expect(filesReadLine(WEBPILOT, ["Current alert e-mail.eml", "Customer requests Q3.csv", "WebPilot 2.0 roadmap.pdf"])).toBe(WEBPILOT.filesRead);
    expect(filesReadLine(DRIVER, DRIVER.files)).toBe(DRIVER.filesRead);
  });
  it("speaks plainly about any other files", () => {
    expect(filesReadLine(WEBPILOT, ["notes.txt"])).toBe("Got it. I've read it.");
    expect(filesReadLine(DRIVER, ["a.pdf", "b.csv", "c.eml"])).toBe("Got them. I've read all three.");
  });
});

describe("the real office", () => {
  const nodes = buildRealScript({ checkName: (v) => (v.trim() ? null : "Enter a project name."), checkWebsite: (v) => (websiteOf(v) === null ? "bad" : null) });
  const by = (id: string) => nodes.find((n) => n.id === id)!;
  const a: Answers = { ...EMPTY, visitor: "Alex", name: "Asset Market", about: "A marketplace for digital assets.", audience: "Creators, buyers", goal: "Clear licences" };

  it("never asks for the person's name: they are signed in and greeted by it", () => {
    expect(nodes.map((n) => n.id)).toEqual(["name", "about", "website", "audience", "goal", "files", "summary", "github", "launch"]);
    expect(by("name").say(a)[0]).toMatch(/^Good (morning|afternoon|evening), Alex\. Welcome to SELISE/);
    expect(by("name").say({ ...a, visitor: "" })[0]).toMatch(/^Good (morning|afternoon|evening)\. Welcome/);
    expect(by("summary").say(a)).toEqual(["Hello Alex, I'm your business analyst. I've been following along.", "Here's what you told us about Asset Market."]);
  });

  it("lets the person type every answer, with the guided start's neutral chips only", () => {
    for (const id of ["name", "about", "audience", "goal"]) expect(by(id).ask!.kind === "text" || by(id).ask!.freeText).toBe(true);
    expect(by("website").ask!.freeText).toBe(true);
    expect(by("audience").ask!.chips).toEqual([...USER_CHIPS]);
    expect(by("goal").ask!.chips).toEqual([...GOAL_CHIPS]);
    expect(by("audience").ask!.chipMode).toBe("add");
    expect(by("goal").ask!.chipMode).toBe("add");
    // no scripted business analyst questions, no forced choice of where it runs
    expect(nodes.some((n) => /^f\d$/.test(n.id) || n.id === "env" || n.id === "visitor")).toBe(false);
  });

  it("says nothing canned: no story content and none of the words the product never shows", () => {
    const text = nodes.flatMap((n) => [...n.say(a), ...(n.walkTalk?.(a) ?? []), ...(n.ask?.chips ?? []), n.ask?.placeholder ?? "", ...[n.scripted].flat()]).join("\n");
    expect(text).not.toMatch(/\b(deliver|delivery|driver|route|cold store|Alpine|WebPilot|Sandra|Lea)\b/i);
    expect(text).not.toMatch(/\b(demo|mock|sample|fake|test data|prototype|placeholder|lorem|simulated|brownfield|greenfield)\b/i);
    expect(text).not.toMatch(/I've read/);
  });

  it("refuses what the project can't keep", () => {
    expect(by("name").check!("  ")).toBe("Enter a project name.");
    expect(by("name").check!("Asset Market")).toBeNull();
    expect(by("website").check!("Not yet")).toBeNull();
    expect(by("website").check!("www.assetmarket.io")).toBeNull();
    expect(by("website").check!("not a site")).toBe("bad");
  });

  it("creates a new product with the person's words, the code kept in MADP Factory", () => {
    const args = createArgsFor({ name: " Asset Market ", about: "A marketplace.", audience: "", goal: "" });
    expect(args).toMatchObject({ name: "Asset Market", projectType: "greenfield", description: "A marketplace.", setupStatus: "draft" });
    expect(args.repo).toBeUndefined();
    expect(args.newRepoOwner).toBeUndefined();
    expect(JSON.parse(args.setupAnswers)).toMatchObject({ kind: "new", repoChoice: "factory", name: "Asset Market" });
    expect(startAnswersOf({ name: "X", about: "Y", audience: "Creators", goal: "Licences" })).toMatchObject({ users: "Creators", goal: "Licences", description: "Y" });
  });

  it("keeps the website as the person gave it, normalised, and files it as a note", () => {
    expect(websiteOf("www.assetmarket.io")).toBe("https://www.assetmarket.io");
    expect(websiteOf("https://www.assetmarket.io/")).toBe("https://www.assetmarket.io/");
    expect(websiteOf("not a site")).toBeNull();
    expect(websiteLabel("https://www.assetmarket.io/")).toBe("www.assetmarket.io");
    expect(websiteNoteBody("https://www.assetmarket.io")).toBe("Our website: https://www.assetmarket.io");
  });
});
