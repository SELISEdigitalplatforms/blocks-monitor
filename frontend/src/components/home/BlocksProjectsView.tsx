/**
 * Blocks Projects View: lists projects from the Blocks OS API.
 * Used when OIDC session is active (instead of MADP's workspace-based project list).
 */
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { FolderKanban, Plus, ExternalLink, FolderGit2, ArrowUpRight } from "lucide-react";
import { setActiveProject } from "@/blocks/activeProject";
import { Button, Card, EmptyState, PageHeader } from "@/ui/kit";
function getOidcAccessToken(): string | undefined {
  try {
    const raw = sessionStorage.getItem("madp-oidc-session-v1");
    if (!raw) return undefined;
    const data = JSON.parse(raw) as { accessToken?: string; expiresAtMs?: number };
    if (data.accessToken && data.expiresAtMs && data.expiresAtMs > Date.now()) return data.accessToken;
  } catch { /* ignore */ }
  return undefined;
}
import { t } from "@/i18n";

interface BlocksProject {
  itemId?: string;
  ItemId?: string;
  name?: string;
  Name?: string;
  ProjectName?: string;
  TenantGroupId?: string;
  tenantGroupId?: string;
  tenantId?: string;
  domain?: string;
  Domain?: string;
  environment?: string;
  isDisabled?: boolean;
  applications?: Array<{ domain?: string; cookieDomain?: string }>;
  Resources?: Array<{ ResourceId?: string; Name?: string; Link?: string }>;
  createdDate?: string;
  CreatedDate?: string;
}

export function BlocksProjectsView() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<BlocksProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = getOidcAccessToken();
    if (!token) { setError("Not authenticated"); setLoading(false); return; }
    fetch("/api/blocks-project/list?page=0&pageSize=100", {
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`${res.status}`);
        const data = await res.json();
        // Response is array of { tenantGroupId, projects: [...] }
        const groups = Array.isArray(data) ? data : (data?.data?.items || data?.items || []);
        const all: BlocksProject[] = [];
        for (const g of groups) {
          const tgId = g.tenantGroupId || "";
          const projs = Array.isArray(g.projects) ? g.projects : [g];
          for (const p of projs) {
            all.push({ ...p, TenantGroupId: tgId });
          }
        }
        setProjects(all);
      })
      .catch((e) => setError(String(e.message || "Failed to load projects")))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <PageHeader
        title={t("shell.nav.projects", "Projects")}
        actions={
          <Button variant="primary" icon={<Plus size={16} />} onClick={() => navigate("/new")}>
            {t("shell.dashboard.newProject", "New project")}
          </Button>
        }
      />

      {loading && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-40 animate-pulse rounded-card bg-surface2" />
          ))}
        </div>
      )}

      {error && <Card><EmptyState title="Could not load projects" text={error} /></Card>}

      {!loading && !error && projects.length === 0 && (
        <Card>
          <EmptyState
            icon={<FolderKanban size={48} strokeWidth={1.5} className="opacity-50" />}
            title="No projects yet"
            text="Create your first project to get started."
            action={
              <Button variant="primary" icon={<Plus size={16} />} onClick={() => navigate("/new")}>
                New project
              </Button>
            }
          />
        </Card>
      )}

      {!loading && projects.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => {
            const id = p.TenantGroupId || p.tenantGroupId || p.ItemId || p.itemId || "";
            const name = p.name || p.Name || p.ProjectName || "Untitled";
            const apps = p.applications || [];
            const domain = apps[0]?.domain || p.domain || p.Domain || "";
            const env = p.environment || "dev";
            const resources = p.Resources || [];
            return (
              <Card key={id} className="flex flex-col gap-3 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate text-[15px] font-medium">{name}</h3>
                    {domain && (
                      <a href={domain} target="_blank" rel="noopener noreferrer"
                        className="mt-1 flex items-center gap-1 text-[12px] text-ink3 hover:text-accent">
                        <ExternalLink size={12} /> {domain.replace("https://", "")}
                      </a>
                    )}
                  </div>
                  <span className="shrink-0 rounded-full bg-accent/10 px-2.5 py-0.5 text-[11px] font-medium text-accent">
                    {env}
                  </span>
                </div>

                {resources.length > 0 && (
                  <div className="space-y-1">
                    {resources.map((r, i) => (
                      <a key={i} href={r.Link} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-1.5 text-[13px] text-ink2 hover:text-accent">
                        <FolderGit2 size={14} /> {r.Name || "Repository"}
                      </a>
                    ))}
                  </div>
                )}

                {resources.length === 0 && (
                  <p className="text-[12px] text-ink3">No repositories connected</p>
                )}

                <div className="mt-auto flex items-center justify-between pt-2">
                  <span className="text-[11px] text-ink3">{p.createdDate ? new Date(p.createdDate).toLocaleDateString() : ""}</span>
                  <button
                    type="button"
                    onClick={async () => {
                      setActiveProject({ tenantGroupId: id, tenantId: p.tenantId || `D${id}`, name, domain: apps[0]?.domain });
                      // Look up the MADP project linked to this Blocks project
                      const token = getOidcAccessToken();
                      if (token) {
                        try {
                          const res = await fetch("/api/data", {
                            method: "POST", credentials: "include",
                            headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
                            body: JSON.stringify({ reads: [{ schema: "Project", fields: ["ItemId", "BlocksProjectRef", "Stage"], filter: [{ field: "BlocksProjectRef", op: "eq", value: id }], pageNo: 1, pageSize: 1 }] }),
                          });
                          const data = await res.json() as { results?: Array<{ items?: Array<{ ItemId: string; Stage?: string }> }> };
                          const madpProject = data.results?.[0]?.items?.[0];
                          if (madpProject) {
                            const step = madpProject.Stage === "build" ? "build" : madpProject.Stage === "release" ? "delivered" : "business";
                            navigate(`/p/${madpProject.ItemId}/${step}`);
                            return;
                          }
                        } catch { /* fall through */ }
                      }
                      navigate(`/project/${id}`);
                    }}
                    className="inline-flex items-center gap-1 rounded-full bg-accent px-3 py-1 text-[12px] font-medium text-white hover:bg-accent-hover"
                  >
                    Open <ArrowUpRight size={12} />
                  </button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
