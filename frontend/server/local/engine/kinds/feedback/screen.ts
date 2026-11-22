// feedback.apply on a screen design: the designer redesigns the ONE screen a person commented on, following the comment
// and any picture attached to it, with the historical screenshot-feedback pipeline (designAi.ts acceptDesign +
// legacyScreenPlan.ts slotsOf + screenHtml.ts). Product design.generate is exclusively Figma Make. Both devices of the
// historical screen (they share its Name) get a new DesignScreen version (same Key,
// Version + 1); the older version is kept as "superseded", so people can compare. Every other screen stays as it is.
// The screen's last design (blocks) is read from the job folder of the job that made it (design.json), so Claude
// changes that screen instead of inventing a new one; without it, Claude still sees the current screenshot.
import fs from "node:fs";
import path from "node:path";
import type { Row } from "../../../../../functions/_lib/gateway";
import { num, str } from "../../context.ts";
import type { JobRun } from "../../run.ts";
import { aiJson, type AiImage } from "../../ai/index.ts";
import { S, text } from "../../ai/check.ts";
import { projectMaterial } from "../../ai/material.ts";
import { clip, sentence } from "../../text.ts";
import { acceptDesign, BLOCK_GUIDE, currencyRule, DESIGN_TASK, schemaBlocks, type AiDesign, type AiScreen } from "../scope/designAi.ts";
import { designInput, slotsOf } from "./legacyScreenPlan.ts";
import { screenRenderer, type HtmlBlock, type RenderedScreen } from "../scope/screenHtml.ts";
import { planScreens, type DesignInput } from "../scope/screens.ts";

const DESIGNER = "You are the product designer of the product team. A client commented on one screen design; you redesign that screen.";
const DESIGN_FILE = "design.json";

export interface Redesigned {
  /** "DesignScreen:<id>" and "StorageObject:<id>" of the new versions. */
  outputs: string[];
  /** The new version of the commented row (same Key), or "" when nothing was made. */
  newTargetId: string;
  version: number;
  /** What changed, in plain words (Claude's, else the built-in line). */
  summary: string;
  name: string;
}

/** The design a job wrote into its folder (design.generate, or an earlier redesign); null when there is none. */
function designOfJob(run: JobRun, jobId: string): AiDesign | null {
  if (!jobId) return null;
  const job = run.deps.store.get("EngineJob", jobId);
  const attempts = Math.max(1, num(job?.Attempts, 1));
  try {
    const folder = run.folder();
    for (let a = attempts; a >= 1; a--) {
      const file = path.join(folder.job(jobId, a), DESIGN_FILE);
      if (!fs.existsSync(file)) continue;
      const v = JSON.parse(fs.readFileSync(file, "utf8")) as { design?: AiDesign | null };
      if (v?.design && Array.isArray(v.design.screens)) return v.design;
    }
  } catch {
    /* no project folders (local mode, tests) */
  }
  return null;
}

const SCREEN_SCHEMA = (() => {
  const base = DESIGN_TASK.schema as { properties: Record<string, object>; required: string[] };
  return S.obj({
    summary: S.str("One or two plain sentences for the client: what you changed on this screen and why it follows the comment."),
    ...base.properties,
  });
})();

/** The redesign of one screen from Claude's answer (pure): the summary and the screen, or null. */
export function acceptRedesign(raw: unknown, o: { name: string; features: DesignInput["features"] }): { summary: string; design: AiDesign } | null {
  const design = acceptDesign(raw, { features: o.features, keep: [o.name] });
  const screen = design?.screens.find((s) => s.name === o.name);
  if (!design || !screen) return null;
  const summary = text((raw as Record<string, unknown>)?.summary, 400, 10);
  return { summary: summary ? sentence(summary) : "", design: { ...design, screens: [screen] } };
}

/** The screen now, in the fields Claude answers with (kind, title, text, value, items…), not the renderer's. */
function blocksLine(s: AiScreen): string {
  return JSON.stringify({ name: s.name, device: s.device, navLabel: s.navLabel, subtitle: s.subtitle, blocks: schemaBlocks(s.blocks) });
}

