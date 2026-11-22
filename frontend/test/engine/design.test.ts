// Historical screen/renderer helpers, plus the regression that product-design jobs never use the removed screenshot
// writer. The actual Make pipeline is covered in figmaMake.test.ts and figmaPlannerFlow.test.ts.
//   npx vitest run --config test/engine/vitest.config.ts test/engine/design.test.ts
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Row } from "../../functions/_lib/gateway";
import { setAiRunner, type AiRequest } from "../../server/local/engine/ai/index.ts";
import { acceptDesign, calm, heroColour, schemaBlocks } from "../../server/local/engine/kinds/scope/designAi.ts";
import { readableBrand, screenHtml, screenRenderer, type HtmlScreen } from "../../server/local/engine/kinds/scope/screenHtml.ts";
import { makeWorld, type World } from "./harness";

const s = (v: unknown) => (typeof v === "string" ? v : "");
const none = { title: "", text: "", value: "", items: [], columns: [], rows: [] };
const b = (kind: string, o: Record<string, unknown>) => ({ ...none, kind, ...o });
const it3 = (label: string, value = "", detail = "") => ({ label, value, detail });

/** A marketplace design as Claude answers it. */
function design(feature = "F1") {
  return {
    appName: "Northlight Assets",
    brandColour: "#4f46e5",
    screens: [
      {
        name: "Browse assets", feature, device: "desktop", navLabel: "Discover", subtitle: "Icons, fonts and templates from independent creators", signedIn: "Hannah Weber", search: "line icons",
        blocks: [
          b("filters", { value: "Most popular", items: [it3("All", "on"), it3("Icons"), it3("Fonts"), it3("Templates")] }),
          b("grid", { items: [it3("Line icon set, 240 icons", "CHF 24.00", "Mira Okafor · 4.8"), it3("Grotesk display font", "CHF 49.00", "Jonas Keller · 4.9"), it3("Pitch deck template", "CHF 29.00", "Lea Brunner")] }),
          b("button", { title: "Load more" }),
        ],
      },
      {
        name: "ASSET DETAILS", feature: "F9", device: "desktop", navLabel: "Asset", subtitle: "", signedIn: "Hannah Weber", search: "",
        blocks: [
          b("preview", { title: "Line icon set, 240 icons", text: "Crisp outline icons for apps and websites", items: [it3("Files", "SVG, PNG"), it3("Licence", "Commercial")] }),
          b("summary", { title: "Your order", items: [it3("Commercial licence", "CHF 24.00"), it3("VAT 8.1%", "CHF 1.94"), it3("Total", "CHF 25.94")] }),
          b("button", { title: "Buy now" }),
        ],
      },
      {
        name: "Seller payouts", feature: "", device: "mobile", navLabel: "Payouts", subtitle: "October", signedIn: "Mira Okafor", search: "",
        blocks: [
          b("stats", { items: [it3("Earned", "CHF 1,240", "+18% this month"), it3("Next payout", "CHF 860", "3 November")] }),
          b("table", { columns: ["Date", "Asset", "Amount", "Status"], rows: [["28 Oct", "Line icon set", "CHF 24.00", "Paid"], ["27 Oct", "Brand kit", "CHF 39.00", "In review"]] }),
          b("unknown", { title: "x" }),
        ],
      },
      {
        name: "Sample screen", feature: "", device: "desktop", navLabel: "Other", subtitle: "", signedIn: "", search: "",
        blocks: [b("hero", { title: "A demo of the shop" }), b("note", { text: "Lorem ipsum" })],
      },
    ],
  };
}

