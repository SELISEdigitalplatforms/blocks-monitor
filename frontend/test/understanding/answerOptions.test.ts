// "Questions for you": every product manager question offers a few answers to pick with one click.
import { describe, expect, it } from "vitest";
import { alternativesOf, answerOptions, currencyOf } from "../../src/components/sanitization/answerOptions";

const MARKET = { goal: "Let local makers sell digital files online.", users: "Independent designers who sell.", client: "QA Studio", words: "a price in CHF" };

describe("answerOptions", () => {
  it("offers 2 to 4 answers for each question a product manager asked on a marketplace", () => {
    const asked = [
      "What fee or commission, if any, should the shop take from each sale?",
      "How should makers receive their money, and what do you need to check before paying them?",
      "Can anyone sign up as a maker, or must you approve each maker first?",
      "Which kinds of files can makers upload, and what is the largest file size you expect?",
      "What should happen if a buyer's payment fails or the download e-mail never arrives?",
      "How many makers and sales a month do you hope for in the first year?",
      "Must a person at QA Studio check each uploaded asset before it goes on sale?",
      "What should happen if a buyer asks for a refund or says the download is faulty?",
      "Do buyers need to create an account, or can they buy as guests?",
      "Which colour scheme do you like?",
    ];
    for (const q of asked) {
      const o = answerOptions(q, MARKET);
      expect(o.length, q).toBeGreaterThanOrEqual(2);
      expect(o.length, q).toBeLessThanOrEqual(4);
      expect(new Set(o.map((x) => x.toLowerCase())).size, q).toBe(o.length);
    }
  });

  it("answers fit the topic of the question", () => {
    expect(answerOptions("What percentage commission should the marketplace take on each sale?")).toContain("15% of each sale");
    expect(answerOptions("Do buyers need to create an account, or can they buy as guests?")[0]).toBe("Guests can buy with an e-mail; an account is optional");
    expect(answerOptions("Can anyone sign up as a maker, or must you approve each maker first?")).toEqual([
      "Anyone can sign up as a maker", "We approve each new maker first", "Anyone can sign up; we check their first upload",
    ]);
    expect(answerOptions("What should happen if a buyer asks for a refund or says the download is faulty?")[0]).toMatch(/refund within 14 days/i);
    expect(answerOptions("How many makers and sales a month do you hope for in the first year?")).toEqual([
      "A small start: up to 100 a month", "About 1,000 a month", "10,000 or more a month",
    ]);
  });

  it("uses the project's own words: its currency, goal and users", () => {
    expect(answerOptions("How and when should creators be paid their share, and is there a minimum amount before a payout?", MARKET)[0])
      .toBe("Monthly by bank transfer, once their balance reaches 50 CHF");
    expect(answerOptions("What should the marketplace achieve for QA Studio?", MARKET)[0]).toBe("Let local makers sell digital files online");
    expect(answerOptions("Who will use the marketplace: which groups of people?", MARKET)[0]).toBe("Independent designers who sell");
    expect(currencyOf("", { region: "Switzerland" })).toBe("CHF");
    expect(currencyOf("Prices in EUR?", {})).toBe("EUR");
    expect(currencyOf("", {})).toBe("");
  });

  it("splits an either-or question into two statements", () => {
    expect(alternativesOf("Should the marketplace show reviews from buyers, or keep it simple?"))
      .toEqual(["The marketplace should show reviews from buyers", "Keep it simple"]);
    expect(alternativesOf("What do you want, or not?")).toBeNull();
  });
});

describe("the product manager's own options first", () => {
  it("offers the stored options of a question; the wording-based ones only without them", async () => {
    const { optionsFor, answerOptions } = await import("../../src/components/sanitization/answerOptions");
    const q = "What must a listing meet to be approved, and how quickly should our team review it?";
    expect(optionsFor({ Question: q, Options: ["Within 2 working days", "Within 1 working day", "Within 1 week"] })).toEqual(["Within 2 working days", "Within 1 working day", "Within 1 week"]);
    expect(optionsFor({ Question: q, Options: [] })).toEqual(answerOptions(q));
    expect(optionsFor({ Question: q, Options: ["Only one"] })).toEqual(answerOptions(q));
    expect(optionsFor({ Question: q })).toEqual(answerOptions(q));
  });
});
