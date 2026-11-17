// The planner's requirement coverage names the screens that cover each requirement. The check expects frame node ids;
// a planner sometimes names a screen by its number ("09"), its name ("09 Creator dashboard") or its file instead.
// A reference that points to exactly one screen is resolved to that screen's node id; anything else is kept as it was,
// so the strict check after it still fails on a screen that does not exist or a reference that fits several screens.

export type PlannedScreen = { name: string; nodeId: string; file: string; requirementKeys: string[] };
export type CoverageEntry = { key: string; screens: string[]; criteria: string[]; noScreenReason?: string | null };

// Runs before the strict checks, so it must not throw on a malformed screen or entry; those checks report them.
const norm = (v: unknown) => String(v ?? '').trim().toLowerCase();
const stem = (file: unknown) => norm(String(file ?? '').split('/').pop()).replace(/\.(png|jpe?g|webp)$/, '');
const numberOf = (s: PlannedScreen) => (norm(s.name).match(/^(\d+)\b/) ?? stem(s.file).match(/^(\d+)\b/))?.[1];

function matches(all: PlannedScreen[], ref: string): PlannedScreen[] {
  const screens = all.filter((s) => s && typeof s === 'object');
  const byId = screens.filter((s) => s.nodeId === ref);
  if (byId.length) return byId;
  const r = norm(ref);
  if (/^\d+$/.test(r)) return screens.filter((s) => numberOf(s) !== undefined && Number(numberOf(s)) === Number(r));
  return screens.filter((s) => norm(s.name) === r || stem(s.file) === stem(r));
}

/** The coverage with every screen reference that points to exactly one screen given as that screen's node id. */
export function resolveCoverageScreens(screens: PlannedScreen[], coverage: CoverageEntry[]): CoverageEntry[] {
  return coverage.map((c) => !c || !Array.isArray(c.screens) ? c : ({
    ...c,
    screens: c.screens.map((ref) => {
      const found = matches(screens, String(ref));
      return found.length === 1 ? found[0].nodeId : ref;
    }),
  }));
}
