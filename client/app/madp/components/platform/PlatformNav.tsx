import { Link } from "react-router-dom";
import {
  Building2, ChartColumn, Cpu, KeyRound, Layers, LayoutGrid, ScrollText, Server, Settings, Users, Wallet, type LucideIcon,
} from "lucide-react";
import { cn } from "@/madp/lib/cn";
import { Select } from "@/madp/ui/kit";
import { useT } from "@/madp/i18n";
import { platformGroupLabel, platformSectionLabel } from "./sectionText";
import {
  PLATFORM_SECTIONS, platformNavGroups, platformSectionPath, type PlatformSectionKey,
} from "@/madp/domain/platformSections";

const ICONS: Record<PlatformSectionKey, LucideIcon> = {
  overview: LayoutGrid, organizations: Building2, people: Users, roles: KeyRound,
  plans: Layers, credits: Wallet, usage: ChartColumn,
  engine: Server, "ai-accounts": Cpu,
  settings: Settings, audit: ScrollText,
};

/** The section list on a wide screen: grouped, the open section marked, sticky below the top bar. */
export function PlatformSectionNav({ allowed, active }: { allowed: readonly PlatformSectionKey[]; active: PlatformSectionKey }) {
  const t = useT();
  const groups = platformNavGroups(allowed);
  return (
    <nav aria-label={t("platform.nav.ariaLabel", "Platform management")} className="flex flex-col gap-6">
      {groups.map(({ group, sections }) => (
        <div key={group ?? "top"} className="flex flex-col gap-1">
          {group && <div className="px-3 pb-1 text-[12px] font-medium uppercase tracking-wider text-ink3">{platformGroupLabel(group)}</div>}
          <ul className="flex flex-col gap-1">
            {sections.map((s) => {
              const Icon = ICONS[s.key];
              const on = s.key === active;
              return (
                <li key={s.key}>
                  <Link to={platformSectionPath(s.key)} aria-current={on ? "page" : undefined}
                    className={cn("flex min-h-[44px] items-center gap-3 rounded-block px-3 py-2 text-[14px] font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-accent/50",
                      on ? "bg-surface text-ink shadow-card dark:ring-1 dark:ring-line" : "text-ink2 hover:bg-surface2 hover:text-ink")}>
                    <Icon size={18} strokeWidth={1.75} className={on ? "shrink-0 text-accent" : "shrink-0 text-ink3"} />
                    <span className="min-w-0 [overflow-wrap:anywhere]">{platformSectionLabel(s.key)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/** The section picker on a phone or a narrow window: one select naming the open section. */
export function PlatformSectionPicker({ allowed, active, onPick }: {
  allowed: readonly PlatformSectionKey[]; active: PlatformSectionKey; onPick: (path: string) => void;
}) {
  const t = useT();
  const options = PLATFORM_SECTIONS.filter((s) => allowed.includes(s.key))
    .map((s) => ({ value: s.key, label: s.group ? `${platformGroupLabel(s.group)} · ${platformSectionLabel(s.key)}` : platformSectionLabel(s.key) }));
  return (
    <Select label={t("platform.nav.sectionPicker", "Section")} value={active} options={options} className="w-full"
      onChange={(v) => onPick(platformSectionPath(v as PlatformSectionKey))} />
  );
}
