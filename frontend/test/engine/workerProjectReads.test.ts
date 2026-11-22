import { describe, expect, it } from "vitest";
import { readProjectSchemas, retryPreparationRead } from "../../server/blocks/engineWorker/store.ts";

describe("worker preparation reads", () => {
  it("bounds parallel requests and retains schema order", async () => {
    let active = 0;
    let peak = 0;
    const schemas = Array.from({ length: 15 }, (_, i) => `Schema${i}`);
    const values = await readProjectSchemas(schemas, async (schema) => {
      peak = Math.max(peak, ++active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--;
      return schema;
    });
    expect(peak).toBeLessThanOrEqual(4);
    expect(values).toEqual(schemas);
  });

  it("fails preparation rather than treating an unreadable schema as empty", async () => {
    await expect(readProjectSchemas(["Ticket", "Milestone"], async (schema) => {
      if (schema === "Milestone") throw new Error("gateway unavailable");
      return [];
    })).rejects.toThrow("gateway unavailable");
  });

  it("retries the observed transient gateway error and returns the complete read", async () => {
    let calls = 0;
    const value = await retryPreparationRead(async () => {
      if (++calls === 1) throw Object.assign(new Error("internal"), { cause: { name: "GatewayErrors", errorText: "Unexpected Execution Error" } });
      return ["ticket"];
    });
    expect(value).toEqual(["ticket"]);
    expect(calls).toBe(2);
  });

  it("does not retry access refusals", async () => {
    let calls = 0;
    await expect(retryPreparationRead(async () => { calls++; throw new Error("forbidden"); })).rejects.toThrow("forbidden");
    expect(calls).toBe(1);
  });
});
