// The shared sign-up rules (src/domain/signup.ts, commonPasswords.ts) and the two ops behind the sign-up: the first
// organization after the first sign-in (me.completeSignup, once per sign-up, Free plan and the sign-up credit through
// workspace.create) and the platform setting auth.signup (signup.settings.get/save, platform permission, audited).
import { describe, expect, it } from "vitest";
import { fakeCtx, listRegisteredOps, memoryGateway, runOp, seedRow } from "../../functions/_lib/testing";
import { WORKSPACE_DEFS } from "../../functions/workspace/ops/index";
import { ADMIN_DEFS } from "../../functions/admin/ops/index";
import { opKind } from "../../src/blocks/fnKinds";
import { SELF_SCOPE_COMMAND_PERMISSIONS, SELF_SCOPE_UNRESTRICTED_COMMANDS } from "../../src/domain/security";
import { isCommonPassword } from "../../src/domain/commonPasswords";
import {
  afterSignupPath, checkPassword, cleanOrganizationName, cleanPlanKey, defaultOrganizationName, parseVerifyToken, signupModeOf, splitName,
} from "../../src/domain/signup";

describe("password policy", () => {
  it("accepts 12+ characters and passphrases; refuses short, common, patterned and e-mail passwords", () => {
    for (const ok of ["violet harbor lantern", "Tr4m-Lisbon-Nebula", "correct-horse-orbit-9", "zq8#Lm2!pX0v"]) expect(checkPassword(ok, "ada@example.org").ok, ok).toBe(true);
    for (const bad of ["Sh0rt!", "password1234", "Password2024!", "p@ssw0rd2025!", "123456789012", "aaaaaaaaaaaa", "abcabcabcabc", "qwertyuiopasdf", "1q2w3e4r5t6y", "letmein123456", "madpfactory12", "Summer2026!!!"]) {
      expect(checkPassword(bad, "ada@example.org").ok, bad).toBe(false);
    }
    expect(checkPassword("ada.lovelace@example.org", "ada.lovelace@example.org").message).toMatch(/email address/);
    expect(checkPassword("ADA.LOVELACE!99", "ada.lovelace@example.org").ok).toBe(false);
    expect(checkPassword("x".repeat(65)).ok).toBe(false);
  });

  it("lists the three rules for the live checklist, each met or not", () => {
    const r = checkPassword("violet harbor lantern", "ada@example.org");
    expect(r.checks.map((c) => [c.key, c.met])).toEqual([["length", true], ["common", true], ["email", true]]);
    expect(checkPassword("").checks.every((c) => !c.met)).toBe(true);
  });

  it("knows the long common ones and keyboard runs", () => {
    expect(isCommonPassword("asdfghjkl123")).toBe(true);
    expect(isCommonPassword("0987654321")).toBe(true);
    expect(isCommonPassword("zyxwvutsrqpo")).toBe(true);
    expect(isCommonPassword("ember quiet atlas")).toBe(false);
  });
});

describe("names, organization, plan, link", () => {
  it("splits a name for IAM and builds the default organization name", () => {
    expect(splitName("  Ada   King Lovelace ")).toEqual({ firstName: "Ada King", lastName: "Lovelace" });
    expect(splitName("Cher")).toEqual({ firstName: "Cher", lastName: "" });
    expect(defaultOrganizationName("Ada Lovelace")).toBe("Ada's organization");
    expect(defaultOrganizationName("Charles")).toBe("Charles' organization");
    expect(cleanOrganizationName("  ", "Ada Lovelace")).toBe("Ada's organization");
    expect(cleanOrganizationName("Analytical\u0007 Engines", "Ada")).toBe("Analytical Engines");
  });

  it("keeps only a well-formed plan key and routes each plan after the first sign-in", () => {
    expect(cleanPlanKey(" Classic ")).toBe("classic");
    expect(cleanPlanKey("../../admin")).toBe("");
    expect(afterSignupPath("classic")).toBe("/billing/checkout?plan=classic");
    expect(afterSignupPath("speed")).toBe("/billing/checkout?plan=speed");
    expect(afterSignupPath("enterprise")).toBe("/settings?plan=enterprise#plan");
    expect(afterSignupPath("free")).toBe("/dashboard?welcome=1");
    expect(afterSignupPath("")).toBe("/dashboard?welcome=1");
  });

  it("parses a verification token and refuses anything else", () => {
    expect(parseVerifyToken("abcdefgh12.ABCDEFGH_-12345678")).toEqual({ id: "abcdefgh12", secret: "ABCDEFGH_-12345678" });
    for (const bad of [null, "", "nodot", "a.b", "abcdefgh.ijk.lmnopqrs", "abcdefgh12.has space here", "x".repeat(400)]) expect(parseVerifyToken(bad)).toBeNull();
  });

  it("reads the stored sign-up mode with 'open' as the default", () => {
    expect(signupModeOf(undefined)).toBe("open");
    expect(signupModeOf("\"invite-only\"")).toBe("invite-only");
    expect(signupModeOf("\"open\"")).toBe("open");
    expect(signupModeOf("garbage")).toBe("open");
  });
});

