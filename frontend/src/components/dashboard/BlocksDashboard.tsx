/**
 * Blocks Dashboard: shows project stats from the Blocks OS API.
 * Replaces the MADP DashboardView for OIDC sessions.
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { FolderKanban, Hammer, Rocket, Inbox, Plus, ArrowUpRight, ExternalLink } from "lucide-react";
import { Button, Card, EmptyState, PageHeader } from "@/ui/kit";
import { useSession } from "@/blocks/session";
import { t } from "@/i18n";

function getOidcToken(): string | undefined {
  try {
    const raw = sessionStorage.getItem("madp-oidc-session-v1");
    if (!raw) return undefined;
    const data = JSON.parse(raw) as { accessToken?: string; expiresAtMs?: number };
    if (data.accessToken && data.expiresAtMs && data.expiresAtMs > Date.now()) return data.accessToken;
  } catch { /* ignore */ }
  return undefined;
}

interface BlocksProjectGroup {
  tenantGroupId: string;
  projects: Array<{
    name: string;
    environment: string;
    tenantId: string;
    applications?: Array<{ domain?: string }>;
    createdDate?: string;
  }>;
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col rounded-card bg-surface p-5 shadow-card dark:border dark:border-line">
      <div className="flex items-center gap-3 text-[14px] font-medium text-ink2">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-block bg-accent/10 text-accent">{icon}</span>
        <span className="min-w-0 truncate">{label}</span>
      </div>
      <div className="num mt-4 truncate text-[28px] font-medium leading-tight tracking-tight text-ink">{value}</div>
    </div>
  );
}

export function BlocksDashboard() {
  const navigate = useNavigate();
  const profile = useSession((s) => s.profile);
  const [groups, setGroups] = useState<BlocksProjectGroup[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = getOidcToken();
    if (!token) { setLoading(false); return; }
    fetch("/api/blocks-project/list?page=0&pageSize=100", {
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
    })
      .then((r) => r.json())
      .then((data) => {
        const arr = Array.isArray(data) ? data : [];
        setGroups(arr);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const projects = useMemo(() => groups.flatMap((g) => g.projects.map((p) => ({ ...p, tenantGroupId: g.tenantGroupId }))), [groups]);
  const first = profile?.firstName?.trim() ?? "";
  const hour = new Date().getHours();
  const greeting = hour < 12 ? (first ? `Good morning, ${first}` : "Good morning")
    : hour < 18 ? (first ? `Good afternoon, ${first}` : "Good afternoon")
    : (first ? `Good evening, ${first}` : "Good evening");
  const date = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  return (
    <div className="pb-4">
      <PageHeader title={greeting}
        subtitle={`Everything at a glance · ${date}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" icon={<Plus size={16} strokeWidth={1.75} />} onClick={() => navigate("/new")}>
              {t("shell.dashboard.newProject", "New project")}
            </Button>
          </div>
        }
      />

      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat icon={<FolderKanban size={18} strokeWidth={1.75} />} label="Projects" value={loading ? "…" : groups.length} />
        <Stat icon={<Hammer size={18} strokeWidth={1.75} />} label="In build" value={0} />
        <Stat icon={<Rocket size={18} strokeWidth={1.75} />} label="Released" value={loading ? "…" : projects.filter((p) => p.applications?.some((a) => a.domain)).length} />
        <Stat icon={<Inbox size={18} strokeWidth={1.75} />} label="Waiting for you" value={0} />
      </div>

      {!loading && projects.length === 0 && (
        <Card>
          <EmptyState
            icon={<FolderKanban size={48} strokeWidth={1.5} className="opacity-50" />}
            title="No projects yet"
            text="Create your first project to get started."
            action={<Button variant="primary" icon={<Plus size={16} />} onClick={() => navigate("/new")}>New project</Button>}
          />
        </Card>
      )}

      {!loading && projects.length > 0 && (
        <Card title="Your projects" icon={<FolderKanban size={18} strokeWidth={1.75} />}>
          <div className="space-y-2">
            {projects.slice(0, 10).map((p) => {
              const domain = p.applications?.[0]?.domain || "";
              return (
                <div key={p.tenantId || p.tenantGroupId} className="flex items-center justify-between rounded-block bg-surface2 p-3.5">
                  <div className="min-w-0">
                    <span className="block truncate text-[14px] font-medium">{p.name || "Untitled"}</span>
                    {domain && (
                      <a href={domain} target="_blank" rel="noopener noreferrer" className="mt-0.5 flex items-center gap-1 text-[12px] text-ink3 hover:text-accent">
                        <ExternalLink size={11} /> {domain.replace("https://", "")}
                      </a>
                    )}
                  </div>
                  <Link to="/projects" className="grid h-8 w-8 place-items-center rounded-full bg-surface text-ink2 transition hover:bg-accent hover:text-white">
                    <ArrowUpRight size={16} strokeWidth={1.75} />
                  </Link>
                </div>
              );
            })}
            {projects.length > 10 && (
              <Link to="/projects" className="mt-1 block text-[13px] font-medium text-accent hover:underline">
                All {projects.length} projects
              </Link>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
