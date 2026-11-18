/** Settings → You: the signed-in person as the workspace sees them (name, e-mail, role here). Read-only; the password
 *  is changed in the Password card below. */
import { useNavigate } from "react-router-dom";
import { KeyRound, UserRound } from "lucide-react";
import { useSession } from "@/madp/blocks/session";
import { initialsOf, useCurrentWorkspace, useMe } from "@/madp/state/workspaces";
import { Avatar, Button, Card, Chip } from "@/madp/ui/kit";
import { LanguagePreference } from "@/madp/i18n/LanguageSwitcher";
import { useT } from "@/madp/i18n";

export function ProfileCard() {
  const t = useT();
  const navigate = useNavigate();
  const profile = useSession((s) => s.profile);
  const me = useMe();
  const workspace = useCurrentWorkspace();
  if (!profile) return null;
  const name = profile.displayName || [profile.firstName].filter(Boolean).join(" ") || profile.email;

  return (
    <div id="profile" tabIndex={-1} className="scroll-mt-6 outline-none">
      <Card title={t("settings.profile.title", "You")} icon={<UserRound size={18} strokeWidth={1.75} />}
        action={<Button size="sm" variant="ghost" icon={<KeyRound size={16} strokeWidth={1.75} />}
          onClick={() => navigate({ hash: "security" }, { replace: true })}>{t("settings.profile.changePassword", "Change password")}</Button>}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Avatar initials={initialsOf(name)} size={44} tone="accent" />
          <div className="min-w-0">
            <div className="text-[15px] font-medium [overflow-wrap:anywhere]">{name}</div>
            <div className="text-[13px] text-ink3 [overflow-wrap:anywhere]">{profile.email}</div>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
            {me && <Chip>{workspace ? t("settings.profile.roleIn", "{role} in {workspace}", { role: me.roleName, workspace: workspace.name }) : me.roleName}</Chip>}
            {profile.isSuperAdmin && <Chip tone="accent">{t("settings.profile.superAdmin", "Super admin")}</Chip>}
          </div>
        </div>
        <LanguagePreference />
      </Card>
    </div>
  );
}
