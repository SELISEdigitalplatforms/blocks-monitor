import { z } from "zod";
import { tStatic } from "@seliseblocks/genesis-os/i18n";

export const ALERT_RECIPIENT_EMAIL_MAX_LENGTH = 254;
export const getInvalidEmailMessage = () =>
  tStatic("monitor.shared", "ALERT_RECIPIENT_EMAIL_UTIL.INVALID_EMAIL");

/**
 * The alert-recipient email rule shared with the server (#256 Q12): trim, lower-case, at most 254
 * characters, then zod 4's `z.email()` pattern. The server ports the same pattern, and both sides
 * run the same list of test addresses.
 */
export const alertRecipientEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(ALERT_RECIPIENT_EMAIL_MAX_LENGTH, { error: getInvalidEmailMessage })
  .pipe(z.email({ error: getInvalidEmailMessage }));

/** The normalized address, or null when the input is not a valid email. */
export const normalizeAlertRecipientEmail = (raw: string): string | null => {
  const result = alertRecipientEmailSchema.safeParse(raw);
  return result.success ? result.data : null;
};
