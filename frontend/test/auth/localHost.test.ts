// The local host's sign-up end to end on a temporary store: the account is created inactive in the local account store,
// sign-in says "confirm your email" until the link is opened, the mail drop holds the rendered branded e-mail with its
// plain link, the link activates the account, and the auth.signup setting row closes sign-up.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { openDb } from "../../server/local/db";
import { createRowStore, loadUniqueIndexes } from "../../server/local/rowStore";
import { createLocalSignupBackend, pendingSignup } from "../../server/local/signup";
import { createLocalIamAuth } from "../../server/local/iam/auth";
import { createSignupFlows } from "../../server/fnHost/signup";
import { latestMail } from "../../server/local/mail";
import { userByEmail } from "../../server/local/iam/store";
import type { LocalRuntime } from "../../server/local/runtime";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "madp-signup-test-"));
afterAll(() => {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* temporary files */ }
});

function runtime(): LocalRuntime {
  const db = openDb(path.join(dir, `factory-${Math.random().toString(36).slice(2)}.db`));
  const store = createRowStore(db, loadUniqueIndexes(ROOT));
  return { paths: { root: ROOT, dataDir: dir, dbFile: "", filesDir: dir }, appOrigin: "http://localhost:5310", db, store, log: () => undefined } as LocalRuntime;
}

describe("local sign-up", () => {
  it("creates the account inactive, mails the branded link, and the link activates it", async () => {
    const rt = runtime();
    const backend = createLocalSignupBackend(rt);
    const flows = createSignupFlows({ backend, appOrigin: rt.appOrigin });
    const iam = createLocalIamAuth({ db: rt.db, appOrigin: () => rt.appOrigin, pendingSignup: (id) => pendingSignup(rt, id) });

    expect(await flows.signup({ name: "Ada Lovelace", email: "ada@example.org", password: "violet harbor lantern", organization: "", plan: "free" })).toBe("sent");
    const user = userByEmail(rt.db, "ada@example.org")!;
    expect(user.active).toBe(false);
    expect(await iam.login("ada@example.org", "violet harbor lantern")).toEqual({ ok: false, reason: "not-activated" });

    const [mail] = latestMail(rt.db, 1);
    expect(mail.kind).toBe("mf-verify-email");
    expect(mail.subject).toBe("Confirm your email for MADP Factory");
    expect(mail.link).toMatch(/^http:\/\/localhost:5310\/activate\?token=/);
    expect(mail.body).toContain("Hello Ada");
    // the plain-link fallback under the button
    expect(mail.body.split(mail.link!).length - 1).toBeGreaterThanOrEqual(2);

    const token = new URL(mail.link!).searchParams.get("token")!;
    const r = await flows.verify(token);
    expect(r).toMatchObject({ ok: true, email: "ada@example.org", organizationName: "Ada's organization", planKey: "free" });
    expect(userByEmail(rt.db, "ada@example.org")!.active).toBe(true);
    expect(pendingSignup(rt, user.userId)).toBe(false);
    expect((await iam.login("ada@example.org", "violet harbor lantern")).ok).toBe(true);
    expect(await flows.verify(token)).toEqual({ ok: false, reason: "used" });
    expect(rt.store.rows("AuditEvent").map((a) => a.Action)).toEqual(["signup.created", "signup.verified"]);
  });

  it("reads the auth.signup setting row, open by default", async () => {
    const rt = runtime();
    const backend = createLocalSignupBackend(rt);
    expect(await backend.mode()).toBe("open");
    rt.store.insert("PlatformSetting", { Key: "auth.signup", Values: [], ValueJson: "\"invite-only\"", ReaderIds: [] });
    expect(await backend.mode()).toBe("invite-only");
  });

  it("the reset relay names the account, so the routes can sign it out and send the notice", async () => {
    const rt = runtime();
    const backend = createLocalSignupBackend(rt);
    const flows = createSignupFlows({ backend, appOrigin: rt.appOrigin });
    await flows.signup({ name: "Grace Hopper", email: "grace@example.org", password: "violet harbor lantern", organization: "", plan: "" });
    await flows.verify(new URL(latestMail(rt.db, 1)[0].link!).searchParams.get("token")!);
    const iam = createLocalIamAuth({ db: rt.db, appOrigin: () => rt.appOrigin });
    await iam.relay("recover", { email: "grace@example.org" });
    const reset = latestMail(rt.db, 1)[0];
    expect(reset.kind).toBe("password-reset");
    const code = new URL(reset.link!).searchParams.get("code")!;
    const answer = (await iam.relay("resetPassword", { code, password: "a brand new passphrase" })) as { isSuccess: boolean; userId: string };
    expect(answer).toEqual({ isSuccess: true, userId: userByEmail(rt.db, "grace@example.org")!.userId });
    await flows.passwordChanged(answer.userId);
    const notice = latestMail(rt.db, 1)[0];
    expect(notice).toMatchObject({ kind: "mf-password-changed", to: "grace@example.org", subject: "Your MADP Factory password was changed" });
  });
});
