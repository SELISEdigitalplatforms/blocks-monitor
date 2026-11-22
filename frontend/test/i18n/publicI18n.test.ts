// GET /api/public/i18n/<culture>[/<module>]: the UILM texts with their module prefix, nothing else (no token, no id,
// no upstream error), kept five minutes per module, limited per address, a 503 only when nothing could be read.
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { I18N_CACHE_MS, I18N_FAILURE_CACHE_MS, createPublicI18nHandler, prefixed, type ReadModule } from "../../server/fnHost/publicI18n";
import { I18N_MODULES } from "../../src/i18n/modules";

interface Answer { status: number; headers: Record<string, string>; body: string }

function request(handler: ReturnType<typeof createPublicI18nHandler>, o: { method?: string; url?: string; ip?: string; host?: string } = {}): Promise<Answer> {
  const headers: Record<string, string> = {};
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      setHeader(k: string, v: string) { headers[k.toLowerCase()] = v; },
      end(body: string) { resolve({ status: res.statusCode, headers, body }); },
    };
    const req = { method: o.method ?? "GET", url: o.url ?? "/de-CH", headers: { host: o.host ?? "factory.example.org" }, socket: { remoteAddress: o.ip ?? "203.0.113.7" } };
    void handler(req as unknown as IncomingMessage, res as unknown as ServerResponse);
  });
}

const UILM: Record<string, Record<string, unknown>> = {
  shell: { "top.search": "Suchen", "top.bell": "Mitteilungen" },
  common: { "language.label": "Sprache", "bad key": "x", "empty": "", "number": 7 },
};

function setup(o: { read?: ReadModule; now?: () => number; perMinute?: number } = {}) {
  const read = vi.fn<ReadModule>(o.read ?? (async (module) => {
    if (module === "billing") throw Object.assign(new Error("upstream said: token abc.def.ghi expired"), { status: 401 });
    return UILM[module] ?? {};
  }));
  const handler = createPublicI18nHandler({ read, expectedHost: "factory.example.org", now: o.now, perMinute: o.perMinute });
  return { read, handler };
}

describe("GET /api/public/i18n", () => {
  it("answers every module's texts with their module prefix, only valid string texts", async () => {
    const { handler, read } = setup();
    const a = await request(handler);
    expect(a.status).toBe(200);
    const body = JSON.parse(a.body);
    expect(body).toEqual({ ok: true, data: { culture: "de-CH", texts: {
      "shell.top.search": "Suchen", "shell.top.bell": "Mitteilungen", "common.language.label": "Sprache",
    } } });
    expect(read).toHaveBeenCalledTimes(I18N_MODULES.length);
    expect(read).toHaveBeenCalledWith("shell", "de-CH");
    expect(a.headers["cache-control"]).toBe("public, max-age=300");
    expect(a.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("answers one module", async () => {
    const { handler, read } = setup();
    const a = await request(handler, { url: "/de-CH/shell" });
    expect(JSON.parse(a.body).data.texts).toEqual({ "shell.top.search": "Suchen", "shell.top.bell": "Mitteilungen" });
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("never passes an upstream error, a token or an id on", async () => {
    const { handler } = setup();
    const a = await request(handler, { url: "/de-CH/billing" });
    expect(a.status).toBe(503);
    expect(a.body).toBe(JSON.stringify({ ok: false, error: { code: "unavailable" } }));
    expect(a.body).not.toMatch(/token|abc\.def|upstream/);
    const all = await request(handler);
    expect(all.body).not.toMatch(/token|abc\.def|upstream|itemId|tenant/i);
  });

  it("keeps each module five minutes, a failure half a minute, and shares a read in flight", async () => {
    let t = 1_000_000;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let fail = true;
    const { handler, read } = setup({ now: () => t, read: async (module) => {
      await gate;
      if (module === "shell" && fail) throw new Error("down");
      return UILM[module] ?? {};
    } });
    const first = request(handler, { url: "/de-CH/common" });
    const second = request(handler, { url: "/de-CH/common" });
    release();
    await Promise.all([first, second]);
    expect(read).toHaveBeenCalledTimes(1);
    await request(handler, { url: "/de-CH/common" });
    expect(read).toHaveBeenCalledTimes(1);
    t += I18N_CACHE_MS + 1;
    await request(handler, { url: "/de-CH/common" });
    expect(read).toHaveBeenCalledTimes(2);

    expect((await request(handler, { url: "/de-CH/shell" })).status).toBe(503);
    fail = false;
    expect((await request(handler, { url: "/de-CH/shell" })).status).toBe(503);
    expect(read).toHaveBeenCalledTimes(3);
    t += I18N_FAILURE_CACHE_MS + 1;
    expect((await request(handler, { url: "/de-CH/shell" })).status).toBe(200);
    expect(read).toHaveBeenCalledTimes(4);
  });

  it("is limited per address", async () => {
    const { handler } = setup({ perMinute: 3 });
    for (let i = 0; i < 3; i++) expect((await request(handler, { url: "/de-CH/shell" })).status).toBe(200);
    const limited = await request(handler, { url: "/de-CH/shell" });
    expect(limited.status).toBe(429);
    expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);
    expect((await request(handler, { url: "/de-CH/shell", ip: "198.51.100.9" })).status).toBe(200);
  });

  it("refuses other methods, hosts, languages, modules and paths", async () => {
    const { handler, read } = setup();
    expect((await request(handler, { method: "POST" })).status).toBe(405);
    expect((await request(handler, { host: "evil.example.org" })).status).toBe(404);
    expect((await request(handler, { url: "/fr-CH" })).status).toBe(404);
    expect((await request(handler, { url: "/de-CH/secrets" })).status).toBe(404);
    expect((await request(handler, { url: "/de-CH/shell/more" })).status).toBe(404);
    expect((await request(handler, { url: "/" })).status).toBe(404);
    expect((await request(handler, { url: "/..%2F..%2Fetc" })).status).toBe(404);
    expect(read).not.toHaveBeenCalled();
  });

  it("answers an empty dictionary on a host without UILM (the local adapter)", async () => {
    const handler = createPublicI18nHandler({ read: null });
    const a = await request(handler);
    expect(a.status).toBe(200);
    expect(JSON.parse(a.body).data.texts).toEqual({});
  });

  it("bounds what a module brings and keeps a key already carrying its module", () => {
    expect(prefixed("shell", { "shell.top.search": "Suchen", "top.bell": "Glocke", "x": "y".repeat(5000) })).toEqual({
      "shell.top.search": "Suchen", "shell.top.bell": "Glocke",
    });
  });
});
