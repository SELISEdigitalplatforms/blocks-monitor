// Accounts and the platform: IAM users, Account rows, the custom platform role and its holder, the allowed e-mail
// domains. Built-in roles (platform-admin, owner/member/viewer) are defined in code and never stored.
import { PASSWORD, PEOPLE } from "../data/people";
import { WORKSPACES } from "../data/workspaces";
import type { When } from "../core/clock";
import { audit, uid, type World } from "./world";

const PLATFORM_ROLES = [
  {
    key: "support-desk",
    name: "Support desk",
    description: "Looks up people, workspaces and the audit log to answer support requests.",
    permissions: ["platform.users.view", "platform.workspaces.view", "platform.audit.view"],
    by: "daniel",
    at: "-52d@10:00",
    holders: [{ person: "mira", at: "-52d@10:05" }],
  },
];

/** When a person first signed in: their earliest workspace join, else seven weeks ago. */
function firstSeen(key: string): When {
  const joins = WORKSPACES.flatMap((w) => w.members.filter((m) => m.person === key && m.joined).map((m) => m.joined!));
  return joins.sort((a, b) => Number(b.slice(1, b.indexOf("d"))) - Number(a.slice(1, a.indexOf("d"))))[0] ?? "-53d@09:00";
}

export async function seedPeople(w: World): Promise<number> {
  let made = 0;
  for (const p of PEOPLE) {
    if (p.noAccount) continue;
    const { userId } = await w.s.target.createUser({
      key: p.key,
      email: p.email,
      displayName: p.name,
      password: PASSWORD,
      platformRoles: p.superAdmin ? ["mf-super-admin"] : [],
    });
    w.users.set(p.key, userId);
    made += 1;
  }
  for (const p of PEOPLE) {
    if (p.noAccount) continue;
    const id = uid(w, p.key);
    const created = w.s.clock.at(firstSeen(p.key));
    await w.s.insert(
      "Account",
      {
        UserId: id,
        Email: p.email,
        DisplayName: p.name,
        Status: p.deactivated ? "deactivated" : "active",
        LastSignInAt: w.s.clock.at(p.lastSignIn ?? "-5d@09:00"),
        MustChangePassword: false,
        ...(p.deactivated ? { DeactivatedAt: w.s.clock.at(p.deactivated.at), DeactivatedByUserId: uid(w, p.deactivated.by) } : {}),
      },
      {
        key: `account-${p.key}`,
        ws: null,
        by: id,
        at: created,
        updatedAt: p.deactivated ? w.s.clock.at(p.deactivated.at) : w.s.clock.at(p.lastSignIn ?? "-5d@09:00"),
        updatedBy: p.deactivated ? uid(w, p.deactivated.by) : id,
        requestKey: `account:${id}`,
      },
    );
  }
  return made;
}

export async function seedPlatform(w: World): Promise<void> {
  const holders = PLATFORM_ROLES.flatMap((r) => r.holders.map((h) => uid(w, h.person))).sort();
  const admin = uid(w, w.superAdmin);
  for (const r of PLATFORM_ROLES) {
    const at = w.s.clock.at(r.at);
    const roleId = await w.s.insert(
      "PlatformRole",
      { ReaderIds: holders, Key: r.key, Name: r.name, Description: r.description, Permissions: r.permissions, IsBuiltIn: false },
      { key: `platform-role-${r.key}`, ws: null, by: uid(w, r.by), at, requestKey: `platformRole:${r.key}` },
    );
    await audit(w, { actor: r.by, action: "platformRole.save", targetType: "platform-role", targetId: roleId, targetLabel: r.name, at, details: { before: null, after: { name: r.name, permissions: r.permissions } } });
    for (const h of r.holders) {
      const hat = w.s.clock.at(h.at);
      const holder = uid(w, h.person);
      await w.s.insert(
        "PlatformRoleAssignment",
        { ReaderIds: holders, UserId: holder, RoleKey: r.key, Status: "active", AssignedByUserId: uid(w, r.by), AssignedAt: hat },
        { key: `platform-assign-${h.person}-${r.key}`, ws: null, by: uid(w, r.by), at: hat, requestKey: `platformRoleAssignment:${holder}:${r.key}` },
      );
      await audit(w, {
        actor: r.by,
        action: "platformRole.assign",
        targetType: "platform-role-assignment",
        targetId: `${holder}:${r.key}`,
        targetLabel: `${r.name}`,
        at: hat,
        details: { before: { holdsUsersManage: false }, after: { holdsUsersManage: false, roleKey: r.key } },
      });
    }
  }
  const domains = [...new Set(PEOPLE.map((p) => p.email.split("@")[1]!))];
  const exceptions = ["anna.rossi@studio-rossi.ch"];
  const settings: [string, string[], When][] = [
    ["allowed-email-domains", domains.filter((d) => !exceptions.some((e) => e.endsWith(`@${d}`))), "-52d@09:30"],
    ["allowed-email-exceptions", exceptions, "-31d@08:50"],
  ];
  for (const [key, values, when] of settings) {
    const at = w.s.clock.at(when);
    const id = await w.s.insert(
      "PlatformSetting",
      { ReaderIds: holders, Key: key, Values: values, ValueJson: "", Description: "" },
      { key: `setting-${key}`, ws: null, by: admin, at, requestKey: `setting:${key}` },
    );
    await audit(w, { actor: w.superAdmin, action: "setting.save", targetType: "platform-setting", targetId: id, targetLabel: key, at, details: { key, count: values.length } });
  }
}
