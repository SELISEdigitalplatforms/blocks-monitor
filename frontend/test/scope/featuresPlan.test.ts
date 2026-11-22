// The readable features of the Scope & delivery plan: stories as one plain sentence.
import { describe, expect, it } from "vitest";
import { storySentence } from "../../src/components/scope/blocks/FeaturesPlan";

describe("storySentence", () => {
  it("keeps a story that already reads 'As …'", () => {
    expect(storySentence("customer", "As a customer, I want to repeat my last order.")).toBe("As a customer, I want to repeat my last order.");
  });
  it("builds 'As <who>, I can <what>' otherwise", () => {
    expect(storySentence("A buyer", "Repeat the last order")).toBe("As a buyer, I can repeat the last order");
    expect(storySentence("", "Repeat the last order")).toBe("Repeat the last order");
  });
});