describe("Claude's screens are checked before they are drawn", () => {
  it("keeps the blocks the renderer knows, in sentence case, without staged words", () => {
    const f = { id: "f1", key: "browse", ref: "feature:browse", title: "Browse and search", description: "", priority: "must" as const, requirementRefs: [], sortOrder: 0, stories: [], hours: 4, words: new Set<string>(), text: "" };
    const d = acceptDesign(design(), { features: [f] })!;
    expect(d).not.toBeNull();
    expect(d.app).toBe("Northlight Assets");
    expect(d.brand).toBe("4f46e5");
    expect(d.screens.map((x) => x.name)).toEqual(["Browse assets", "Asset details", "Seller payouts"]); // the staged one is left out
    expect(d.screens[0]!.featureRef).toBe("feature:browse");
    expect(d.screens[0]!.blocks.map((x) => x.k)).toEqual(["filters", "grid", "button"]);
    expect(d.screens[0]!.blocks[1]).toMatchObject({ k: "grid", items: [{ title: "Line icon set, 240 icons", price: "CHF 24.00", creator: "Mira Okafor", rating: "4.8" }, {}, { creator: "Lea Brunner" }] });
    expect(d.screens[1]!.blocks[1]).toMatchObject({ k: "summary", lines: [["Commercial licence", "CHF 24.00"], ["VAT 8.1%", "CHF 1.94"]], total: ["Total", "CHF 25.94"] });
    expect(d.screens[2]!.blocks.map((x) => x.k)).toEqual(["stats", "table"]); // the unknown kind is dropped
    expect(d.screens[2]!.device).toBe("mobile");
  });

  it("answers null when fewer than three screens are usable, and keeps only the names of a re-generation", () => {
    const two = design();
    two.screens = two.screens.slice(0, 2);
    expect(acceptDesign(two, { features: [] })).toBeNull();
    expect(acceptDesign({ screens: "nope" }, { features: [] })).toBeNull();
    const again = acceptDesign(design(), { features: [], keep: ["Seller payouts", "Browse assets"] })!;
    expect(again.screens.map((x) => x.name).sort()).toEqual(["Browse assets", "Seller payouts"]);
    expect(calm("NEW ARRIVALS")).toBe("New arrivals");
    expect(calm("PNG, SVG")).toBe("PNG, SVG");
  });

  it("draws a page with the product's own content and the brand colour", () => {
    const spec: HtmlScreen = {
      device: "desktop", brand: "4f46e5", app: "Northlight Assets", title: "Browse assets", nav: ["Discover", "Payouts"], activeNav: 0, person: "Hannah Weber", search: "line <icons>",
      blocks: [{ k: "grid", items: [{ title: "Line icon set", price: "CHF 24.00", creator: "Mira Okafor", rating: "4.8" }, { title: "Grotesk font", price: "CHF 49.00", creator: "Jonas Keller" }] }, { k: "button", text: "Load more" }],
    };
    const html = screenHtml(spec, { font: null });
    expect(html).toContain("Line icon set");
    expect(html).toContain("CHF 49.00");
    expect(html).toContain("line &lt;icons&gt;");
    expect(html).toContain(">HW<");
    expect(html).not.toMatch(/text-transform:\s*uppercase/);
    expect(readableBrand("fde68a")).not.toBe("fde68a"); // a pale yellow is darkened so white text reads on it
  });
});

describe("buttons keep their words and a hero can have its own colour", () => {
  const one = (blocks: unknown[]) => acceptDesign({ screens: [{ name: "Home", device: "desktop", blocks }] }, { features: [], keep: ["Home"] })!.screens[0]!.blocks;

  it("takes a button's text from its text when the title is empty, and never a style word as the text", () => {
    const blocks = one([
      b("hero", { title: "Welcome to Café Lindenhof", text: "Seasonal lunch and coffee in the old town." }),
      b("stats", { items: [it3("Tables free tonight", "6"), it3("Rating", "4.7")] }),
      b("button", { text: "Book a table", value: "primary" }),
      b("button", { text: "See the menu", value: "secondary" }),
      b("button", { title: "secondary", text: "Send us a message" }),
      b("button", { value: "primary" }), // a style word and nothing else is no button
      b("button", { title: "Order online", value: "outline" }),
    ]);
    const buttons = blocks.filter((x) => x.k === "button");
    expect(buttons).toEqual([
      { k: "button", text: "Book a table" },
      { k: "button", text: "See the menu", secondary: true },
      { k: "button", text: "Send us a message", secondary: true },
      { k: "button", text: "Order online", secondary: true },
    ]);
    expect(JSON.stringify(blocks)).not.toMatch(/"text":"(primary|secondary)"/i);
  });

  it("accepts a hero colour only as a hex code or a plain colour name", () => {
    expect(heroColour("#0B2A5B")).toBe("0b2a5b");
    expect(heroColour("0b2a5b")).toBe("0b2a5b");
    expect(heroColour("#0af")).toBe("00aaff");
    expect(heroColour("navy")).toBe("1e3a6e");
    expect(heroColour("dark blue")).toBe("1f5fae");
    for (const junk of ["", "#12345", "#0b2a5bff", "Welcome back", "secondary", "url(x)", "red; background:url(x)", "<b>", null, 42]) expect(heroColour(junk)).toBeNull();
    const stats = b("stats", { items: [it3("A", "1"), it3("B", "2")] });
    expect(one([b("hero", { title: "Welcome", value: "#0B2A5B" }), stats])[0]).toEqual({ k: "hero", title: "Welcome", colour: "0b2a5b" });
    expect(one([b("hero", { title: "Welcome", value: "Book now" }), stats])[0]).toEqual({ k: "hero", title: "Welcome" }); // junk is ignored: the brand colour
  });

  it("draws a hero in its own colour (the deep end derived like the brand's), and others in the brand colour", () => {
    const spec = (blocks: HtmlScreen["blocks"]): HtmlScreen => ({ device: "desktop", brand: "7a4b2a", app: "Café Lindenhof", title: "Home", nav: ["Home"], activeNav: 0, blocks });
    const html = screenHtml(spec([{ k: "hero", title: "Welcome", colour: "0b2a5b" }, { k: "button", text: "Book a table" }]), { font: null });
    expect(html).toMatch(/<section class="hero" style="--b:#0b2a5b;--b40:#[0-9a-f]{6};--bd:#[0-9a-f]{6}">/);
    expect(html).toContain("--bd:#081e42"); // 0b2a5b mixed with black by 0.28, as --bd is from the brand
    expect(html).toContain(":root{--b:#7a4b2a;"); // the rest of the page keeps the brand
    expect(html).toContain(">Book a table<");
    for (const colour of [undefined, "zzzzzz", "0b2a5b\" onload=\"x"]) {
      expect(screenHtml(spec([{ k: "hero", title: "Welcome", ...(colour ? { colour } : {}) }]), { font: null })).toContain('<section class="hero"><h2>');
    }
    // a pale colour is darkened so the white text reads on it
    expect(screenHtml(spec([{ k: "hero", title: "Welcome", colour: "fde68a" }]), { font: null })).not.toContain("--b:#fde68a");
  });

  it("writes the blocks back in Claude's fields: accepting them again gives the same screen", () => {
    const first = acceptDesign(design(), { features: [] })!;
    const blocks = [
      ...first.screens.flatMap((s) => s.blocks),
      { k: "hero", title: "Welcome to Café Lindenhof", text: "Seasonal lunch.", colour: "0b2a5b" },
      { k: "card", title: "Tonight", lines: ["Open until 23:00", "Tables: 6"], badge: "Open" },
      { k: "steps", items: ["Pick a day", "Pick a time", "Confirm"], active: 1 },
      { k: "button", text: "See the menu", secondary: true },
    ] as HtmlScreen["blocks"];
    const asked = schemaBlocks(blocks);
    expect(asked.find((x) => x.kind === "hero" && x.value)).toMatchObject({ title: "Welcome to Café Lindenhof", value: "#0b2a5b" });
    expect(asked.filter((x) => x.kind === "button").map((x) => x.title)).toEqual(["Load more", "Buy now", "See the menu"]);
    expect(JSON.stringify(asked)).not.toMatch(/"k":/);
    // acceptDesign keeps seven blocks a screen: compare in sevens
    for (let i = 0; i < blocks.length; i += 7) {
      const part = acceptDesign({ screens: [{ name: "All", blocks: asked.slice(i, i + 7) }] }, { features: [], keep: ["All"] })!;
      expect(part.screens[0]!.blocks).toEqual(blocks.slice(i, i + 7));
    }
  });
});