const PERSON = { userId: "new-1", email: "ada@example.org" };
const SUPER = { userId: "super-1", email: "super@example.org", roles: ["mf-super-admin"] };
const MEMBER = { userId: "member-1", email: "member@example.org" };

function ops() {
  const gateway = memoryGateway();
  seedRow(gateway, "Account", { UserId: SUPER.userId, Email: SUPER.email, Status: "active" });
  let n = 0;
  const call = (fn: "workspace" | "admin", who: { userId: string; email: string; roles?: string[] }, op: string, args: Record<string, unknown> = {}) =>
    runOp(fn, fn === "workspace" ? WORKSPACE_DEFS : ADMIN_DEFS, { ctx: fakeCtx(who), gateway, request: { op, args, requestId: `req-${String(++n).padStart(4, "0")}-abcdefghijklmnop` } });
  return { gateway, call };
}

describe("me.completeSignup", () => {
  it("is registered as a self command any signed-in person may run on their own sign-up", async () => {
    expect(await listRegisteredOps("workspace")).toContain("me.completeSignup");
    expect((SELF_SCOPE_UNRESTRICTED_COMMANDS as readonly string[]).includes("me.completeSignup")).toBe(true);
    expect(opKind("workspace", "me.completeSignup")).toBe("write");
  });

  it("creates the first organization once, on Free with the sign-up credit, and returns the picked plan", async () => {
    const t = ops();
    seedRow(t.gateway, "SignUp", { UserId: PERSON.userId, Email: PERSON.email, Name: "Ada Lovelace", OrganizationName: "Analytical Engines", PlanKey: "classic", Status: "verified", ReaderIds: [] });
    const first = await t.call("workspace", PERSON, "me.completeSignup");
    expect(first.status).toBe(200);
    expect(first.body.data).toMatchObject({ plan: "classic", created: true });
    const ws = t.gateway.rows("Workspace");
    expect(ws).toHaveLength(1);
    expect(ws[0]).toMatchObject({ Name: "Analytical Engines" });
    expect(t.gateway.rows("Membership").filter((m) => m.UserId === PERSON.userId && m.RoleKey === "owner")).toHaveLength(1);
    expect(t.gateway.rows("Subscription").some((s) => s.PlanKey === "free")).toBe(true);
    expect(t.gateway.rows("CreditEntry").some((c) => c.Kind === "signup")).toBe(true);
    const again = await t.call("workspace", PERSON, "me.completeSignup");
    expect(again.body.data).toEqual({ workspaceId: first.body.data.workspaceId, plan: "classic", created: false });
    expect(t.gateway.rows("Workspace")).toHaveLength(1);
  });

  it("does nothing for a person without a confirmed sign-up (invited people, a waiting sign-up)", async () => {
    const t = ops();
    expect((await t.call("workspace", MEMBER, "me.completeSignup")).body.data).toEqual({ workspaceId: null, plan: "", created: false });
    seedRow(t.gateway, "SignUp", { UserId: PERSON.userId, Email: PERSON.email, Name: "Ada", Status: "pending", ReaderIds: [] });
    expect((await t.call("workspace", PERSON, "me.completeSignup")).body.data.created).toBe(false);
    expect(t.gateway.rows("Workspace")).toHaveLength(0);
  });

  it("reads only the caller's own row", async () => {
    const t = ops();
    seedRow(t.gateway, "SignUp", { UserId: PERSON.userId, Email: PERSON.email, Name: "Ada", Status: "verified", ReaderIds: [] });
    expect((await t.call("workspace", MEMBER, "me.completeSignup")).body.data.created).toBe(false);
  });
});

describe("signup.settings", () => {
  it("is a platform setting: registered, view and command, platform permission", async () => {
    const list = await listRegisteredOps("admin");
    expect(list).toEqual(expect.arrayContaining(["signup.settings.get", "signup.settings.save"]));
    expect(opKind("admin", "signup.settings.get")).toBe("read");
    expect(opKind("admin", "signup.settings.save")).toBe("write");
    expect(SELF_SCOPE_COMMAND_PERMISSIONS["signup.settings.save"]).toBe("platform");
  });

  it("defaults to open, saves invite-only for the super admin with an audit row, refuses everyone else", async () => {
    const t = ops();
    expect((await t.call("admin", SUPER, "signup.settings.get")).body.data).toEqual({ mode: "open", isDefault: true });
    expect((await t.call("admin", MEMBER, "signup.settings.save", { mode: "invite-only" })).status).not.toBe(200);
    const saved = await t.call("admin", SUPER, "signup.settings.save", { mode: "invite-only" });
    expect(saved.body.data).toEqual({ mode: "invite-only", isDefault: false });
    expect(t.gateway.rows("PlatformSetting").find((r) => r.Key === "auth.signup")?.ValueJson).toBe("\"invite-only\"");
    expect((await t.call("admin", SUPER, "signup.settings.get")).body.data).toEqual({ mode: "invite-only", isDefault: false });
    expect(t.gateway.rows("AuditEvent").some((a) => a.TargetId === "auth.signup")).toBe(true);
    expect((await t.call("admin", SUPER, "signup.settings.save", { mode: "everyone" })).body.error.code).toBe("invalid_input");
  });
});
