// The engine's privacy guard (server/blocks/engineWorker/privacy.ts): nothing private leaves the engine host.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PRIVATE, privateRaw, scrub, scrubFile, scrubText } from "../../server/blocks/engineWorker/privacy";
import type { RawGateway, Row } from "../../functions/_lib/gateway";

const termsEnv = (lines: string[]) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "privacy-"));
  const file = path.join(dir, "terms.txt");
  fs.writeFileSync(file, ["# private terms of this host", ...lines].join("\n"));
  return { MF_PRIVATE_TERMS_FILE: file } as NodeJS.ProcessEnv;
};

describe("the engine's privacy guard", () => {
  it("removes links into the design tool, in any form", () => {
    const t = scrubText("See https://www.figma.com/design/AbC123/Shop?node-id=1-2 and https://cat-scoot-1.figma.site/ and figma.com/make/XyZ/app.", {});
    expect(t).not.toMatch(/figma/i);
    expect(t.split(PRIVATE).length - 1).toBe(3);
  });

  it("removes provider tokens", () => {
    const secrets = [
      "figd_abcdefghijklmnopqrstuvwxyz012345",
      "sk-ant-oat01-abcdefghijklmnopqrstuvwxyz",
      "sk-proj-abcdefghijklmnopqrstuvwxyz0123456789",
      "ghp_abcdefghijklmnopqrstuvwxyz0123",
      "AIzaSyAabcdefghijklmnopqrstuvwxyz012345",
      "Bearer abcdefghijklmnopqrstuvwxyz0123456789",
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop",
    ];
    for (const s of secrets) expect(scrubText(`token: ${s} end`, {})).toBe(`token: ${PRIVATE} end`);
  });

  it("removes the host's private terms (e-mail addresses, account names), case-insensitively", () => {
    const env = termsEnv(["owner.person@example.com", "owner-host-login"]);
    expect(scrubText("Signed in as Owner.Person@Example.com on owner-host-login.", env)).toBe(`Signed in as ${PRIVATE} on ${PRIVATE}.`);
  });

  it("leaves ordinary project data as it is (ids, names, normal links, JSON)", () => {
    const row = {
      ItemId: "6b147b04-0b90-48de-af00-46296c8de60b",
      Title: "Book a table",
      Url: "https://dbsaun.slsblx.com:5321/p1/v/0.1.0/",
      Analysis: JSON.stringify({ summary: "A dark-blue header", tickets: [{ title: "Header" }] }),
      Count: 3,
      Done: true,
    };
    expect(scrub(row, {})).toEqual(row);
  });

  it("keeps JSON in a text field valid when something inside it is removed", () => {
    const v = scrubText(JSON.stringify({ design: "https://www.figma.com/design/AbC/x", note: "ok" }), {});
    expect(JSON.parse(v)).toEqual({ design: PRIVATE, note: "ok" });
  });

  it("scrubs every row the engine writes, and passes reads through", async () => {
    const written: Row[] = [];
    const raw: RawGateway = {
      get: async () => ({ ItemId: "r1", Text: "https://www.figma.com/file/keep-on-read" }),
      find: async () => ({ items: [], totalCount: 0 }),
      findAll: async () => [],
      insert: async (_s, row) => { written.push(row); return { created: true, itemId: "r1" }; },
      insertMany: async (_s, rows) => { written.push(...rows); return { created: rows.length, existing: 0 }; },
      update: async (_s, _id, patch) => { written.push(patch); },
      updateMany: async (_s, _w, patch) => { written.push(patch); return { matched: 1 }; },
      remove: async () => undefined,
    };
    const env = termsEnv(["owner.person@example.com"]);
    const g = privateRaw(raw, env);
    await g.insert("FeedbackComment", { Text: "Updated in https://www.figma.com/design/AbC/x by owner.person@example.com" });
    await g.insertMany("Ticket", [{ Description: "token figd_abcdefghijklmnopqrstuvwxyz012345" }]);
    await g.update("EngineJob", "j1", { Message: "Signed in as owner.person@example.com" });
    await g.updateMany("DesignBrief", { ItemId: "b1" } as never, { PrototypeJson: JSON.stringify({ url: "https://x.figma.site/" }) });
    expect(JSON.stringify(written)).not.toMatch(/figma|owner\.person|figd_/i);
    expect(written).toHaveLength(4);
    // reads are not changed (the guard is on the way out)
    expect((await g.get("FeedbackComment", "r1", ["Text"]))?.Text).toContain("figma.com");
  });

  it("scrubs text files and passes pictures as they are", () => {
    const html = new TextEncoder().encode('<a href="https://www.figma.com/design/AbC/x">design</a>');
    expect(new TextDecoder().decode(scrubFile("text/html; charset=utf-8", html))).toBe(`<a href="${PRIVATE}">design</a>`);
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, ...new TextEncoder().encode("https://www.figma.com/x")]);
    expect(scrubFile("image/png", png)).toBe(png);
  });
});
