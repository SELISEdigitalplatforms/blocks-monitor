/**
 * Blocks Projects View: lists projects from the Blocks OS API.
 * Used when OIDC session is active (instead of MADP's workspace-based project list).
 */
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { FolderKanban, Plus, ExternalLink, Github } from "lucide-react";
import { Button, Card, EmptyState, PageHeader } from "@/ui/kit";
import { getOidcAccessToken } from "@/blocks/oidcSession";
import { t } from "@/i18n";

interface BlocksProject {
  ItemId?: string;
  Name?: string;
  ProjectName?: string;
  TenantGroupId?: string;
  Domain?: string;
  Status?: string;
  Resources?: Array<{ ResourceId?: string; Name?: string; Link?: string }>;
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
    fetch("/api/blocks-project/list?page=1&pageSize=50", {
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`${res.status}`);
        const data = await res.json() as { data?: { items?: BlocksProject[] }; items?: BlocksProject[] };
        setProjects(data.data?.items || data.items || (Array.isArray(data) ? data : []));
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
            const id = p.TenantGroupId || p.ItemId || "";
            const name = p.ProjectName || p.Name || "Untitled";
            const domain = p.Domain || "";
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
                    {p.Status || "active"}
                  </span>
                </div>

                {resources.length > 0 && (
                  <div className="space-y-1">
                    {resources.map((r, i) => (
                      <a key={i} href={r.Link} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-1.5 text-[13px] text-ink2 hover:text-accent">
                        <Github size={14} /> {r.Name || "Repository"}
                      </a>
                    ))}
                  </div>
                )}

                {resources.length === 0 && (
                  <p className="text-[12px] text-ink3">No repositories connected</p>
                )}

                <div className="mt-auto pt-2 text-[11px] text-ink3">
                  {id.slice(0, 8)}…
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