/** The designer's task for one screen (pure). */
export function redesignPrompt(o: { x: DesignInput; name: string; current: AiScreen | null; thread: string; comment: string; files: string; material: string }): string {
  return [
    `Redesign the "${o.name}" screen of ${o.x.projectName}, following the client's comment. Change what the comment asks for; keep everything else of the screen (its purpose, content, names, prices) as it is.`,
    "",
    `The client's comment: """${o.comment}"""`,
    o.thread ? `\nThe conversation so far:\n${o.thread}` : "",
    o.files ? `\n${o.files}` : "",
    "",
    "Rules:",
    `- Answer with exactly one screen named "${o.name}".`,
    "- The screen is drawn from the blocks below for desktop and for the phone; express the change with these blocks (a full-width banner is a hero block at the top, a stronger call to action is a button, and so on).",
    "- When the comment asks for an effect the blocks cannot draw (motion, parallax, animation), design the static look of it and say in the summary that the effect is part of the build.",
    "- Colours: only the hero banner has a colour of its own (its value, a hex code); when the comment asks for a colour of the banner or header, set it there; otherwise keep the hero's value as it is now. Every other block keeps the brand colour: never say in the summary that anything else changed colour.",
    "- Each block answers in the fields of the guide below, like the blocks of the screen now (a button's text is its title).",
    "- The picture of the current screen is shown above (and any picture the client attached): look at it closely.",
    currencyRule(o.x),
    "- Sentence case everywhere, never all capitals; short labels; no placeholder text.",
    "",
    o.current ? `The screen now (its blocks): ${blocksLine(o.current)}` : "The blocks of the screen now are not known: rebuild it from the picture.",
    "",
    `Look and feel: ${o.x.instructions.trim() || "calm, clear and modern."}`,
    "",
    BLOCK_GUIDE,
    "",
    `Material:\n${o.material}`,
  ].join("\n");
}

/** The built-in change when Claude is not there (pure): the comment's ask applied to the blocks the renderer knows. */
export function builtInChange(blocks: readonly HtmlBlock[], comment: string, screenName: string): { blocks: HtmlBlock[]; summary: string } {
  const t = comment.toLowerCase();
  const out = [...blocks];
  if (/\b(hero|banner|header|headline|above the fold|full[- ]width)\b/.test(t)) {
    const i = out.findIndex((b) => b.k === "hero");
    const hero: HtmlBlock = i >= 0 ? out[i]! : { k: "hero", title: screenName, text: clip(sentence(comment), 200) };
    if (i >= 0) out.splice(i, 1);
    out.unshift(hero);
    return { blocks: out.slice(0, 7), summary: `The screen now opens with a full-width banner across the top${/parallax|motion|animat|scroll/.test(t) ? "; the moving effect is part of the build" : ""}.` };
  }
  if (/\b(button|call to action|cta)\b/.test(t) && !out.some((b) => b.k === "button")) {
    out.push({ k: "button", text: "Get started" });
    return { blocks: out.slice(0, 7), summary: "The screen now ends with a clear button to get started." };
  }
  const note: HtmlBlock = { k: "note", text: clip(sentence(comment), 200) };
  return { blocks: [...out.slice(0, 6), note], summary: "I reworked the screen following your comment and noted your request on it for the build." };
}

