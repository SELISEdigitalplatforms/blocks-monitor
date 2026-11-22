import { afterEach, describe, expect, it } from "vitest";
import { setCulture, t } from "../../src/i18n";

afterEach(() => setCulture("en"));

describe("the office visit in German (Switzerland)", () => {
  it("reads its texts from the studio module's office.visit keys", () => {
    setCulture("de-CH");
    expect(t("studio.office.visit.items.handOver", "Start project analysis")).toBe("Projektanalyse starten");
    expect(t("studio.office.visit.q.counter", "Question {n} of {total}", { n: 2, total: 5 })).toBe("Frage 2 von 5");
    expect(t("studio.office.visit.top.close", "Close")).toBe("Schliessen");
    setCulture("en");
    expect(t("studio.office.visit.top.close", "Close")).toBe("Close");
  });
});
