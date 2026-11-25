/**
 * Blocks Project Detail Page: shows a single project's info, connected repos,
 * and actions (connect repo, trigger build, deploy).
 */
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ExternalLink, FolderGit2, Plus, Rocket, Settings, Check, Link2 } from "lucide-react";
import { Button, Card, EmptyState, PageHeader } from "@/ui/kit";
import { getActiveProject, setActiveProject, clearActiveProject } from "@/blocks/activeProject";

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
  const [githubAuthed, setGithubAuthed] = useState<boolean | null>(null);
  const [repos, setRepos] = useState<Array<{ id: number; full_name: string; html_url: string; description?: string }>>([]);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [addingRepo, setAddingRepo] = useState(false);
  const [repoUrl, setRepoUrl] = useState("");
  const [repoMsg, setRepoMsg] = useState("");
  const [selectedRepos, setSelectedRepos] = useState<Set<string>>(new Set());

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

  // Check GitHub authorization status
  useEffect(() => {
    const token = getOidcToken();
    if (!token) return;
    // Get user ID from OIDC token
    let userId = "";
    try {
      const payload = JSON.parse(atob(token.split(".")[1]));
      userId = payload.user_id || payload.sub || "";
    } catch { /* ignore */ }
    if (!userId) { setGithubAuthed(false); return; }
    fetch(`/api/github/status/${encodeURIComponent(userId)}`, {
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
    })
      .then((r) => r.json())
      .then((data: { connected?: boolean }) => setGithubAuthed(data.connected === true))
      .catch(() => setGithubAuthed(false));
  }, []);

  // Connect GitHub: open the Blocks OS project page where the user can connect GitHub
  const connectGithub = () => {
    const active = getActiveProject();
    const clientId = "Ov23lihZrhV84qB0u85W";
    const redirectUri = `${window.location.origin}/api/github/callback`;
    const state = crypto.randomUUID();
    const osUrl = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=repo%20read:user%20read:org&state=${state}`;
    const popup = window.open(osUrl, "github-oauth", "width=600,height=700,popup=yes");
    // Listen for the popup to reach our callback URL (same-origin)
    const poll = setInterval(() => {
      try {
        if (popup?.closed) {
          clearInterval(poll);
          // Popup closed — assume GitHub was connected, re-check status
          setGithubAuthed(true);
          return;
        }
        // Check if popup navigated to our callback (same-origin, can read URL)
        const loc = popup?.location?.href;
        if (loc && loc.includes("/api/github/callback")) {
          clearInterval(poll);
          setGithubAuthed(true);
          setTimeout(() => { try { popup?.close(); } catch {} }, 1000);
        }
      } catch { /* cross-origin — keep polling */ }
    }, 500);
    setTimeout(() => clearInterval(poll), 300_000);
  };

  // Load repos when GitHub is connected
  const loadRepos = async () => {
    const token = getOidcToken();
    let userId = "";
    if (token) {
      try { const p = JSON.parse(atob(token.split(".")[1])); userId = p.user_id || p.sub || ""; } catch {}
    }
    if (!userId) {
      // Try from session profile
      try {
        const raw = sessionStorage.getItem("madp-oidc-session-v1");
        if (raw) {
          const data = JSON.parse(raw) as { profile?: { userId?: string } };
          userId = data.profile?.userId || "";
        }
      } catch {}
    }
    if (!userId) { console.warn("[loadRepos] no userId"); setRepos([]); setLoadingRepos(false); return; }
    setLoadingRepos(true);
    try {
      const headers: Record<string, string> = { accept: "application/json" };
      if (token) headers.authorization = `Bearer ${token}`;
      const res = await fetch(`/api/github/repos/${encodeURIComponent(userId)}`, {
        headers, credentials: "include",
      });
      const data = await res.json();
      console.log("[loadRepos] status:", res.status, "data:", JSON.stringify(data).slice(0, 500));
      const rawRepos = data?.repos || data?.data?.items || (Array.isArray(data) ? data : []);
      const items = rawRepos.map((r: Record<string, unknown>) => ({
        id: String(r.fullName || r.full_name || `${r.owner}/${r.name}` || r.id || ""),
        full_name: String(r.fullName || r.full_name || `${r.owner}/${r.name}` || ""),
        html_url: `https://github.com/${r.fullName || r.full_name || `${r.owner}/${r.name}`}`,
        description: String(r.description || ""),
      }));
      console.log("[loadRepos] parsed:", items.length, "repos");
      setRepos(items);
    } catch (err) { console.error("[loadRepos] error:", err); setRepos([]); }
    finally { setLoadingRepos(false); }
  };

  // Add selected repos as assets
  const addSelectedRepos = async () => {
    const token = getOidcToken();
    if (!token || selectedRepos.size === 0) return;
    setRepoMsg("");
    for (const fullName of selectedRepos) {
      const repo = repos.find((r) => r.full_name === fullName);
      if (!repo) continue;
      try {
        await fetch("/api/blocks-project/add-asset", {
          method: "POST", credentials: "include",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify({
            tenantGroupId: id,
            resource: { resourceId: String(repo.id), name: repo.full_name, link: repo.html_url },
          }),
        });
      } catch { /* continue */ }
    }
    setRepoMsg(`Connected ${selectedRepos.size} repo(s)!`);
    setSelectedRepos(new Set());
    setAddingRepo(false);
  };

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
        <button type="button" onClick={() => { clearActiveProject(); navigate("/projects"); }} className="inline-flex items-center gap-1.5 text-[13px] font-medium text-ink2 hover:text-accent">
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

      {/* GitHub Connection */}
      <Card title="GitHub Connection" icon={<Link2 size={18} />} className="mb-5">
        {githubAuthed === null && <p className="text-[13px] text-ink3">Checking GitHub status…</p>}
        {githubAuthed === true && !addingRepo && (
          <div className="flex items-center justify-between">
            <p className="flex items-center gap-2 text-[14px] text-green-600"><Check size={16} /> GitHub connected</p>
            <div className="flex gap-2">
              <Button variant="secondary" icon={<Plus size={16} />} onClick={() => { setAddingRepo(true); loadRepos(); }}>Add Repository</Button>
            </div>
          </div>
        )}
        {githubAuthed === false && !addingRepo && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <p className="text-[14px] text-ink2">Connect your GitHub account to access repositories.</p>
              <Button variant="primary" icon={<Link2 size={16} />} onClick={connectGithub}>Connect GitHub</Button>
            </div>
            <button type="button" onClick={() => { setAddingRepo(true); loadRepos(); }} className="text-[13px] text-accent hover:underline text-left">
              Already connected? Load repos anyway
            </button>
          </div>
        )}
      </Card>

      {/* Connected Repos */}
      <Card title="Connected Repositories" icon={<FolderGit2 size={18} />} className="mb-5">
        {(project?.resources || []).length === 0 && !addingRepo && (
          <EmptyState
            title="No repositories connected"
            text={githubAuthed ? "Click 'Add Repository' above to connect a repo." : "Connect GitHub first, then add repositories."}
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

        {/* Repo picker */}
        {addingRepo && (
          <div className="mt-3">
            {loadingRepos && <p className="text-[13px] text-ink3">Loading your repositories…</p>}
            {!loadingRepos && repos.length === 0 && <p className="text-[13px] text-ink3">No repositories found. Try reconnecting GitHub.</p>}
            {!loadingRepos && repos.length > 0 && (
              <div className="max-h-[300px] overflow-y-auto space-y-1 rounded-block border border-line p-2">
                {repos.map((r) => (
                  <label key={r.id} className="flex cursor-pointer items-center gap-3 rounded-block p-2 hover:bg-surface2">
                    <input type="checkbox" checked={selectedRepos.has(r.full_name)}
                      onChange={(e) => {
                        const next = new Set(selectedRepos);
                        e.target.checked ? next.add(r.full_name) : next.delete(r.full_name);
                        setSelectedRepos(next);
                      }}
                      className="h-4 w-4 rounded border-line accent-accent" />
                    <div className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-medium">{r.full_name}</span>
                      {r.description && <span className="block truncate text-[12px] text-ink3">{r.description}</span>}
                    </div>
                  </label>
                ))}
              </div>
            )}
            <div className="mt-3 flex items-center gap-2">
              <Button variant="primary" disabled={selectedRepos.size === 0} onClick={addSelectedRepos}>
                Connect {selectedRepos.size > 0 ? `${selectedRepos.size} repo(s)` : ""}
              </Button>
              <Button variant="ghost" onClick={() => { setAddingRepo(false); setRepoMsg(""); setSelectedRepos(new Set()); }}>Cancel</Button>
            </div>
          </div>
        )}
        {repoMsg && <p className="mt-2 text-[13px] font-medium text-green-600">{repoMsg}</p>}
      </Card>
    </div>
  );
}