/** Redesigns the screen of `target` (a DesignScreen row) and its other device; answers the new versions. */
export async function redesignScreen(run: JobRun, o: { target: Row; comment: string; thread: string; files: string; images: readonly AiImage[]; round: string }): Promise<Redesigned> {
  const p = run.p;
  const name = str(o.target.Name);
  const briefId = str(o.target.DesignBriefId);
  const brief = (briefId ? p.row("DesignBrief", briefId) : undefined) ?? p.designBrief();
  const full = designInput(run, brief);
  // Only this screen: its latest rows (one per device).
  const x: DesignInput = { ...full, existing: full.existing.filter((s) => s.name === name) };
  if (x.existing.length === 0) x.existing.push({ key: str(o.target.Key), name, width: num(o.target.Width), height: num(o.target.Height), status: str(o.target.Status) });
  const plans = planScreens(x);
  const before = designOfJob(run, str(o.target.EngineJobId));
  const current = before?.screens.find((s) => s.name.toLowerCase() === name.toLowerCase()) ?? null;

  // Claude sees the current screenshot and the attached pictures.
  const shot = str(o.target.ImageFileId) ? await run.readFile(str(o.target.ImageFileId)) : null;
  const images: AiImage[] = [...(shot ? [{ mimeType: "image/png", data: shot, label: `the "${name}" screen as it is now` }] : []), ...o.images].slice(0, 5);
  const m = await projectMaterial(run, { budget: 2000, contextBudget: 1200 });
  const ai = await aiJson(run, {
    task: `redesign screen ${o.round}`,
    role: DESIGNER,
    prompt: redesignPrompt({ x, name, current, thread: o.thread, comment: o.comment, files: o.files, material: m.text }),
    schema: SCREEN_SCHEMA,
    timeoutMs: 150_000,
    images,
    accept: (raw) => acceptRedesign(raw, { name, features: x.features }),
  });
  await run.step(55, `Drawing the new version of the ${name} screen.`);

  // The whole design with this screen replaced, so the menu and the look stay those of the other screens.
  let design: AiDesign | null = null;
  let summary = "";
  if (ai) {
    const mine = ai.design.screens[0]!;
    design = before
      ? { ...before, screens: before.screens.some((s) => s.name === mine.name) ? before.screens.map((s) => (s.name === mine.name ? mine : s)) : [...before.screens, mine] }
      : ai.design;
    summary = ai.summary;
  } else {
    const base: AiScreen | null = current;
    if (base && before) {
      const changed = builtInChange(base.blocks, o.comment, name);
      design = { ...before, screens: before.screens.map((s) => (s === base ? { ...s, blocks: changed.blocks } : s)) };
      summary = changed.summary;
    }
  }
  const slots = slotsOf(x, plans, design);
  if (!design) {
    // the built-in screen of screens.ts, with the comment's change
    let line = "";
    for (const s of slots) {
      const changed = builtInChange(s.spec.blocks, o.comment, name);
      s.spec = { ...s.spec, blocks: changed.blocks };
      line = changed.summary;
    }
    summary = line;
  }
  run.writeJobFile(DESIGN_FILE, { design });

  const rowsOf = (key: string) => p.rows("DesignScreen").filter((s) => s.Key === key);
  const renderer = screenRenderer({ log: (l) => run.log(l) });
  const images2 = new Map<string, RenderedScreen>();
  try {
    for (const s of slots) {
      if (rowsOf(s.key).some((r) => r.RequestKey === run.key(`${o.round}-screen-${s.key}`))) continue;
      run.check();
      images2.set(s.key, await renderer.render(s.spec));
    }
  } finally {
    await renderer.close();
  }
  await run.step(80, `Saving version ${Math.max(...slots.map((s) => rowsOf(s.key).reduce((v, r) => Math.max(v, num(r.Version)), 0))) + 1} of the ${name} screen.`);

  const outputs: string[] = [];
  let newTargetId = "";
  let version = 0;
  for (const s of slots) {
    const all = rowsOf(s.key);
    const own = all.find((r) => r.RequestKey === run.key(`${o.round}-screen-${s.key}`));
    let id = own ? str(own.ItemId) : "";
    let fileId = own ? str(own.ImageFileId) : "";
    const prev = all.filter((r) => r !== own).sort((a, b) => num(b.Version) - num(a.Version))[0];
    const v = own ? num(own.Version) : all.reduce((mx, r) => Math.max(mx, num(r.Version)), 0) + 1;
    if (!own) {
      const img = images2.get(s.key)!;
      fileId = await run.putFile(`${s.key}-v${v}.png`, "image/png", img.png);
      id = await run.insert(
        "DesignScreen",
        {
          DesignBriefId: str(prev?.DesignBriefId) || str(brief?.ItemId),
          EngineJobId: run.id,
          Key: s.key,
          Name: s.name,
          Version: v,
          SortOrder: num(prev?.SortOrder),
          ImageFileId: fileId,
          Width: img.width,
          Height: img.height,
          Status: "generated",
        },
        `${o.round}-screen-${s.key}`,
      );
    }
    outputs.push(`DesignScreen:${id}`, `StorageObject:${fileId}`);
    // the older versions stay, marked superseded (people compare them with the new one)
    for (const r of all) if (str(r.ItemId) !== id && r.Status !== "superseded") await run.update("DesignScreen", str(r.ItemId), { Status: "superseded" });
    if (s.key === str(o.target.Key)) {
      newTargetId = id;
      version = v;
    }
  }
  return { outputs, newTargetId, version, summary: summary || "I reworked the screen following your comment.", name };
}
