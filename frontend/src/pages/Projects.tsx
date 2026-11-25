import { BlocksProjectsView } from "@/components/home/BlocksProjectsView";
import { ProjectsView } from "@/components/home/ProjectsView";

function hasOidcSession(): boolean {
  try {
    const raw = globalThis.sessionStorage?.getItem("madp-oidc-session-v1");
    return raw !== null && raw !== undefined;
  } catch { return false; }
}

export default function Projects() {
  if (hasOidcSession()) return <BlocksProjectsView />;
  return <ProjectsView />;
}
