import { lazy, Suspense, type ComponentType, type LazyExoticComponent, type ReactNode } from "react";
import { ShieldOff } from "lucide-react";
import { Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { usePlatformAccess, type PlatformAccess } from "@/blocks/admin";
import { adminMounted } from "@/blocks/config";
import { PRODUCT } from "@/data/facts";
import {
  platformRedirect, platformSectionsFor, sectionFromSlug, type PlatformSectionKey,
} from "@/domain/platformSections";
import { RouteBoundary } from "@/ui/Shell";
import { Button, EmptyState } from "@/ui/kit";
import { useT } from "@/i18n";
import { PlatformSectionNav, PlatformSectionPicker } from "./PlatformNav";
import { platformSectionLabel, platformSectionSummary } from "./sectionText";

type Section = LazyExoticComponent<ComponentType>;

/** Each section loads when first opened; the files are owned by the area they describe. */
const SECTIONS: Record<PlatformSectionKey, Section> = {
  overview: lazy(() => import("./sections/OverviewSection")),
  organizations: lazy(() => import("./sections/OrganizationsSection")),
  people: lazy(() => import("./sections/PeopleSection")),
  roles: lazy(() => import("./sections/RolesSection")),
  plans: lazy(() => import("./sections/PlansSection")),
  credits: lazy(() => import("./sections/CreditsSection")),
  usage: lazy(() => import("./sections/UsageSection")),
  engine: lazy(() => import("./sections/EngineSection")),
  "ai-accounts": lazy(() => import("./sections/AiAccountsSection")),
  settings: lazy(() => import("./sections/SettingsSection")),
  audit: lazy(() => import("./sections/AuditSection")),
};

function SectionFallback() {
  const t = useT();
  return <div aria-busy="true" aria-label={t("platform.view.loadingSection", "Loading the section")} className="hatched h-64 rounded-card bg-surface/60" />;
}

/** Why the area is closed, or null when it is open to this person. */
export function platformGate(mounted: boolean, access: Pick<PlatformAccess, "ready" | "isSuperAdmin" | "permissions">): "unavailable" | "loading" | "denied" | null {
  if (!mounted) return "unavailable";
  if (!access.ready) return "loading";
  return platformSectionsFor(access).length > 0 ? null : "denied";
}

function Closed({ title, text }: { title: string; text: string }) {
  const t = useT();
  const navigate = useNavigate();
  return (
    <EmptyState icon={<ShieldOff size={28} strokeWidth={1.75} />} title={title} text={text}
      action={<Button variant="primary" onClick={() => navigate("/dashboard")}>{t("platform.view.goToDashboard", "Go to the Dashboard")}</Button>} />
  );
}

/** The two-column frame: the section list (a select on a phone), then the open section's title and content. */
export function PlatformLayout({ allowed, active, onPick, children }: {
  allowed: readonly PlatformSectionKey[]; active: PlatformSectionKey; onPick: (path: string) => void; children: ReactNode;
}) {
  const t = useT();
  return (
    <div className="flex w-full min-w-0 flex-col gap-6 lg:grid lg:grid-cols-[240px_minmax(0,1fr)] lg:items-start lg:gap-10 xl:grid-cols-[256px_minmax(0,1fr)]">
      <aside aria-label={t("platform.view.sectionsAria", "Platform sections")}
        className="hidden min-w-0 lg:sticky lg:top-[calc(var(--topbar-h,0px)_+_8px)] lg:block lg:max-h-[calc(100vh_-_var(--topbar-h,0px)_-_2rem)] lg:self-start lg:overflow-y-auto scroll-thin">
        <div className="px-3 pb-4 text-[13px] text-ink3">{PRODUCT}</div>
        <div className="px-3 pb-6 font-display text-[20px] font-medium tracking-tight">{t("platform.view.title", "Platform management")}</div>
        <PlatformSectionNav allowed={allowed} active={active} />
      </aside>
      <div className="flex min-w-0 flex-col gap-6">
        <div className="flex flex-col gap-4 lg:hidden">
          <div>
            <div className="text-[13px] text-ink3">{PRODUCT}</div>
            <div className="font-display text-[20px] font-medium tracking-tight">{t("platform.view.title", "Platform management")}</div>
          </div>
          <PlatformSectionPicker allowed={allowed} active={active} onPick={onPick} />
        </div>
        <header className="flex min-w-0 flex-col gap-1 animate-rise">
          <h1 className="text-[30px] font-medium leading-tight tracking-[-0.02em] sm:text-[34px]">{platformSectionLabel(active)}</h1>
          <p className="max-w-[68ch] text-[15px] text-ink2">{platformSectionSummary(active)}</p>
        </header>
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}

/** Platform management (/admin, /admin/<section>): the super admin's area, open to platform role holders section by section. */
export function PlatformView() {
  const t = useT();
  const access = usePlatformAccess();
  const navigate = useNavigate();
  const { section: slug } = useParams();
  const [params] = useSearchParams();
  const gate = platformGate(adminMounted(), access);

  // where the admin function is not mounted (the Blocks host today) the area is quietly closed: no admin calls
  if (gate === "unavailable") return <Closed title={t("platform.view.unavailableTitle", "Platform management isn't available here yet")} text={t("platform.view.unavailableText", "Everything for your projects works as usual.")} />;
  if (gate === "loading") return <div aria-busy="true" aria-hidden className="h-64 rounded-card bg-surface/60" />;
  if (gate === "denied") return <Closed title={t("platform.view.deniedTitle", "This area is for platform admins")} text={t("platform.view.deniedText", "Ask the super admin for a platform role if you need access.")} />;

  const to = platformRedirect(slug, params.get("tab"), access);
  if (to) return <Navigate to={to} replace />;
  const active = sectionFromSlug(slug) ?? "overview";
  const Content = SECTIONS[active];
  return (
    <PlatformLayout allowed={platformSectionsFor(access)} active={active} onPick={(path) => navigate(path)}>
      <RouteBoundary key={active}>
        <Suspense fallback={<SectionFallback />}><Content /></Suspense>
      </RouteBoundary>
    </PlatformLayout>
  );
}
