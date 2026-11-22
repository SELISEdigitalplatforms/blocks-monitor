import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { archiveMakeAttempt, makeRecoveryClaim, recordMakeRecovery } from "../../server/blocks/engineWorker/makeRecovery";

const folders: string[] = [];
const directory = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), "make-recovery-")); folders.push(d); return d; };
afterEach(() => { for (const d of folders.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
describe("operator Make recovery", () => {
  it("resumes the same recorded destination without permitting a changed target", () => {
    const d = directory(); recordMakeRecovery(d, "file1", new Date(0));
    recordMakeRecovery(d, "file1", new Date(123));
    expect(JSON.parse(fs.readFileSync(path.join(d, "provider-recovery.json"), "utf8")).decidedAt).toBe(new Date(0).toISOString());
    expect(() => recordMakeRecovery(d, "file2", new Date())).toThrow(/different recovery destination/);
  });
  it("refreshes the timeout window and clears the previous terminal state", () => {
    expect(makeRecoveryClaim("b1", new Date("2026-11-02T08:00:00Z"))).toMatchObject({
      Status: "claimed", ClaimedAt: "2026-11-02T08:00:00.000Z", Progress: 0, ErrorCode: "", ActiveKey: "design.generate:b1",
    });
    expect(Object.values(makeRecoveryClaim("b1", new Date()))).not.toContain(null);
  });
  it("can resume after an interrupted recovery archived the marker but never reached the provider", () => {
    const d = directory(); fs.writeFileSync(path.join(d, "provider-started.json"), "original");
    archiveMakeAttempt(d, new Date()); archiveMakeAttempt(d, new Date());
    expect(fs.readFileSync(path.join(d, "provider-started.abandoned.json"), "utf8")).toBe("original");
  });
  it("retains both audit records when a subsequent confirmed-empty attempt is archived", () => {
    const d = directory(); fs.writeFileSync(path.join(d, "provider-started.abandoned.json"), "first");
    fs.writeFileSync(path.join(d, "provider-started.json"), "second"); archiveMakeAttempt(d, new Date(123));
    expect(fs.readFileSync(path.join(d, "provider-started.abandoned.json"), "utf8")).toBe("first");
    expect(fs.readFileSync(path.join(d, "provider-started.abandoned.123.json"), "utf8")).toBe("second");
  });
  it("refuses new-file recovery when a provider result exists or all markers are absent", () => {
    const d = directory(); expect(() => archiveMakeAttempt(d, new Date())).toThrow(/no provider start/);
    fs.writeFileSync(path.join(d, "provider-result.json"), "{}");
    expect(() => archiveMakeAttempt(d, new Date())).toThrow(/provider result/);
  });
});
