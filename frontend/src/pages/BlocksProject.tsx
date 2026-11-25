/**
 * Blocks Project Detail Page: shows a single project's info, connected repos,
 * and actions (connect repo, trigger build, deploy).
 */
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ExternalLink, FolderGit2, Plus, Rocket, Settings } from "lucide-react";
import { Button, Card, EmptyState, PageHeader } from "@/ui/kit";
import { getActiveProject, setActiveProject } from "@/blocks/activeProject";

function getOidcToken(): string | undefined {
  try {
    const raw = sessionStorage.getItem("madp-oidc-session-v1");
    if (!raw) return undefined;
    const data = JSON.parse(raw) as { accessToken?: string; expiresAtMs?: number };
    if (data.accessToken && data.expiresAtMs && data.expiresAtMs > Date.now()) return data.accessToken;
  } catch { /* ignore */ }
  return undefined;
}

interface ProjectEnv {
  name: string;
  tenantId: string;
  tenantGroupId: string;
  environment: string;
  domain?: string;
  applications?: Array<{ domain?: string; cookieDomain?: string }>;
  resources?: Array<{ resourceId?: string; name?: string; link?: string }>;
  createdDate?: string;
}

export default function BlocksProject() {
  const { id = "" } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<ProjectEnv | null>(null);
  const [loading, setLoading] = useState(true);
  const [addingRepo, setAddingRepo] = useState(false);
  const [repoUrl, setRepoUrl] = useState("");
  const [repoMsg, setRepoMsg] = useState("");

  // Ensure active project is set
  useEffect(() => {
    const active = getActiveProject();
    if (!active || active.tenantGroupId !== id) {
      // Fetch project info to set active context
      const token = getOidcToken();
      if (!token) { setLoading(false); return; }
      fetch("/api/blocks-project/list?page=0&pageSize=100", {
        headers: { authorization: `Bearer ${token}`, accept: "application/json" },
      })
        .then((r) => r.json())
        .then((data) => {
          const groups = Array.isArray(data) ? data : [];
          const group = groups.find((g: { tenantGroupId: string }) => g.tenantGroupId === id);
          if (group?.projects?.[0]) {
            const p = group.projects[0];
            setActiveProject({ tenantGroupId: id, tenantId: p.tenantId || `D${id}`, name: p.name, domain: p.applications?.[0]?.domain });
            setProject({ ...p, tenantGroupId: id, resources: group.resources || [] });
          }
        })
        .catch(() => {})
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, [id]);

  // Load project details
  useEffect(() => {
    if (project) return;
    const active = getActiveProject();
    if (active && active.tenantGroupId === id) {
      setProject({ name: active.name, tenantId: active.tenantId, tenantGroupId: id, environment: "dev", domain: active.domain });
      setLoading(false);
    }
  }, [id, project]);

  const handleAddRepo = async () => {
    if (!repoUrl.trim()) return;
    const token = getOidcToken();
    if (!token) return;
    setRepoMsg("");
    // Parse GitHub URL: https://github.com/owner/repo
    const match = repoUrl.trim().match(/github\.com\/([^/]+\/[^/]+)/);
    const repoName = match ? match[1].replace(/\.git$/, "") : repoUrl.trim();
    try {
      const res = await fetch("/api/blocks-project/add-asset", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({
          tenantGroupId: id,
          resource: { resourceId: Date.now().toString(), name: repoName, link: `https://github.com/${repoName}` },
        }),
      });
      const data = await res.json();
      if (data.isSuccess || res.ok) {
        setRepoMsg("Repository connected!");
        setRepoUrl("");
        setAddingRepo(false);
      } else {
        setRepoMsg(`Failed: ${JSON.stringify(data.errors || data.error || "Unknown error")}`);
      }
    } catch {
      setRepoMsg("Failed to connect repository");
    }
  };

  if (loading) {
    return <div className="h-64 animate-pulse rounded-card bg-surface2" />;
  }

  const name = project?.name || getActiveProject()?.name || "Project";
  const domain = project?.applications?.[0]?.domain || project?.domain || getActiveProject()?.domain || "";
  const tenantId = project?.tenantId || getActiveProject()?.tenantId || "";

  return (
    <div className="pb-6">
      <div className="mb-4">
        <button type="button" onClick={() => navigate("/projects")} className="inline-flex items-center gap-1.5 text-[13px] font-medium text-ink2 hover:text-accent">
          <ArrowLeft size={14} /> Back to projects
        </button>
      </div>

      <PageHeader title={name}
        subtitle={domain ? <a href={domain} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-ink2 hover:text-accent"><ExternalLink size={13} /> {domain.replace("https://", "")}</a> : `Tenant: ${tenantId}`}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="secondary" icon={<Settings size={16} />} onClick={() => {}}>Settings</Button>
            <Button variant="primary" icon={<Rocket size={16} />} onClick={() => {}}>Deploy</Button>
          </div>
        }
      />

      {/* Project Info */}
      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card className="p-4">
          <div className="text-[12px] font-medium text-ink3">Environment</div>
          <div className="mt-1 text-[15px] font-medium">{project?.environment || "dev"}</div>
        </Card>
        <Card className="p-4">
          <div className="text-[12px] font-medium text-ink3">Tenant Group</div>
          <div className="mt-1 truncate text-[13px] font-mono">{id}</div>
        </Card>
        <Card className="p-4">
          <div className="text-[12px] font-medium text-ink3">Tenant ID</div>
          <div className="mt-1 truncate text-[13px] font-mono">{tenantId}</div>
        </Card>
      </div>

      {/* Connected Repos */}
      <Card title="Connected Repositories" icon={<FolderGit2 size={18} />}
        className="mb-5">
        {(project?.resources || []).length === 0 && !addingRepo && (
          <EmptyState
            title="No repositories connected"
            text="Connect a GitHub repository to start building and deploying."
            action={<Button variant="primary" icon={<Plus size={16} />} onClick={() => setAddingRepo(true)}>Connect Repository</Button>}
          />
        )}
        {(project?.resources || []).map((r, i) => (
          <div key={i} className="flex items-center justify-between rounded-block bg-surface2 p-3 mb-2">
            <a href={r.link} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-[14px] text-ink hover:text-accent">
              <FolderGit2 size={16} /> {r.name}
            </a>
            <Button variant="secondary" size="sm" icon={<Rocket size={14} />} onClick={() => {}}>Build</Button>
          </div>
        ))}
        {!addingRepo && (project?.resources || []).length > 0 && (
          <div className="mt-3">
            <Button variant="ghost" size="sm" icon={<Plus size={14} />} onClick={() => setAddingRepo(true)}>Add another repo</Button>
          </div>
        )}
        {addingRepo && (
          <div className="mt-3 flex items-center gap-2">
            <input type="text" value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)}
              placeholder="owner/repo or GitHub URL"
              className="flex-1 rounded-block border border-line bg-surface px-3 py-2 text-[14px] outline-none focus:ring-2 focus:ring-accent" />
            <Button variant="primary" onClick={handleAddRepo}>Connect</Button>
            <Button variant="ghost" onClick={() => { setAddingRepo(false); setRepoMsg(""); }}>Cancel</Button>
          </div>
        )}
        {repoMsg && <p className="mt-2 text-[13px] text-ink2">{repoMsg}</p>}
      </Card>
    </div>
  );
}
