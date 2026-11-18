import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { PageHeader } from "@/madp/ui/kit";
import { StepChips, type StepChip } from "@/madp/components/step/StepFrame";
import { useGithubStatus } from "@/madp/blocks/github";
import { useWorkspaces } from "@/madp/blocks/workspaces/store";
import { useCurrentWorkspace } from "@/madp/state/workspaces";
import { ConnectionsCard } from "./ConnectionsCard";
import { DesignGeneratorCard } from "./DesignGeneratorCard";
import { ProfileCard } from "./ProfileCard";
import { SecurityCard } from "./SecurityCard";
import { TeamCard } from "./TeamCard";
import { WorkspaceNameCard } from "./WorkspaceNameCard";
import { WorkspaceRolesCard } from "./WorkspaceRolesCard";
import { PlanUsageCard } from "@/madp/components/billing/PlanUsageCard";
import { useBillingSummary } from "@/madp/components/billing/billingData";
import { creditState, leftUsd, usd } from "@/madp/components/billing/usageText";
import { useT } from "@/madp/i18n";

/** The sections a link (or a chip) can jump to. */
const SECTIONS = ["#profile", "#workspace", "#team", "#plan", "#roles", "#design-generator", "#security", "#connections"];

export function SettingsView() {
  const t = useT();
  const { hash } = useLocation();
  const navigate = useNavigate();
  const workspace = useCurrentWorkspace();
  const team = useWorkspaces((s) => s.team);
  const github = useGithubStatus();
  const billing = useBillingSummary(workspace?.id);
  useEffect(() => {
    if (!SECTIONS.includes(hash)) return;
    const el = document.getElementById(hash.slice(1));
    if (!el) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
    el.focus({ preventScroll: true });
  }, [hash]);

  const go = (id: string) => () => navigate({ hash: id }, { replace: true });
  const connected = github.data?.connected === true;
  // a row of plain section chips, the same chips the project steps use (read-only facts, each one jumps to its card)
  const chips: StepChip[] = [
    { id: "profile", label: t("settings.view.chipYou", "You"), state: "info", onClick: go("profile"), title: t("settings.view.chipYouTitle", "Your name, e-mail and role") },
    { id: "workspace", label: t("settings.view.chipWorkspace", "Workspace"), state: "info", onClick: go("workspace"), title: t("settings.view.chipWorkspaceTitle", "The workspace's name") },
    { id: "team", label: t("settings.view.chipTeam", "Team"), state: "info", value: team.length > 0 ? team.length : undefined, onClick: go("team"), title: t("settings.view.chipTeamTitle", "Who works in this workspace") },
    ...(billing.data ? [{
      id: "plan", label: t("settings.view.chipPlan", "Plan"), state: creditState(billing.data) === "ok" ? "info" : "attention",
      value: creditState(billing.data) === "out" ? t("settings.view.noCreditLeft", "No credit left") : t("settings.view.amountLeft", "{amount} left", { amount: usd(leftUsd(billing.data)) }),
      onClick: go("plan"), title: t("settings.view.chipPlanTitle", "Your plan, credit and usage"),
    } satisfies StepChip] : []),
    { id: "roles", label: t("settings.view.chipRoles", "Roles"), state: "info", onClick: go("roles"), title: t("settings.view.chipRolesTitle", "What each role may do") },
    { id: "design", label: t("settings.view.chipDesign", "Screen designs"), state: "info", onClick: go("design-generator"), title: t("settings.view.chipDesignTitle", "How your screens are designed") },
    { id: "security", label: t("settings.view.chipPassword", "Password"), state: "info", onClick: go("security"), title: t("settings.view.chipPasswordTitle", "Change your password") },
    {
      id: "connections", label: "GitHub", state: github.isPending ? "info" : connected ? "done" : "todo",
      value: github.isPending ? undefined : connected ? t("settings.view.connected", "Connected") : undefined, todoLabel: t("settings.view.connectTodo", "connect"),
      onClick: go("connections"), title: connected ? t("settings.view.githubConnected", "GitHub is connected") : t("settings.view.connectGithub", "Connect your GitHub account"),
    },
  ];

  return (
    <div className="flex w-full min-w-0 flex-col">
      <PageHeader eyebrow={workspace?.name ?? t("settings.view.workspaceFallback", "Workspace")} title={t("settings.view.title", "Settings")} subtitle={t("settings.view.subtitle", "Your account, your team and how projects run in this workspace.")} />
      <div className="mb-6 min-w-0"><StepChips chips={chips} label={t("settings.view.sectionsLabel", "Settings sections")} /></div>
      <div className="flex min-w-0 max-w-full flex-col gap-6">
        <ProfileCard />
        <WorkspaceNameCard />
        <TeamCard />
        <PlanUsageCard />
        <WorkspaceRolesCard />
        <DesignGeneratorCard />
        <SecurityCard />
        <ConnectionsCard />
      </div>
    </div>
  );
}
