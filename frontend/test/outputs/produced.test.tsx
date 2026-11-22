// What MADP produced: the list read from GET /api/outputs/:id (every answer the server gives), the file links, and the
// page rendered with the real components in each state (no network: fetch is replaced per test).
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchOutputText, fetchOutputs, groupOutputItems, outputFileUrl, outputSize, parseOutputsManifest, type OutputsResult,
} from "../../src/data/outputs";

const { ProducedContent } = await import("../../src/components/outputs/ProducedView");

const PROJECT = "3f6c2a9e-0b1d-4c55-9a7e-2d8f1b6c4e10";

const MANIFEST = {
  schema: "madp-outputs/1",
  projectId: PROJECT,
  workspaceId: "ws-1",
  name: "Digital Asset Market",
  generatedAt: "2026-10-31T17:02:00.000Z",
  summary: "3 builds, live on production as 1.0.0",
  facts: [{ label: "Requirements", value: "11" }, { label: "Latest version", value: "1.0.0" }],
  sections: [
    {
      id: "requirements", title: "Requirements (BRD and PRD)", summary: "What the client needs, written down and checked.",
      items: [
        { path: "brd/BRD-v1.md", title: "Business requirements", summary: "11 requirements", kind: "md", bytes: 12_400, updatedAt: "2026-10-31T12:00:00.000Z" },
      ],
    },
    {
      id: "builds", title: "Builds", summary: "Each milestone's build and its review.",
      items: [
        { path: "specs/M01-listing/REVIEW-DIGITAL-ASSET-MARKET-M01-v1.yaml", title: "Review report — milestone 1", summary: "Passed · 0 findings · 52 files checked",
          kind: "yaml", bytes: 3_200, updatedAt: "2026-10-31T13:00:00.000Z", status: "pass", group: "Milestone 1 · 0.1.0" },
        { path: "specs/M01-listing/preview.html", title: "Screens preview", summary: "", kind: "html", bytes: 48_000,
          updatedAt: "2026-10-31T13:05:00.000Z", group: "Milestone 1 · 0.1.0" },
        { path: "specs/M02-checkout/REVIEW-M02-v1.yaml", title: "Review report — milestone 2", summary: "2 findings to fix",
          kind: "yaml", bytes: 2_900, updatedAt: "2026-10-31T15:00:00.000Z", status: "fail", group: "Milestone 2 · 0.2.0" },
      ],
    },
  ],
};

function answer(status: number, body?: unknown, headers: Record<string, string> = {}) {
  return new Response(body === undefined ? null : typeof body === "string" ? body : JSON.stringify(body), { status, headers });
}

afterEach(() => vi.unstubAllGlobals());

describe("the outputs list", () => {
  it("reads the manifest with the session cookie from the project's address", async () => {
    const fetchMock = vi.fn(async () => answer(200, MANIFEST, { "content-type": "application/json" }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await fetchOutputs(PROJECT);
    expect(r.status).toBe("ok");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`/api/outputs/${PROJECT}`);
    expect(init.credentials).toBe("same-origin");
    if (r.status !== "ok") return;
    expect(r.manifest.name).toBe("Digital Asset Market");
    expect(r.manifest.facts).toEqual(MANIFEST.facts);
    expect(r.manifest.sections.map((s) => s.items.length)).toEqual([1, 3]);
    expect(r.manifest.sections[1].items[0]).toMatchObject({ status: "pass", group: "Milestone 1 · 0.1.0", kind: "yaml" });
  });

  it.each([
    [404, "empty"], [401, "signed-out"], [503, "unavailable"], [500, "unavailable"],
  ] as const)("answers %i as %s", async (code, status) => {
    vi.stubGlobal("fetch", vi.fn(async () => answer(code, { error: "x" })));
    expect((await fetchOutputs(PROJECT)).status).toBe(status);
  });

  it("is unavailable when the server is not reached or answers something else", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("network"); }));
    expect((await fetchOutputs(PROJECT)).status).toBe("unavailable");
    vi.stubGlobal("fetch", vi.fn(async () => answer(200, { ...MANIFEST, schema: "madp-outputs/2" })));
    expect((await fetchOutputs(PROJECT)).status).toBe("unavailable");
    vi.stubGlobal("fetch", vi.fn(async () => answer(200, "<html>")));
    expect((await fetchOutputs(PROJECT)).status).toBe("unavailable");
  });

  it("keeps every listed file: an unknown kind opens in a new tab, an unknown status shows no badge", () => {
    const m = parseOutputsManifest({
      ...MANIFEST,
      sections: [{ id: "x", title: "Other", summary: "", items: [
        { path: "a/report.pdf", title: "", summary: "", kind: "pdf", bytes: 10, updatedAt: "", status: "weird" },
        { title: "no path" },
      ] }],
    });
    expect(m?.sections[0].items).toEqual([{ path: "a/report.pdf", title: "report.pdf", summary: "", kind: "other", bytes: 10, updatedAt: "" }]);
  });

  it("builds file addresses with the path encoded, and the download address", () => {
    const p = "specs/M01-listing/REVIEW M01 v1.yaml";
    expect(outputFileUrl(PROJECT, p)).toBe(`/api/outputs/${PROJECT}/file?path=specs%2FM01-listing%2FREVIEW%20M01%20v1.yaml`);
    expect(outputFileUrl(PROJECT, p, true)).toBe(`/api/outputs/${PROJECT}/file?path=specs%2FM01-listing%2FREVIEW%20M01%20v1.yaml&download=1`);
  });

  it("groups a section's files by their group, in order, loose files first", () => {
    const items = parseOutputsManifest(MANIFEST)!.sections[1].items;
    const loose = { ...items[0], path: "x.md", group: undefined };
    expect(groupOutputItems([...items, loose]).map((g) => [g.group, g.items.length])).toEqual([
      [null, 1], ["Milestone 1 · 0.1.0", 2], ["Milestone 2 · 0.2.0", 1],
    ]);
  });

  it("formats sizes", () => {
    expect([outputSize(840), outputSize(12_400), outputSize(1_400_000)]).toEqual(["840 B", "12 KB", "1.4 MB"]);
  });
});

