import { MONITOR_SOURCE_TYPES } from "@/constants/alert.constant";
import type {
  AlertRecipientMonitorKind,
  IAlertRecipient,
  IAlertRecipientMonitor,
} from "@/models/alert-recipients.model";
import { tStatic } from "@seliseblocks/genesis-os/i18n";

const MONITOR_ALERT_RECIPIENTS_MODULE = "monitor.alert-recipients";

/** "1 monitor" / "3 monitors". */
export const countMonitors = (count: number) =>
  tStatic(MONITOR_ALERT_RECIPIENTS_MODULE, "ALERT_RECIPIENTS_UTILS.MONITOR_COUNT", { count });

export const monitorKindLabel = (kind: AlertRecipientMonitorKind) =>
  kind === "Heartbeat"
    ? tStatic(MONITOR_ALERT_RECIPIENTS_MODULE, "ALERT_RECIPIENTS_UTILS.KIND_HEARTBEAT")
    : tStatic(MONITOR_ALERT_RECIPIENTS_MODULE, "ALERT_RECIPIENTS_UTILS.KIND_HTTP_CHECK");

export const recipientCountLabel = (count: number) =>
  tStatic(MONITOR_ALERT_RECIPIENTS_MODULE, "ALERT_RECIPIENTS_UTILS.RECIPIENT_COUNT", { count });

/** The coverage badge's text. The text states the meaning; colour only repeats it. */
export const coverageText = (total: number, withoutRecipients: number) => {
  if (withoutRecipients === 0) {
    return total === 1
      ? tStatic(MONITOR_ALERT_RECIPIENTS_MODULE, "ALERT_RECIPIENTS_UTILS.COVERAGE_ALL_ONE")
      : tStatic(MONITOR_ALERT_RECIPIENTS_MODULE, "ALERT_RECIPIENTS_UTILS.COVERAGE_ALL", { total });
  }
  if (withoutRecipients === 1) {
    return total === 1
      ? tStatic(MONITOR_ALERT_RECIPIENTS_MODULE, "ALERT_RECIPIENTS_UTILS.COVERAGE_ONE_OF_ONE")
      : tStatic(MONITOR_ALERT_RECIPIENTS_MODULE, "ALERT_RECIPIENTS_UTILS.COVERAGE_ONE_OF_MANY", {
          total,
        });
  }
  return tStatic(MONITOR_ALERT_RECIPIENTS_MODULE, "ALERT_RECIPIENTS_UTILS.COVERAGE_MANY", {
    withoutRecipients,
    total,
  });
};

/** The removal notice (H7). */
export const removedNotice = (email: string, removed: number) =>
  tStatic(MONITOR_ALERT_RECIPIENTS_MODULE, "ALERT_RECIPIENTS_UTILS.REMOVED_NOTICE", {
    email,
    count: removed,
  });

/** The "All monitors" choice to show and resend: the stored flag when the API sends it (#256 Q4). */
export const storedAllMonitors = (recipient: IAlertRecipient) =>
  recipient.allMonitorsChoice ?? recipient.allMonitors;

/**
 * Rows whose email or any monitor name contains the search text, case-insensitive (H15). Every
 * monitor name counts, including chips collapsed behind "+K more".
 */
export const filterRecipients = (
  recipients: IAlertRecipient[],
  monitorsById: ReadonlyMap<string, IAlertRecipientMonitor>,
  search: string,
) => {
  const needle = search.trim().toLowerCase();
  if (!needle) return recipients;
  return recipients.filter((recipient) => {
    if (recipient.email.toLowerCase().includes(needle)) return true;
    const names = recipient.allMonitors
      ? Array.from(monitorsById.values()).map((m) => m.name)
      : recipient.monitorIds.map((id) => monitorsById.get(id)?.name ?? "");
    return names.some((name) => name.toLowerCase().includes(needle));
  });
};

const compareOrdinal = (a: string, b: string) => {
  if (a === b) return 0;
  return a < b ? -1 : 1;
};

/** Ordinal (code unit) order, the same as the server's `StringComparer.Ordinal` sort. */
export const sortByEmail = (recipients: IAlertRecipient[]) =>
  [...recipients].sort((a, b) => compareOrdinal(a.email, b.email));

/**
 * A monitor detail's source type: the server's effective value, then the stored one (#256 Q10).
 * The legacy `monitorSourceTypes` is never returned by the API, so it is not read here.
 */
export const resolveMonitorSourceType = (monitor?: {
  effectiveMonitorSourceType?: number | null;
  monitorSourceType?: number | null;
}): number | undefined =>
  monitor?.effectiveMonitorSourceType ?? monitor?.monitorSourceType ?? undefined;

/** Infrastructure (0) and Blocks services (2) monitors are not on the Alert recipients page. */
export const hasManagedRecipients = (sourceType: number | undefined) =>
  sourceType !== Number(MONITOR_SOURCE_TYPES.Infrastructure) &&
  sourceType !== Number(MONITOR_SOURCE_TYPES.BlocksServices);

/** Shown when every monitor the removed person was on has been deleted since, so Undo has nothing to restore. */
export const getUndoNothingLeft = () =>
  tStatic(MONITOR_ALERT_RECIPIENTS_MODULE, "ALERT_RECIPIENTS_UTILS.UNDO_NOTHING_LEFT");
