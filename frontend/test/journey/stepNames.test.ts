// The step, phase and type names shown on screen (components/project/stepNames.ts) say in English exactly what the
// domain's constants say (src/domain stays English: the functions and the engine bundle it), and German (Switzerland)
// has a name for each of them.
import { afterEach, describe, expect, it } from "vitest";
import { JOURNEY_STEPS, STEP_LABEL, STEP_SHORT_LABEL, type JourneyPage } from "../../src/domain/journey";
import { ANALYSIS_SECTION_LABEL, ANALYSIS_STEPS, PHASES, PHASE_LABEL, PHASE_SHORT_LABEL, phaseLabelOf } from "../../src/domain/phases";
import { TYPE_LABEL, stepLabelFor, type ProjectType } from "../../src/domain/projectType";
import { phaseName, phaseNameOf, phaseShortName, stepName, stepShortName, typeName } from "../../src/components/project/stepNames";
import { setCulture } from "../../src/i18n";

const PAGES: JourneyPage[] = [...JOURNEY_STEPS, "wiki"];
const TYPES: ProjectType[] = ["greenfield", "brownfield", "greyfield"];

afterEach(() => setCulture("en"));

describe("step names in English match the domain", () => {
  it("steps, short names and the brownfield names", () => {
    for (const id of PAGES) {
      expect(stepShortName(id)).toBe(STEP_SHORT_LABEL[id]);
      for (const type of TYPES) expect(stepName(id, type)).toBe(stepLabelFor(type, id)?.label ?? STEP_LABEL[id]);
    }
    for (const id of ANALYSIS_STEPS) expect(stepName(id)).toBe(ANALYSIS_SECTION_LABEL[id]);
  });

  it("phases and types", () => {
    for (const id of PHASES) {
      expect(phaseName(id)).toBe(PHASE_LABEL[id]);
      expect(phaseShortName(id)).toBe(PHASE_SHORT_LABEL[id]);
    }
    for (const step of JOURNEY_STEPS) expect(phaseNameOf(step)).toBe(phaseLabelOf(step));
    for (const type of TYPES) expect(typeName(type)).toBe(TYPE_LABEL[type]);
  });
});

describe("step names in German (Switzerland)", () => {
  it("every name has its own German text", () => {
    setCulture("de-CH");
    for (const id of PAGES) {
      if (id !== "wiki" && id !== "release") expect(stepName(id)).not.toBe(STEP_LABEL[id]);
      expect(stepName(id)).not.toMatch(/ß/);
    }
    expect(stepName("scope")).toBe("Umfang & Erfolg");
    expect(phaseName("analysis")).toBe("Business-Analyse");
    expect(typeName("brownfield")).toBe("Bestehendes Produkt");
  });
});
