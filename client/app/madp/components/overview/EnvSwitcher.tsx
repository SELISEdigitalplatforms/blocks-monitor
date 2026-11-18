/** The environment switcher at the top of the Release page: Dev | Stage | Production, each with the version it runs,
 *  read from the project's real release rows (environmentStates). An environment without a release says so, unless the
 *  records know it is live (an existing product's documented staging): then it says "live". */
import type { EnvironmentState } from "@/madp/domain/delivery";
import type { Environment } from "@/madp/domain/promotion";
import { ENV_LABEL } from "@/madp/components/delivery/releaseUi";
import { Segmented } from "@/madp/ui/kit";
import { useT } from "@/madp/i18n";

export const ENV_IDS: readonly Environment[] = ["dev", "stage", "production"];

export function EnvSwitcher({ states, value, onChange, className, live }: {
  states: Record<Environment, EnvironmentState>;
  /** Environments known to be live without a release by the Factory. */
  live?: Partial<Record<Environment, boolean>>;
  value: Environment;
  onChange: (env: Environment) => void;
  className?: string;
}) {
  const t = useT();
  return (
    <Segmented<Environment> label={t("project.overview.environment", "Environment")} value={value} onChange={onChange}
      className={className ?? "w-full sm:w-auto [&>button]:flex-1 [&>button]:px-2 sm:[&>button]:flex-none sm:[&>button]:px-4"}
      options={ENV_IDS.map((id) => {
        const cur = states[id].current;
        return {
          value: id,
          label: (
            <span className="flex items-center justify-center gap-2" title={cur ? t("project.overview.envRuns", "{env} runs v{version}", { env: ENV_LABEL[id], version: cur.version }) : live?.[id] ? t("project.overview.envLive", "{env} is live; the Factory has not released a version there yet", { env: ENV_LABEL[id] }) : t("project.overview.envNothing", "{env}: nothing released yet", { env: ENV_LABEL[id] })}>
              {ENV_LABEL[id]}
              {cur
                ? <span className="num hidden font-mono text-[12px] opacity-80 sm:inline">{`v${cur.version}`}</span>
                : <span className="hidden text-[12px] opacity-70 sm:inline">{live?.[id] ? t("project.overview.live", "live") : t("project.overview.notReleased", "not released")}</span>}
            </span>
          ),
        };
      })} />
  );
}
