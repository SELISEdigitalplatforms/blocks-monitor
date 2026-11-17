import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CLIPS, PEOPLE, clipsFor } from "./manifest";

describe("office people manifest", () => {
  it("has ten models with unique ids", () => {
    expect(PEOPLE).toHaveLength(10);
    expect(new Set(PEOPLE.map((p) => p.id)).size).toBe(PEOPLE.length);
  });

  it("points every url at a file under public/", () => {
    for (const p of PEOPLE) {
      expect(p.url.startsWith("/madp/")).toBe(true);
      expect(existsSync(join(process.cwd(), "public", p.url.slice("/madp/".length))), p.url).toBe(true);
    }
  });

  it("names the clips of each family", () => {
    expect(CLIPS.A).toEqual({ idle: "Idle", walk: "Walk", work: "Interact", greet: "Wave" });
    expect(CLIPS.B_male).toEqual({
      idle: "Man_Idle",
      walk: "Man_Walk",
      work: "Man_Standing",
      greet: "Man_Clapping",
      sit: "Man_Sitting",
    });
    expect(CLIPS.B_female).toEqual({
      idle: "Female_Idle",
      walk: "Female_Walk",
      work: "Female_Standing",
      greet: "Female_Clapping",
      sit: "Female_Sitting",
    });
  });

  it("resolves the clip map from family and gender", () => {
    for (const p of PEOPLE) {
      const c = clipsFor(p);
      if (p.family === "A") expect(c.sit).toBeUndefined();
      else expect(c.idle).toBe(p.gender === "male" ? "Man_Idle" : "Female_Idle");
    }
  });
});
