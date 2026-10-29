import type { IAlertResponse } from "@/models/alerts.model";

/** How the Alert recipients API names the two monitor types. */
export type AlertRecipientMonitorKind = "HttpCheck" | "Heartbeat";

/** An editable monitor of the project (never Blocks services or Infrastructure). */
export interface IAlertRecipientMonitor {
  itemId: string;
  name: string;
  kind: AlertRecipientMonitorKind;
  isActive: boolean;
  /** How many emails the monitor holds now. */
  emailCount: number;
}

export interface IAlertRecipient {
  /** Normalized: trimmed and lower-case. */
  email: string;
  /** Stored "All monitors" choice AND the person is on every editable monitor. */
  allMonitors: boolean;
  /**
   * The stored "All monitors" choice on its own. It differs from `allMonitors` when the person
   * chose All but was skipped on a full monitor. Optional so an API without the field still works.
   */
  allMonitorsChoice?: boolean;
  /** The editable monitors whose emails contain this person. */
  monitorIds: string[];
}

export interface IAlertRecipientsData {
  maxEmailsPerMonitor: number;
  monitors: IAlertRecipientMonitor[];
  recipients: IAlertRecipient[];
  monitorsWithoutRecipients: string[];
}

export interface IAlertRecipientSuggestions {
  memberEmails: string[];
}

export interface ISaveAlertRecipientPayload {
  projectKey: string;
  email: string;
  allMonitors: boolean;
  monitorIds: string[];
}

export interface IDeleteAlertRecipientPayload {
  projectKey: string;
  email: string;
}

export interface IAlertRecipientMonitorRef {
  itemId: string;
  name: string;
}

export interface IAlertRecipientChangeResult {
  email: string;
  allMonitors: boolean;
  added: number;
  removed: number;
  unchanged: number;
  skippedFull: IAlertRecipientMonitorRef[];
  conflicted: IAlertRecipientMonitorRef[];
  denied: IAlertRecipientMonitorRef[];
}

export interface IDeleteAlertRecipientResult {
  email: string;
  removed: number;
  conflicted: IAlertRecipientMonitorRef[];
  denied: IAlertRecipientMonitorRef[];
}

export type GetAlertRecipientsResponse = IAlertResponse<IAlertRecipientsData | null>;
export type GetAlertRecipientSuggestionsResponse =
  IAlertResponse<IAlertRecipientSuggestions | null>;
export type SaveAlertRecipientResponse = IAlertResponse<IAlertRecipientChangeResult | null>;
export type DeleteAlertRecipientResponse = IAlertResponse<IDeleteAlertRecipientResult | null>;
