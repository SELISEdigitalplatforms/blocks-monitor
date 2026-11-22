import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createBlocksSessions, sessionStoreFile, sessionStoreKey } from "../../server/blocks/sessions";

const tokens = { accessToken: "server-access-secret", refreshToken: "server-refresh-secret", userId: "user-1", expiresAtMs: 1_000_000 };
function response() {
  // Header names are case-insensitive on a real ServerResponse; the mock normalizes like Node does.
  const headers = new Map<string, unknown>();
  return {
    headers,
    res: {
      getHeader: (key: string) => headers.get(key.toLowerCase()),
      setHeader: (key: string, value: unknown) => {
        headers.delete(key.toLowerCase());
        headers.set(key.toLowerCase(), value);
      },
    } as unknown as ServerResponse,
  };
}
const request = (cookie?: string) => ({ headers: cookie ? { cookie } : {} }) as IncomingMessage;
const cookieOf = (r: ReturnType<typeof response>) => (r.headers.get("set-cookie") as string[])[0].split(";")[0];

describe("opaque Node BFF sessions", () => {
  it("keeps all tokens server-side and uses secure cookie flags", async () => {
    const store = createBlocksSessions({ refresh: vi.fn() }, () => 1000);
    const r = response();
    store.create(request(), r.res, tokens);
    const set = String(r.headers.get("set-cookie"));
    expect(set).toContain("HttpOnly");
    expect(set).toContain("SameSite=Lax");
    expect(set).toContain("Secure");
    expect(set).not.toContain(tokens.accessToken);
    expect(set).not.toContain(tokens.refreshToken);
    expect(await store.read(request(cookieOf(r)), response().res)).toMatchObject({ state: "ok", session: { userId: "user-1" } });
  });
  it("does not resume a cookie after the process store is replaced", async () => {
    const first = createBlocksSessions({ refresh: vi.fn() }, () => 1000);
    const r = response(); first.create(request(), r.res, tokens);
    const second = createBlocksSessions({ refresh: vi.fn() }, () => 1000);
    expect(await second.read(request(cookieOf(r)), response().res)).toEqual({ state: "none" });
  });
  it("refreshes concurrent requests only once and refuses changed identity", async () => {
    const refresh = vi.fn().mockResolvedValue({ ok: true, tokens: { ...tokens, userId: "other" } });
    const store = createBlocksSessions({ refresh }, () => 999_999);
    const r = response(); store.create(request(), r.res, tokens);
    const req = request(cookieOf(r));
    const results = await Promise.all([store.read(req, response().res), store.read(req, response().res)]);
    expect(refresh).toHaveBeenCalledOnce();
    expect(results.every((value) => value.state === "ended")).toBe(true);
  });
  it("revokes all stored sessions for a deactivated user", async () => {
    const store = createBlocksSessions({ refresh: vi.fn() }, () => 1000);
    const r = response(); store.create(request(), r.res, tokens);
    store.revokeUser(tokens.userId);
    expect(await store.read(request(cookieOf(r)), response().res)).toEqual({ state: "none" });
  });
  it("logout during refresh cannot resurrect a session", async () => {
    let finish!: (value: unknown) => void;
    const refresh = vi.fn().mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const store = createBlocksSessions({ refresh }, () => 999_999);
    const r = response(); store.create(request(), r.res, tokens);
    const req = request(cookieOf(r));
    const pending = store.read(req, response().res);
    store.end(req, response().res);
    finish({ ok: true, tokens });
    expect(await pending).toEqual({ state: "ended" });
  });
});

describe("sessions kept across a restart", () => {
  const key = sessionStoreKey("a-server-secret-of-enough-length", "tenant-1")!;
  const storeIn = () => join(mkdtempSync(join(tmpdir(), "mf-sessions-")), "nested", "sessions.enc");

  it("derives a 32-byte key only from a real secret, and one store file per app origin", () => {
    expect(key.length).toBe(32);
    expect(sessionStoreKey(undefined, "t")).toBeNull();
    expect(sessionStoreKey("short", "t")).toBeNull();
    expect(sessionStoreKey("a-server-secret-of-enough-length", "tenant-2")!.equals(key)).toBe(false);
    expect(sessionStoreFile("https://a:5310", "/h")).toMatch(/^\/h\/\.config\/madp-factory\/blocks-sessions-[a-f0-9]{12}\.enc$/);
    expect(sessionStoreFile("https://a:5310", "/h")).not.toBe(sessionStoreFile("https://a:5311", "/h"));
  });
  it("resumes a cookie after the process store is replaced, from an encrypted mode-600 file", async () => {
    const file = storeIn();
    const first = createBlocksSessions({ refresh: vi.fn() }, () => 1000, { file, key });
    const r = response(); first.create(request(), r.res, tokens);
    const sealed = readFileSync(file, "utf8");
    expect(sealed).not.toContain(tokens.accessToken);
    expect(sealed).not.toContain(tokens.refreshToken);
    expect(sealed).not.toContain(cookieOf(r).split("=")[1]);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readdirSync(join(file, "..")).filter((n) => n.endsWith(".tmp"))).toEqual([]);
    const second = createBlocksSessions({ refresh: vi.fn() }, () => 2000, { file, key });
    expect(await second.read(request(cookieOf(r)), response().res)).toMatchObject({ state: "ok", session: { userId: "user-1", accessToken: tokens.accessToken } });
  });
  it("keeps logout and expiry after a restart", async () => {
    const file = storeIn();
    const first = createBlocksSessions({ refresh: vi.fn() }, () => 1000, { file, key });
    const a = response(); first.create(request(), a.res, tokens);
    const b = response(); first.create(request(), b.res, tokens);
    first.end(request(cookieOf(a)), response().res);
    const second = createBlocksSessions({ refresh: vi.fn() }, () => 1000, { file, key });
    expect(await second.read(request(cookieOf(a)), response().res)).toEqual({ state: "none" });
    expect((await second.read(request(cookieOf(b)), response().res)).state).toBe("ok");
    const later = createBlocksSessions({ refresh: vi.fn() }, () => 1000 + 8 * 60 * 60 * 1000, { file, key });
    expect(await later.read(request(cookieOf(b)), response().res)).toEqual({ state: "none" });
  });
  it("starts empty, without throwing, on a wrong key or a damaged file", async () => {
    const file = storeIn();
    const first = createBlocksSessions({ refresh: vi.fn() }, () => 1000, { file, key });
    const r = response(); first.create(request(), r.res, tokens);
    const warn = vi.fn();
    const other = sessionStoreKey("another-server-secret-entirely", "tenant-1")!;
    const wrong = createBlocksSessions({ refresh: vi.fn() }, () => 1000, { file, key: other, warn });
    expect(await wrong.read(request(cookieOf(r)), response().res)).toEqual({ state: "none" });
    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0][0])).not.toContain(tokens.accessToken);
    writeFileSync(file, "v1.garbage");
    const damaged = createBlocksSessions({ refresh: vi.fn() }, () => 1000, { file, key });
    expect(await damaged.read(request(cookieOf(r)), response().res)).toEqual({ state: "none" });
  });
  it("revoking a user removes their sessions from the file too", async () => {
    const file = storeIn();
    const first = createBlocksSessions({ refresh: vi.fn() }, () => 1000, { file, key });
    const r = response(); first.create(request(), r.res, tokens);
    first.revokeUser(tokens.userId);
    const second = createBlocksSessions({ refresh: vi.fn() }, () => 1000, { file, key });
    expect(await second.read(request(cookieOf(r)), response().res)).toEqual({ state: "none" });
  });
});
