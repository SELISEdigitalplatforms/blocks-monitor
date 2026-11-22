// A job that stopped because the engine's AI gave no usable answer (ai.failed: nothing built in was written in its
// place) shows the app's own line, in the chosen language, like the other job failures it knows.
import { afterEach, describe, expect, it } from "vitest";
import { AI_FAILED_CODE as SERVER_CODE, AI_FAILED_MESSAGE } from "../../server/local/engine/ai/index.ts";
import { AI_FAILED_CODE, failedJobText, toEngineJob } from "../../src/blocks/engine/types";
import { resetI18nForTests, setCulture } from "../../src/i18n";

const row = (o: Record<string, unknown> = {}) => ({ ItemId: "j1", ProjectId: "p1", Kind: "requirements.draft", Status: "failed", ErrorCode: AI_FAILED_CODE, Message: AI_FAILED_MESSAGE, ...o });

afterEach(() => resetI18nForTests());

describe("the ai.failed line", () => {
  it("is the same code on both sides", () => {
    expect(AI_FAILED_CODE).toBe(SERVER_CODE);
  });
  it("shows the app's words for the code, in English and in German", () => {
    expect(toEngineJob(row())?.message).toBe("The AI did not give a usable answer, so nothing was written. Start it again in a moment.");
    setCulture("de-CH");
    expect(toEngineJob(row())?.message).toBe("Die KI hat keine brauchbare Antwort geliefert, deshalb wurde nichts geschrieben. Starten Sie es in einem Moment erneut.");
  });
  it("leaves every other failure and every other status with the job's own line", () => {
    expect(failedJobText("engine.failed")).toBeNull();
    expect(toEngineJob(row({ ErrorCode: "engine.failed", Message: "The requirements draft stopped." }))?.message).toBe("The requirements draft stopped.");
    expect(toEngineJob(row({ Status: "running", Message: "Reading the brief." }))?.message).toBe("Reading the brief.");
  });
});
