import { SectionHeading } from "@/components/common/section-heading/section-heading";
import { cn } from "@/lib/utils";
import {
  SECTION_CLASS,
  SURFACE_TILE_CLASS,
} from "@/components/module/monitor/details/surface-styles";
import { Pencil, Layers } from "lucide-react";
import { iconMap } from "@/models";
import { RenderConditionally } from "@seliseblocks/app-kit/components";

type IMonitorCard = {
  onOpenChange: (value: boolean) => void;
  url: string;
  request: boolean;
  emails: string[];
  monitorSourceType: number;
  repoName?: string | null;
  externalServiceName?: string | null;
};

const MonitorCard = ({
  repoName,
  externalServiceName,
  url,
  request,
  emails,
  monitorSourceType,
  onOpenChange,
}: IMonitorCard) => {
  const GithubIcon = iconMap["github"];
  return (
    <section aria-label="General information" className={SECTION_CLASS}>
      <SectionHeading
        title="General information"
        description="What this monitor checks and who it notifies"
      />

      <div
        className={cn(
          SURFACE_TILE_CLASS,
          "grid grid-cols-1 gap-x-8 gap-y-5 text-[13px] text-muted-foreground sm:grid-cols-2",
        )}
      >
        {/* Tagged Service */}

        <div>
          <div className="mb-1 text-xs font-medium text-muted-foreground">Tagged Service</div>

          <RenderConditionally condition={!!repoName}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="break-all">Deployed service</span>
              <div className="flex flex-wrap items-center gap-1">
                <GithubIcon className="h-4 w-4 text-high-emphasis" />
                <span className="break-all font-medium text-high-emphasis">{repoName}</span>
              </div>
            </div>
          </RenderConditionally>

          <RenderConditionally condition={!!externalServiceName}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="break-all">My service</span>
              <div className="flex flex-wrap items-center gap-1">
                <Layers size={14} className="text-high-emphasis" />
                <span className="break-all font-medium text-high-emphasis">
                  {externalServiceName}
                </span>
              </div>
            </div>
          </RenderConditionally>

          {!repoName && !externalServiceName && (
            <span className="text-high-emphasis">{"None"}</span>
          )}
        </div>

        {/* URL to monitor */}
        <div>
          <div className="mb-1 text-xs font-medium text-muted-foreground">
            {request ? "URL to monitor" : "Heartbeat URL"}
          </div>
          <a
            href={url}
            className="break-all text-primary hover:underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            {url}
          </a>
        </div>

        {/* Monitor type */}
        <div className={request ? "sm:col-span-2" : "sm:col-span-1"}>
          <div className="mb-1 text-xs font-medium text-muted-foreground">Monitor type</div>
          <div className="text-high-emphasis">{request ? "HTTP Check" : "Heartbeat"}</div>
        </div>

        {/* Notification recipients */}
        {monitorSourceType !== 2 && (
          <div className="sm:col-span-2">
            <div className="mb-1 text-xs font-medium text-muted-foreground">
              Notification recipients
            </div>
            <div className="flex flex-wrap items-center gap-1">
              <span className="text-high-emphasis">{emails[0]}</span>
              <span className="text-muted-foreground">
                {(() => {
                  if (emails.length === 0) return "Add recipient";
                  if (emails.length === 1) return "";
                  return `+ ${emails.length - 1} more`;
                })()}
              </span>
              <button
                type="button"
                aria-label="Edit notification recipients"
                className="cursor-pointer rounded-sm text-primary hover:text-primary-hover"
                onClick={() => onOpenChange(true)}
              >
                <Pencil className="ml-1 inline h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
};

export default MonitorCard;
