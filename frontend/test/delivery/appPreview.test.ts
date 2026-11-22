// The app page of a deployed version: its link, what the version holds, which screen shows which feature, the pages.
import { describe, expect, it } from "vitest";
import {
  appEnvironmentOf, appInitials, appLink, appPages, appPreviewPath, inkOn, screenFeatures, versionFeatures,
} from "../../src/domain/appPreview";
import { releaseLinkState } from "../../src/components/delivery/releaseUi";

const ORIGIN = "http://localhost:5310";

describe("the link", () => {
  it("opens the version's app page; staging and production say so", () => {
    expect(appPreviewPath("p1", "0.2.1")).toBe("/preview/p1/0.2.1");
    expect(appPreviewPath("p1", "1.3.0", "stage")).toBe("/preview/p1/1.3.0?env=staging");
    expect(appPreviewPath("p1", "1.3.0", "production")).toBe("/preview/p1/1.3.0?env=production");
    expect(appEnvironmentOf("staging")).toBe("stage");
    expect(appEnvironmentOf("production")).toBe("production");
    expect(appEnvironmentOf(null)).toBe("dev");
    expect(appEnvironmentOf("anything")).toBe("dev");
  });

  it("links a deployed preview or release to its page and keeps its address to show", () => {
    expect(appLink({ projectId: "p1", version: "0.1.0", url: "https://m1-driver.dev.alpine-fresh.ch" }, ORIGIN))
      .toEqual({ href: `${ORIGIN}/preview/p1/0.1.0`, host: "m1-driver.dev.alpine-fresh.ch" });
    expect(appLink({ projectId: "p1", version: "1.1.0", url: "https://service.talwerk-fluid.de/", environment: "production" }, ORIGIN))
      .toEqual({ href: `${ORIGIN}/preview/p1/1.1.0?env=production`, host: "service.talwerk-fluid.de" });
  });

  it("never links a version without an https address", () => {
    expect(appLink({ projectId: "p1", version: "0.1.0", url: "" }, ORIGIN)).toBeNull();
    expect(appLink({ projectId: "p1", version: "0.1.0", url: "http://m1.example.ch" }, ORIGIN)).toBeNull();
    expect(appLink({ projectId: "p1", version: "0.1.0", url: null }, ORIGIN)).toBeNull();
  });

  it("opens a real build at its own address (an address with a path)", () => {
    expect(appLink({ projectId: "p1", version: "0.1.0", url: "https://dbsaun.slsblx.com:5321/p1/v/0.1.0/" }, ORIGIN))
      .toEqual({ href: "https://dbsaun.slsblx.com:5321/p1/v/0.1.0/", host: "dbsaun.slsblx.com:5321" });
    expect(appLink({ projectId: "p1", version: "1.0.0", url: "https://dbsaun.slsblx.com:5321/p1/", environment: "production" }, ORIGIN)?.href)
      .toBe("https://dbsaun.slsblx.com:5321/p1/");
  });

  it("keeps the address itself when the record names no project", () => {
    expect(appLink({ version: "1.0.0", url: "https://app.example.ch" }, ORIGIN)).toEqual({ href: "https://app.example.ch/", host: "app.example.ch" });
  });

  it("the release cards use the same link", () => {
    const s = releaseLinkState("stage", { projectId: "p1", version: "1.2.0", url: "https://service-stage.talwerk-fluid.de" });
    expect(s.kind).toBe("link");
    if (s.kind === "link") {
      expect(s.href.endsWith("/preview/p1/1.2.0?env=staging")).toBe(true);
      expect(s.host).toBe("service-stage.talwerk-fluid.de");
    }
    expect(releaseLinkState("production", { projectId: "p1", version: "1.2.0", url: "" }).kind).toBe("waiting");
    expect(releaseLinkState("dev", { projectId: "p1", version: "1.2.0", url: "" }).kind).toBe("none");
  });
});

const MS = [
  { id: "m2", number: 2, sortOrder: 1, featureRefs: ["feature:proof", "feature:temp"], status: "done" },
  { id: "m1", number: 1, sortOrder: 0, featureRefs: ["feature:route"], status: "done" },
  { id: "m3", number: 3, sortOrder: 2, featureRefs: ["feature:sync", "feature:dispatch"], status: "planned" },
];

