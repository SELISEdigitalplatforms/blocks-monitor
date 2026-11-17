import { ProjectRepoList } from "@seliseblocks/genesis-os/components";
import { useT } from "@seliseblocks/genesis-os/i18n";
import { getRuntimeEnv } from "@seliseblocks/genesis-os/lib";
import { useProjectStore } from "@seliseblocks/genesis-os/store";
import { Link } from "react-router";

export default function ProjectRepositoriesPage() {
  const { t } = useT("monitor.repos");
  const project = useProjectStore((state) => state.selectedProject);
  const releaseUrl = getRuntimeEnv("BLOCKS_RELEASE_BASE_URL");
  if (!project)
    return <p className="text-muted-foreground">{t("MADP_HOST.SELECT_PROJECT_REPOSITORIES")}</p>;

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">{t("MADP_HOST.REPOSITORIES")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("MADP_HOST.REPOSITORIES_DESCRIPTION")}
          </p>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <Link className="text-primary underline" to={`../madp`}>
            {t("MADP_HOST.RETURN")}
          </Link>
          {releaseUrl && (
            <a
              className="text-primary underline"
              href={`${releaseUrl.replace(/\/$/, "")}/app/${encodeURIComponent(project.itemId)}/dashboard`}
            >
              {t("MADP_HOST.MANAGE_CONNECTION")}
            </a>
          )}
        </div>
      </div>
      <ProjectRepoList project={project} isLoading={false} />
    </section>
  );
}
