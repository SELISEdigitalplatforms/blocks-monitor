import { z } from "zod";

export const ALERT_RECIPIENT_EMAIL_MAX_LENGTH = 254;
export const INVALID_EMAIL_MESSAGE = "Enter a valid email address.";

/**
 * The alert-recipient email rule shared with the server (#256 Q12): trim, lower-case, at most 254
 * characters, then zod 4's `z.email()` pattern. The server ports the same pattern, and both sides
 * run the same list of test addresses.
 */
export const alertRecipientEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(ALERT_RECIPIENT_EMAIL_MAX_LENGTH, { error: INVALID_EMAIL_MESSAGE })
  .pipe(z.email({ error: INVALID_EMAIL_MESSAGE }));

/** The normalized address, or null when the input is not a valid email. */
export const normalizeAlertRecipientEmail = (raw: string): string | null => {
  const result = alertRecipientEmailSchema.safeParse(raw);
  return result.success ? result.data : null;
};
