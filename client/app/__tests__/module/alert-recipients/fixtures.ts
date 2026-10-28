import type { IAlertRecipient, IAlertRecipientMonitor } from "@/models/alert-recipients.model";

export const monitor = (
  itemId: string,
  name: string,
  overrides: Partial<IAlertRecipientMonitor> = {},
): IAlertRecipientMonitor => ({
  itemId,
  name,
  kind: "HttpCheck",
  isActive: true,
  emailCount: 1,
  ...overrides,
});

export const recipient = (
  email: string,
  monitorIds: string[],
  overrides: Partial<IAlertRecipient> = {},
): IAlertRecipient => ({
  email,
  allMonitors: false,
  allMonitorsChoice: false,
  monitorIds,
  ...overrides,
});

/** The spec's §7 fixture: api and web are HTTP checks, worker is a heartbeat. */
export const MONITORS = [
  monitor("m1", "api", { emailCount: 2 }),
  monitor("m2", "web", { emailCount: 1 }),
  monitor("h1", "worker", { kind: "Heartbeat", emailCount: 0 }),
];
