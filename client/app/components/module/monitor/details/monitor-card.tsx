import { Card, CardContent, CardHeader, CardTitle } from "@/components/core";
import { Pencil, Layers } from "lucide-react";
import { iconMap } from "@/models";
import { RenderConditionally } from "@seliseblocks/genesis-os/components";

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
    <Card className="rounded-lg border shadow-sm">
      <CardHeader>
        <CardTitle className="text-base font-semibold text-high-emphasis">
          General information
        </CardTitle>
      </CardHeader>

      <CardContent className="grid grid-cols-1 gap-x-8 gap-y-6 text-sm text-muted-foreground sm:grid-cols-2">
        {/* Tagged Service */}

        <div>
          <div className="mb-1 text-xs font-medium text-foreground">Tagged Service</div>

          <RenderConditionally condition={!!repoName}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="break-all">Deployed service</span>
              <div className="flex flex-wrap items-center gap-1">
                <GithubIcon className="h-4 w-4 text-foreground" />
                <span className="break-all font-medium text-foreground">{repoName}</span>
              </div>
            </div>
          </RenderConditionally>

          <RenderConditionally condition={!!externalServiceName}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="break-all">My service</span>
              <div className="flex flex-wrap items-center gap-1">
                <Layers size={14} className="text-foreground" />
                <span className="break-all font-medium text-foreground">{externalServiceName}</span>
              </div>
            </div>
          </RenderConditionally>

          {!repoName && !externalServiceName && <span className="text-foreground">{"None"}</span>}
        </div>

        {/* URL to monitor */}
        <div>
          <div className="mb-1 text-xs font-medium text-foreground">
            {request ? "URL to monitor" : "Heartbeat URL"}
          </div>
          <a
            href={url}
            className="break-all text-blue-600 hover:underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            {url}
          </a>
        </div>

        {/* Monitor type */}
        <div className={`sm:${request ? "col-span-2" : "col-span-1"}`}>
          <div className="mb-1 text-xs font-medium text-foreground">Monitor type</div>
          <div className="text-foreground">{request ? "HTTP Check" : "Heartbeat"}</div>
        </div>

        {/* Notification recipients */}
        {monitorSourceType !== 2 && (
          <div className="sm:col-span-2">
            <div className="mb-1 text-xs font-medium text-foreground">Notification recipients</div>
            <div className="flex flex-wrap items-center gap-1">
              <span className="text-foreground">{emails[0]}</span>
              <span className="text-sm text-muted-foreground">
                {(() => {
                  if (emails.length === 0) return "Add recipient";
                  if (emails.length === 1) return "";
                  return `+ ${emails.length - 1} more`;
                })()}
              </span>
              <button
                type="button"
                aria-label="Edit notification recipients"
                className="cursor-pointer text-blue-500 hover:underline"
                onClick={() => onOpenChange(true)}
              >
                <Pencil className="ml-1 inline h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default MonitorCard;