describe("design.generate no longer runs the screenshot writer", () => {
  let w: World;
  let calls: AiRequest[] = [];
  beforeAll(async () => {
    w = await makeWorld();
  });
  afterAll(() => w?.close());
  afterEach(() => {
    setAiRunner(null);
    calls = [];
  });

  it("refuses a screenshot-era request without calling the screen model or writing PNGs", async () => {
    setAiRunner(async (r) => {
      calls.push(r);
      return design();
    });
    const payroll = w.project("Payroll Self-Service");
    const pid = s(payroll.ItemId);
    const brief = w.rows("DesignBrief", pid)[0]!;
    await w.gw.update("DesignBrief", s(brief.ItemId), { Status: "confirmed", ConfirmedAt: w.now().toISOString() });
    const id = await w.queue({ project: "Payroll Self-Service", kind: "design.generate", input: { projectId: pid, designBriefId: s(brief.ItemId) }, target: { type: "design-brief", id: s(brief.ItemId) } });
    await w.settle();
    const j = w.get("EngineJob", id);
    expect(j.Status, w.log.join("\n")).toBe("failed");
    expect(j.ErrorCode).toBe("design.figmaRequestRequired");
    expect(calls).toHaveLength(0);
    const rows = w.rows("DesignScreen", pid).filter((x: Row) => x.EngineJobId === id).sort((a, b) => Number(a.SortOrder) - Number(b.SortOrder));
    expect(rows).toEqual([]);
    expect(w.log.some((l) => /screens: .* rendered/.test(l))).toBe(false);
  });
});

describe("the HTML renderer", () => {
  it("photographs a desktop page at 1440 x 900 and a phone page at 2x (when Chromium starts here)", async () => {
    const logs: string[] = [];
    const r = screenRenderer({ mode: "html", log: (l) => logs.push(l) });
    try {
      const base = { brand: "4f46e5", app: "Northlight Assets", title: "Seller payouts", nav: ["Discover", "Payouts"], activeNav: 1, person: "Mira Okafor", blocks: [{ k: "stats" as const, items: [["Earned", "CHF 1,240 | +18%"], ["Next payout", "CHF 860"]] as [string, string][] }] };
      const desk = await r.render({ ...base, device: "desktop" });
      const phone = await r.render({ ...base, device: "mobile" });
      if (desk.via === "pixel") return; // no Chromium on this machine: the pixel fallback is covered above
      const dims = (png: Uint8Array) => [Buffer.from(png).readUInt32BE(16), Buffer.from(png).readUInt32BE(20)];
      expect(dims(desk.png)).toEqual([1440, 900]);
      expect([desk.width, desk.height]).toEqual([1440, 900]);
      expect(phone.via).toBe("html");
      expect(dims(phone.png)).toEqual([780, 1688]);
      expect([phone.width, phone.height]).toEqual([390, 844]);
    } finally {
      await r.close();
    }
  }, 60_000);
});
