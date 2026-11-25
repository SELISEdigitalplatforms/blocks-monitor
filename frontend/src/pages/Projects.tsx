import { readOidcSession } from "@/blocks/oidcSession";
import { BlocksProjectsView } from "@/components/home/BlocksProjectsView";
import { ProjectsView } from "@/components/home/ProjectsView";

export default function Projects() {
  // OIDC session: show Blocks projects from the OS API
  const oidc = readOidcSession();
  if (oidc) return <BlocksProjectsView />;
  return <ProjectsView />;
}
