// The sign-up backend of the local host: the local account store plays IAM, SignUp/AuditEvent/PlatformSetting rows live
// in the local row store, and e-mails go to the mail drop (`npm run mailbox`) rendered from blocks/mail/templates.
import fs from "node:fs";
import path from "node:path";
import { signupModeOf, SIGNUP_SETTING_KEY } from "../../src/domain/signup.ts";
import { sanitizeDetails } from "../../functions/_lib/audit.ts";
import { SIGNUP_SCHEMA, signupFromRow, signupToRow, type SignupBackend } from "../fnHost/signup.ts";
import { EmailTaken, IAM_USER_ROLE, createUser, getUser, hashPassword, passwordProblem, setActive, userByEmail } from "./iam/store.ts";
import { dropMail, renderMailTemplate } from "./mail.ts";
import type { LocalRuntime } from "./runtime.ts";

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** True while the person's sign-up waits for the e-mail link (the local sign-in then says "verify your e-mail"). */
export function pendingSignup(rt: LocalRuntime, userId: string): boolean {
  return rt.store.rows(SIGNUP_SCHEMA).some((r) => r.UserId === userId && r.Status === "pending");
}

export function createLocalSignupBackend(rt: LocalRuntime): SignupBackend {
  const templates = path.join(rt.paths.root, "blocks", "mail", "templates");
  const info = (line: string) => rt.log("info", line);
  return {
    async mode() {
      const row = rt.store.rows("PlatformSetting").find((r) => r.Key === SIGNUP_SETTING_KEY);
      return signupModeOf(row?.ValueJson);
    },
    async findUser(email) {
      const u = userByEmail(rt.db, email);
      return u ? { userId: u.userId, active: u.active, firstName: u.firstName } : null;
    },
    async createUser(u) {
      if (passwordProblem(u.password)) return { ok: false, reason: "password" };
      try {
        const made = createUser(rt.db, {
          email: u.email,
          firstName: u.firstName,
          lastName: u.lastName,
          roles: [IAM_USER_ROLE],
          passwordHash: await hashPassword(u.password),
        });
        // inactive until the address is proven, like the IAM user the Blocks host creates
        setActive(rt.db, made.userId, false);
        return { ok: true, userId: made.userId };
      } catch (e) {
        if (e instanceof EmailTaken) return { ok: false, reason: "exists" };
        return { ok: false, reason: "unavailable" };
      }
    },
    async activateUser(userId) {
      return setActive(rt.db, userId, true);
    },
    async userById(userId) {
      const u = getUser(rt.db, userId);
      return u ? { email: u.email, firstName: u.firstName } : null;
    },
    signups: {
      async get(id) {
        const r = rt.store.get(SIGNUP_SCHEMA, id);
        return r ? signupFromRow(r) : null;
      },
      async byEmail(email) {
        const rows = rt.store.rows(SIGNUP_SCHEMA).filter((r) => r.Email === email);
        const r = rows[rows.length - 1];
        return r ? signupFromRow(r) : null;
      },
      async create(r) {
        const at = new Date().toISOString();
        const row = rt.store.insert(SIGNUP_SCHEMA, { ...signupToRow(r), ReaderIds: [], CreatedByUserId: r.userId, UpdatedByUserId: r.userId, CreatedAt: at });
        return str(row.ItemId);
      },
      async update(id, patch) {
        rt.store.update(SIGNUP_SCHEMA, [id], signupToRow(patch));
      },
    },
    async sendMail(m) {
      try {
        const out = renderMailTemplate(templates, m.template, m.subject, m.body as Record<string, string>, (f) => fs.readFileSync(f, "utf8"));
        const link = "link" in m.body ? m.body.link : "signInLink" in m.body ? m.body.signInLink : m.body.resetLink;
        dropMail(rt.db, { to: m.to, subject: out.subject, kind: m.template, link, body: out.body }, info);
        return true;
      } catch {
        return false;
      }
    },
    async audit(e) {
      try {
        rt.store.insert("AuditEvent", {
          ActorUserId: e.actorUserId,
          ActorIsSuperAdmin: false,
          Impersonated: false,
          Action: e.action,
          TargetType: e.targetType,
          TargetId: e.targetId,
          DetailsJson: sanitizeDetails(e.details),
          At: new Date().toISOString(),
          WorkspaceId: "",
          ProjectId: "",
          CreatedByUserId: e.actorUserId,
          UpdatedByUserId: e.actorUserId,
        });
      } catch {
        /* the audit never breaks a sign-up */
      }
    },
  };
}
