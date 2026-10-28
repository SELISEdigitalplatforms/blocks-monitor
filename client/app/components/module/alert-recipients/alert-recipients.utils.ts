import { MONITOR_SOURCE_TYPES } from "@/constants/alert.constant";
import type {
  AlertRecipientMonitorKind,
  IAlertRecipient,
  IAlertRecipientMonitor,
} from "@/models/alert-recipients.model";

/** "1 monitor" / "3 monitors". */
export const countMonitors = (count: number) => `${count} ${count === 1 ? "monitor" : "monitors"}`;

export const monitorKindLabel = (kind: AlertRecipientMonitorKind) =>
  kind === "Heartbeat" ? "Heartbeat" : "HTTP Check";

export const recipientCountLabel = (count: number) =>
  `${count} ${count === 1 ? "recipient" : "recipients"}`;

/** The coverage badge's text. The text states the meaning; colour only repeats it. */
export const coverageText = (total: number, withoutRecipients: number) => {
  if (withoutRecipients === 0) {
    return total === 1 ? "The 1 monitor emails someone" : `All ${total} monitors email someone`;
  }
  return `${withoutRecipients} of ${countMonitors(total)} ${
    withoutRecipients === 1 ? "emails" : "email"
  } no one`;
};

/** The removal notice (H7). */
export const removedNotice = (email: string, removed: number) =>
  `${email} removed from ${countMonitors(removed)}. They no longer get alert emails.`;

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

export const sortByEmail = (recipients: IAlertRecipient[]) =>
  [...recipients].sort((a, b) => a.email.localeCompare(b.email));

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
