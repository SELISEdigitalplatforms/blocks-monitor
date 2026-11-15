import { describe, expect, it } from "vitest";
import fixture from "../__fixtures__/alert-recipient-emails.json";
import {
  ALERT_RECIPIENT_EMAIL_MAX_LENGTH,
  getInvalidEmailMessage,
  alertRecipientEmailSchema,
  addAlertRecipientEmails,
  normalizeAlertRecipientEmail,
  splitAlertRecipientEmails,
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
    expect(result.error?.issues[0]?.message).toBe(getInvalidEmailMessage());
  });
});

describe("splitAlertRecipientEmails", () => {
  it("splits on commas, semicolons, spaces and new lines, dropping empty parts", () => {
    expect(splitAlertRecipientEmails(" a@x.com, b@x.com;c@x.com\nd@x.com  e@x.com,, ")).toEqual([
      "a@x.com",
      "b@x.com",
      "c@x.com",
      "d@x.com",
      "e@x.com",
    ]);
  });

  it("returns nothing for blank input", () => {
    expect(splitAlertRecipientEmails("  ,; \n")).toEqual([]);
  });
});

describe("addAlertRecipientEmails", () => {
  it("appends normalized addresses and skips repeats", () => {
    expect(addAlertRecipientEmails(["a@x.com"], " B@X.com, a@x.com;A@x.com ")).toEqual([
      "a@x.com",
      "b@x.com",
    ]);
  });

  it("keeps invalid parts as typed so they can be shown", () => {
    expect(addAlertRecipientEmails([], "sam@ bob")).toEqual(["sam@", "bob"]);
  });

  it("leaves the list alone for blank text", () => {
    expect(addAlertRecipientEmails(["a@x.com"], " ,; ")).toEqual(["a@x.com"]);
  });
});