describe("the in-app reader", () => {
  it("shows JSON indented and refuses files that are too large", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => answer(200, '{"a":1}', { "content-type": "application/json" })));
    expect(await fetchOutputText(PROJECT, { path: "x.json", kind: "json" })).toEqual({ status: "ok", text: '{\n  "a": 1\n}' });
    vi.stubGlobal("fetch", vi.fn(async () => answer(200, "x", { "content-length": "5000000" })));
    expect((await fetchOutputText(PROJECT, { path: "big.log", kind: "log" })).status).toBe("too-large");
    vi.stubGlobal("fetch", vi.fn(async () => answer(401)));
    expect((await fetchOutputText(PROJECT, { path: "x.md", kind: "md" })).status).toBe("signed-out");
  });
});

const page = (result: OutputsResult | null) => renderToStaticMarkup(
  <MemoryRouter><ProducedContent projectId={PROJECT} eyebrow="Acme · Digital Asset Market" result={result} onRefresh={() => {}} /></MemoryRouter>,
);
const BANNED = /prototype|mock|demo|sample|fake|test data|simulated/i;

describe("the page", () => {
  it("shows the project, the summary, the facts and every section with its files", () => {
    const html = page({ status: "ok", manifest: parseOutputsManifest(MANIFEST)! });
    for (const text of ["What MADP produced", "Acme · Digital Asset Market", "3 builds, live on production as 1.0.0", "4 files",
      "Requirements", "11", "Latest version", "1.0.0", "Requirements (BRD and PRD)", "Builds", "Milestone 1 · 0.1.0", "Milestone 2 · 0.2.0",
      "Business requirements", "Review report — milestone 1", "Passed", "Failed", "Passed · 0 findings · 52 files checked", "12 KB"]) {
      expect(html).toContain(text);
    }
    // a web page opens in a new tab; every file downloads from its own address
    expect(html).toContain(`href="/api/outputs/${PROJECT}/file?path=specs%2FM01-listing%2Fpreview.html" target="_blank"`);
    expect(html).toContain(`href="/api/outputs/${PROJECT}/file?path=brd%2FBRD-v1.md&amp;download=1" download=""`);
    expect(html.match(/>Download</g)?.length).toBe(4);
    expect(html.replace(/<[^>]+>/g, " ")).not.toMatch(BANNED);
  });

  it("says nothing is here yet when nothing was produced", () => {
    const html = page({ status: "empty" });
    expect(html).toContain("Nothing here yet");
    expect(html).toContain("MADP saves what it produces here as it works on the project.");
    const none = page({ status: "ok", manifest: { ...parseOutputsManifest(MANIFEST)!, sections: [] } });
    expect(none).toContain("Nothing here yet");
  });

  it("asks to sign in again, says when it is unavailable, and shows a quiet outline while loading", () => {
    expect(page({ status: "signed-out" })).toContain("Sign in again");
    expect(page({ status: "unavailable" })).toContain("Try again");
    const loading = page(null);
    expect(loading).toContain('aria-busy="true"');
    expect(loading).toContain("Loading what MADP produced");
  });
});
