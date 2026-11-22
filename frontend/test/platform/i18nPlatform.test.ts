// Platform management in German (Switzerland): every text whose key is built at run time (permissions, areas, sections,
// audit actions) has a translation, and English stays the default.
import { afterEach, describe, expect, it } from "vitest";
import { setCulture, t } from "../../src/i18n";
import {
  PERMISSION_LABEL, PLATFORM_PERMISSION_AREAS, ROLE_HINT, WORKSPACE_PERMISSION_AREAS, WORKSPACE_ROLES, WORKSPACE_ROLE_LABEL,
} from "../../src/domain/rbac";
import { PLATFORM_ADMIN_ROLE } from "../../src/domain/roles";
import { PERMISSION_DESCRIPTION } from "../../src/domain/permissions";
import { PLATFORM_GROUPS, PLATFORM_SECTIONS } from "../../src/domain/platformSections";
import {
  builtInRoleHint, builtInRoleName, permissionAreaName, permissionDescriptionText, permissionLabelText, platformAdminRoleName,
} from "../../src/components/roles/permissionText";
import { platformGroupLabel, platformSectionLabel, platformSectionSummary } from "../../src/components/platform/sectionText";
import { auditActionLabel } from "../../src/components/admin/auditLabels";
import de from "../../src/i18n/locales/platform.de-CH.json";

afterEach(() => setCulture("en"));

describe("platform texts", () => {
  it("are English by default, the same English as the catalogues the server reads", () => {
    for (const k of Object.keys(PERMISSION_LABEL)) expect(permissionLabelText(k), k).toBe((PERMISSION_LABEL as Record<string, string>)[k]);
    for (const k of Object.keys(PERMISSION_DESCRIPTION)) expect(permissionDescriptionText(k), k).toBe((PERMISSION_DESCRIPTION as Record<string, string>)[k]);
    for (const a of PLATFORM_PERMISSION_AREAS) expect(permissionAreaName(a, "platform")).toBe(a.name);
    for (const a of WORKSPACE_PERMISSION_AREAS) expect(permissionAreaName(a, "workspace")).toBe(a.name);
    for (const s of PLATFORM_SECTIONS) {
      expect(platformSectionLabel(s.key)).toBe(s.label);
      expect(platformSectionSummary(s.key)).toBe(s.summary);
    }
    for (const g of PLATFORM_GROUPS) expect(platformGroupLabel(g)).toBe(g);
    for (const k of WORKSPACE_ROLES) {
      expect(builtInRoleName(k, "?")).toBe(WORKSPACE_ROLE_LABEL[k]);
      expect(builtInRoleHint(k, "?")).toBe(ROLE_HINT[k]);
    }
    expect(platformAdminRoleName(PLATFORM_ADMIN_ROLE.name)).toBe(PLATFORM_ADMIN_ROLE.name);
    expect(permissionLabelText("no.such")).toBe("no.such");
    expect(permissionDescriptionText("no.such")).toBe("");
  });

  it("have a German (Switzerland) text for every key built at run time", () => {
    setCulture("de-CH");
    const english: [string, string][] = [];
    for (const k of Object.keys(PERMISSION_LABEL)) english.push([permissionLabelText(k), (PERMISSION_LABEL as Record<string, string>)[k]]);
    for (const k of Object.keys(PERMISSION_DESCRIPTION)) english.push([permissionDescriptionText(k), (PERMISSION_DESCRIPTION as Record<string, string>)[k]]);
    for (const a of PLATFORM_PERMISSION_AREAS) english.push([permissionAreaName(a, "platform"), a.name]);
    for (const a of WORKSPACE_PERMISSION_AREAS) english.push([permissionAreaName(a, "workspace"), a.name]);
    for (const s of PLATFORM_SECTIONS) {
      english.push([platformSectionLabel(s.key), s.label]);
      english.push([platformSectionSummary(s.key), s.summary]);
    }
    for (const g of PLATFORM_GROUPS) english.push([platformGroupLabel(g), g]);
    for (const k of ["owner", "member", "viewer"]) {
      english.push([builtInRoleName(k, "?"), "?"]);
      english.push([builtInRoleHint(k, "?"), "?"]);
    }
    english.push([platformAdminRoleName(PLATFORM_ADMIN_ROLE.name), PLATFORM_ADMIN_ROLE.name]);
    english.push([auditActionLabel("account.create"), "Created an account"]);
    // "System", "Audit" and "Wiki" read the same in both languages
    const same = new Set(["System", "Audit", "Wiki"]);
    const untranslated = english.filter(([shown, en]) => shown === en && !same.has(en));
    expect(untranslated).toEqual([]);
  });

  it("use Swiss spelling (no sharp s)", () => {
    expect(JSON.stringify(de)).not.toMatch(/ß/);
    setCulture("de-CH");
    expect(t("platform.view.title", "Platform management")).toBe("Plattformverwaltung");
  });
});
