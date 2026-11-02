import { Badge, Card, CardContent, CardHeader, CardTitle } from "@/components/core";
import { hasManagedRecipients } from "@/components/module/alert-recipients/alert-recipients.utils";
import { ArrowRight, Layers } from "lucide-react";
import { iconMap } from "@/models";
import { RenderConditionally } from "@seliseblocks/genesis-os/components";
import { Link } from "react-router";
import { useT } from "@seliseblocks/genesis-os/i18n";

type IMonitorCard = {
  url: string;
  request: boolean;
  emails: string[];
  /** Effective source type; undefined when the API sent none. */
  monitorSourceType?: number;
  /** Where "Open Alert recipients" goes. */
  alertRecipientsPath: string;
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
  alertRecipientsPath,
}: IMonitorCard) => {
  const { t } = useT("monitor.monitors");
  const GithubIcon = iconMap["github"];
  return (
    <Card className="rounded-lg border shadow-xs">
      <CardHeader>
        <CardTitle className="text-base font-semibold text-high-emphasis">
          {t("MONITOR_CARD.GENERAL_INFORMATION")}
        </CardTitle>
      </CardHeader>

      <CardContent className="grid grid-cols-1 gap-x-8 gap-y-6 text-sm text-muted-foreground sm:grid-cols-2">
        {/* Tagged Service */}

        <div>
          <div className="mb-1 text-xs font-medium text-foreground">
            {t("MONITOR_CARD.TAGGED_SERVICE")}
          </div>

          <RenderConditionally condition={!!repoName}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="break-all">{t("MONITOR_CARD.DEPLOYED_SERVICE")}</span>
              <div className="flex flex-wrap items-center gap-1">
                <GithubIcon className="h-4 w-4 text-foreground" />
                <span className="break-all font-medium text-foreground">{repoName}</span>
              </div>
            </div>
          </RenderConditionally>

          <RenderConditionally condition={!!externalServiceName}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="break-all">{t("MONITOR_CARD.MY_SERVICE")}</span>
              <div className="flex flex-wrap items-center gap-1">
                <Layers size={14} className="text-foreground" />
                <span className="break-all font-medium text-foreground">{externalServiceName}</span>
              </div>
            </div>
          </RenderConditionally>

          {!repoName && !externalServiceName && (
            <span className="text-foreground">{t("MONITOR_CARD.NONE")}</span>
          )}
        </div>

        {/* URL to monitor */}
        <div>
          <div className="mb-1 text-xs font-medium text-foreground">
            {request ? t("MONITOR_CARD.URL_TO_MONITOR") : t("MONITOR_CARD.HEARTBEAT_URL")}
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
          <div className="mb-1 text-xs font-medium text-foreground">
            {t("MONITOR_CARD.MONITOR_TYPE")}
          </div>
          <div className="text-foreground">
            {request ? t("MONITOR_CARD.HTTP_CHECK") : t("MONITOR_CARD.HEARTBEAT")}
          </div>
        </div>

        {/* Notification recipients: read-only, managed on the Alert recipients page (H12). */}
        {hasManagedRecipients(monitorSourceType) && (
          <div className="sm:col-span-2">
            <div className="mb-1.5 text-xs font-medium text-foreground">
              {t("MONITOR_CARD.NOTIFICATION_RECIPIENTS")}
            </div>
            {emails.length > 0 ? (
              <ul
                className="flex flex-wrap items-center gap-1.5"
                aria-label={t("MONITOR_CARD.NOTIFICATION_RECIPIENTS")}
              >
                {emails.map((email) => (
                  <li key={email}>
                    <Badge variant="outline" className="rounded-full px-2.5 font-normal">
                      {email}
                    </Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <span className="text-muted-foreground">{t("MONITOR_CARD.NO_RECIPIENTS")}</span>
            )}
            <Link
              to={alertRecipientsPath}
              className="mt-2 inline-flex min-h-8 items-center gap-1 text-[13px] font-semibold text-primary hover:underline"
            >
              {t("MONITOR_CARD.OPEN_ALERT_RECIPIENTS")}
              <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default MonitorCard;
