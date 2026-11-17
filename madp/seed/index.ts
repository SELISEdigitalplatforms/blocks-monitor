// seedAll: the whole local factory — people and accounts, the platform settings, the client workspaces and their
// projects at every step of the journey — written through the target's gateway, IAM and storage.
// Deterministic: the same target.now gives the same rows (ItemIds come from the store).
import { Seeder } from "./core/writer";
import { PROJECTS } from "./data/projects";
import { WORKSPACES } from "./data/workspaces";
import { seedPeople, seedPlatform } from "./build/platform";
import { seedProject } from "./build/project";
import { seedWorkspace } from "./build/workspaces";
import type { World } from "./build/world";
import type { SeedSummary, SeedTarget } from "./target";

export type { SeedSummary, SeedTarget, SeedUser } from "./target";
export { PASSWORD } from "./data/people";

export async function seedAll(target: SeedTarget): Promise<SeedSummary> {
  const s = new Seeder(target);
  const w: World = { s, users: new Map(), ws: new Map(), wsDefs: new Map(), superAdmin: "daniel", seq: new Map() };
  const users = await seedPeople(w);
  await seedPlatform(w);
  for (const def of WORKSPACES) await seedWorkspace(w, def);
  for (const plan of PROJECTS) await seedProject(w, plan);
  return { users, workspaces: WORKSPACES.length, projects: PROJECTS.length, rows: s.rows, files: s.files };
}
