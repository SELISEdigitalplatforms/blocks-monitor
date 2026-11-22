// POST /api/data's limits (server/fnHost/loginLimiter.ts createDataLimiter, used by server/blocks/host.ts): a ceiling
// per address before any session work, then a budget per session, so two people behind one address (an office, a
// VPN) never use up each other's reads, and the 429 says how long to wait.
//   npx vitest run --config test/blocksHost/vitest.config.ts test/blocksHost/dataLimiter.test.ts
import { describe, expect, it } from "vitest";
import { DATA_LIMIT_PER_IP, DATA_LIMIT_PER_SESSION, createDataLimiter } from "../../server/fnHost/loginLimiter";

describe("the /api/data limits", () => {
  it("gives each session its own budget behind one address", () => {
    let t = 1_000_000;
    const limit = createDataLimiter({ now: () => t });
    const ip = "10.0.0.7";
    for (let i = 0; i < DATA_LIMIT_PER_SESSION; i++) {
      expect(limit.address(ip).ok).toBe(true);
      expect(limit.session("sid-anna").ok).toBe(true);
    }
    // Anna's session is used up; Ben, behind the same address, still reads
    expect(limit.address(ip).ok).toBe(true);
    const anna = limit.session("sid-anna");
    expect(anna).toEqual({ ok: false, retryAfterS: 60 });
    expect(limit.address(ip).ok).toBe(true);
    expect(limit.session("sid-ben").ok).toBe(true);
    // a minute later Anna reads again
    t += 60_001;
    expect(limit.session("sid-anna").ok).toBe(true);
  });

  it("keeps a ceiling per address against floods, before any session is read", () => {
    const t = 2_000_000;
    const limit = createDataLimiter({ now: () => t });
    for (let i = 0; i < DATA_LIMIT_PER_IP; i++) expect(limit.address("203.0.113.9").ok).toBe(true);
    const v = limit.address("203.0.113.9");
    expect(v.ok).toBe(false);
    expect(v.ok === false && v.retryAfterS).toBeGreaterThan(0);
    expect(limit.address("203.0.113.10").ok).toBe(true);
    // the address ceiling stays well above what a few people behind it read
    expect(DATA_LIMIT_PER_IP).toBeGreaterThanOrEqual(4 * DATA_LIMIT_PER_SESSION);
  });

  it("never mixes a session id with an address", () => {
    const limit = createDataLimiter({ perIp: 1, perSession: 1, now: () => 0 });
    expect(limit.address("abc").ok).toBe(true);
    expect(limit.session("abc").ok).toBe(true);
  });
});
