import { describe, expect, it } from "vitest";
import fixture from "../__fixtures__/alert-recipient-emails.json";
import {
  ALERT_RECIPIENT_EMAIL_MAX_LENGTH,
  INVALID_EMAIL_MESSAGE,
  alertRecipientEmailSchema,
  normalizeAlertRecipientEmail,
} from "@/utils/alert-recipient-email.util";

type EmailCase = { input: string; valid: boolean; normalized?: string; reason?: string };
const cases = fixture.cases as EmailCase[];

// The same list runs in the server's xUnit suite, so both sides accept exactly the same
// addresses (#256 Q12, H16, C1).
describe("alert-recipient email rule (shared fixture)", () => {
  it("matches the fixture's length limit", () => {
    expect(ALERT_RECIPIENT_EMAIL_MAX_LENGTH).toBe(fixture.maxLength);
  });

  it("covers both valid and invalid addresses, including a@b_c.com", () => {
    expect(cases.some((c) => c.valid)).toBe(true);
    expect(cases.some((c) => !c.valid)).toBe(true);
    expect(cases.find((c) => c.input === "a@b_c.com")?.valid).toBe(false);
  });

  it.each(cases.filter((c) => c.valid))(
    "accepts $input as $normalized",
    ({ input, normalized }) => {
      expect(normalizeAlertRecipientEmail(input)).toBe(normalized);
    },
  );

  it.each(cases.filter((c) => !c.valid))("rejects $input ($reason)", ({ input }) => {
    expect(normalizeAlertRecipientEmail(input)).toBeNull();
    const result = alertRecipientEmailSchema.safeParse(input);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(INVALID_EMAIL_MESSAGE);
  });
});