describe("what a version holds", () => {
  it("a milestone preview holds everything built up to its milestone; its own features are new", () => {
    expect(versionFeatures(MS, { kind: "preview", milestoneId: "m2" })).toEqual({
      refs: ["feature:route", "feature:proof", "feature:temp"], newRefs: ["feature:proof", "feature:temp"],
    });
  });

  it("the first milestone is all new, so nothing is singled out", () => {
    expect(versionFeatures(MS, { kind: "preview", milestoneId: "m1" })).toEqual({ refs: ["feature:route"], newRefs: [] });
  });

  it("a release holds the built milestones (all of them when none is marked built)", () => {
    expect(versionFeatures(MS, { kind: "release" }).refs).toEqual(["feature:route", "feature:proof", "feature:temp"]);
    expect(versionFeatures(MS.map((m) => ({ ...m, status: "planned" })), { kind: "release" }).refs).toHaveLength(5);
  });

  it("an unknown milestone holds nothing", () => {
    expect(versionFeatures(MS, { kind: "preview", milestoneId: "nope" })).toEqual({ refs: [], newRefs: [] });
  });
});

describe("which screen shows which feature", () => {
  const service = [
    { ref: "feature:visit-list", name: "My visits", description: "Today's visits of a technician from the existing planning." },
    { ref: "feature:visit-report", name: "Digital service report", description: "Work done, hours of every technician and measurements." },
    { ref: "feature:parts-used", name: "Parts used", description: "Pick parts used from the van's stock." },
    { ref: "feature:customer-signature", name: "Customer sign-off and PDF report", description: "The customer signs; the PDF goes out and the ERP order is updated." },
    { ref: "feature:service-desk", name: "Service desk overview", description: "Open and signed reports for the service desk." },
  ];
  const shop = [
    { ref: "feature:part-finder", name: "Part finder", description: "Find the pump by serial number or model code." },
    { ref: "feature:parts-catalogue", name: "Parts list and exploded view", description: "The parts list of a pump next to its exploded drawing." },
    { ref: "feature:customer-prices", name: "Net prices and stock", description: "The customer's net price and stock per warehouse on every line." },
    { ref: "feature:checkout", name: "Cart and order", description: "Order on invoice to one of the partner's delivery addresses; the order becomes an ERP sales order." },
    { ref: "feature:order-tracking", name: "Order tracking", description: "Order status from confirmed to shipped with the tracking link." },
  ];

  it("matches screens by the words of their names", () => {
    const s = (id: string, name: string, sortOrder = 0) => ({ id, name, sortOrder });
    const a = screenFeatures(service, [s("1", "My visits today"), s("2", "Visit report"), s("3", "Parts used"), s("4", "Service desk overview")]);
    expect([...a.values()]).toEqual(["feature:visit-list", "feature:visit-report", "feature:parts-used", "feature:service-desk"]);
    const b = screenFeatures(shop, [s("1", "Find your pump"), s("2", "Parts list"), s("3", "Cart and order"), s("4", "Order status (phone)")]);
    expect([...b.values()]).toEqual(["feature:part-finder", "feature:parts-catalogue", "feature:checkout", "feature:order-tracking"]);
  });

  it("an explicit link wins; a screen sharing no word belongs to none", () => {
    const m = screenFeatures([{ ref: "feature:a", name: "Order desk", description: "", screenIds: ["x"] }, { ref: "feature:b", name: "Sign in", description: "" }],
      [{ id: "x", name: "Sign in", sortOrder: 0 }, { id: "y", name: "Welcome", sortOrder: 1 }]);
    expect(m.get("x")).toBe("feature:a");
    expect(m.get("y")).toBeNull();
  });
});

describe("the pages", () => {
  const features = [
    { ref: "feature:route", name: "Route of the day", description: "Today's stops in order." },
    { ref: "feature:proof", name: "Proof of delivery", description: "Signature or photo at each stop." },
    { ref: "feature:sync", name: "Offline sync", description: "Offline queue." },
  ];
  const screens = [
    { id: "s-proof", name: "Proof of delivery", sortOrder: 2 },
    { id: "s-route", name: "Route of the day (phone)", sortOrder: 1 },
    { id: "s-sign", name: "Sign in", sortOrder: 0 },
  ];

  it("general screens first, then each feature's screens or a page of its own; titles without design notes", () => {
    const pages = appPages({ features, screens, refs: ["feature:route", "feature:sync"], newRefs: ["feature:sync"] });
    expect(pages.map((p) => [p.title, p.screenId, p.isNew])).toEqual([
      ["Sign in", "s-sign", false],
      ["Route of the day", "s-route", false],
      ["Offline sync", null, true],
    ]);
  });
});

describe("the app's mark and colour", () => {
  it("two letters and readable text", () => {
    expect(appInitials("Spare Parts Webshop")).toBe("SP");
    expect(appInitials("Portal")).toBe("PO");
    expect(inkOn([31, 41, 55])).toBe("#ffffff");
    expect(inkOn([250, 220, 120])).toBe("#111827");
  });
});
