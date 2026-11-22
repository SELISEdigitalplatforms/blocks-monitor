// A small screen-design skill tree for the design brief tests (the engine's own lives in
// engine/selise-madp/MADP/skills/figma-screen-design/ and is written separately).
import fs from "node:fs";
import path from "node:path";

export const SKILL_MARKER = "SKILL BODY MARKER";
export const PRINCIPLES_MARKER = "PRINCIPLE MARKER: launch quality, never generic.";

export const STYLE_LEDGER = `---
id: quiet-ledger
name: Quiet Ledger
summary: "A calm back-office look on warm paper with a petrol accent: exact, unhurried."
use_when: ["accounting and invoicing", "finance teams, on desktop"]
avoid_when:
  - consumer apps on phones
  - 'playful, youth audiences'
density: dense-but-airy   # tables and forms stay roomy
---

# Quiet Ledger

STYLE MARKER quiet-ledger: petrol #0E5A6B, Inter, 6 px radii.
`;

export const STYLE_FIELD = `---
id: field-bright
name: Field Bright
summary: >
  A sturdy high-visibility look
  for crews outdoors.
use_when: [field service, "dispatch, scheduling"]
avoid_when: []
density: balanced
---

# Field Bright

STYLE MARKER field-bright: safety yellow, big targets.
`;

export interface SkillTreeOptions { skill?: boolean; principles?: boolean; styles?: boolean | "readme-only"; readme?: string | null; recipes?: boolean }

/** Writes the tree under `root`/skill and answers its folder. */
export function writeSkillTree(root: string, o: SkillTreeOptions = {}): string {
  const dir = path.join(root, "skill");
  fs.mkdirSync(dir, { recursive: true });
  const put = (rel: string, text: string) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
  if (o.skill !== false) put("SKILL.md", `---\nname: figma-screen-design\n---\n\n# Planner UI/UX design\n\n${SKILL_MARKER}\n`);
  if (o.principles !== false) put("PRINCIPLES.md", `# House design principles\n\n${PRINCIPLES_MARKER}\n`);
  if (o.styles !== false) {
    fs.mkdirSync(path.join(dir, "styles"), { recursive: true });
    if (o.readme !== null) put("styles/README.md", o.readme ?? "# Style directions\n\nEach direction is one file.\n\nThe default direction is `quiet-ledger`, the closest general fit when nothing else fits.\n");
    if (o.styles !== "readme-only") { put("styles/quiet-ledger.md", STYLE_LEDGER); put("styles/field-bright.md", STYLE_FIELD); }
  }
  if (o.recipes !== false) {
    put("recipes/README.md", "# Screen recipes\n");
    put("recipes/app-shell.md", '---\nid: app-shell\nname: App shell\napplies_to: ["shell", "navigation", "all"]\n---\n\nRECIPE MARKER app-shell\n');
    put("recipes/list-pages.md", '---\nid: list-pages\nname: List and table pages\napplies_to: ["list", "table", "records"]\n---\n\nRECIPE MARKER list-pages\n');
    put("recipes/boards.md", "---\nid: boards\nname: Boards and calendars\napplies_to: [board, calendar, timeline]\n---\n\nRECIPE MARKER boards\n");
  }
  return dir;
}
