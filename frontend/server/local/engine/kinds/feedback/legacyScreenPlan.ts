// Planning helpers for feedback attached to historical screenshot records only. Product design uses Figma Make.
import type { Row } from "../../../../../functions/_lib/gateway";
import { num, str, strs } from "../../context.ts";
import type { JobRun } from "../../run.ts";
import { slugOf } from "../../text.ts";
import { includedFeatures } from "../scope/common.ts";
import type { AiDesign } from "../scope/designAi.ts";
import type { HtmlScreen } from "../scope/screenHtml.ts";
import { appLabel, brandOf, domainOf, emailOf, explicitBrandOf, onDevice, screenImage, type DesignInput, type ScreenPlan } from "../scope/screens.ts";

export function designInput(run: JobRun, brief: Row | undefined): DesignInput {
  const p = run.p;
  const mine = p.rows("DesignScreen").filter((s) => s.DesignBriefId === str(brief?.ItemId) && s.Status !== "superseded" && s.EngineJobId !== run.id);
  const latest = new Map<string, Row>();
  for (const s of mine) {
    const k = str(s.Key);
    if (!latest.has(k) || num(s.Version) > num(latest.get(k)!.Version)) latest.set(k, s);
  }
  return {
    projectName: p.name, client: p.client, clientContact: str(p.project.ClientContact), industry: p.industry, brief: p.brief,
    instructions: [str(brief?.Instructions), ...strs(brief?.References)].join(" "),
    features: includedFeatures(p, p.scopeVersion),
    requirements: p.requirements().filter((r) => r.Status !== "dropped")
      .map((r) => ({ key: str(r.Key), title: str(r.Title), text: str(r.Text), category: str(r.Category), criteria: strs(r.AcceptanceCriteria) })),
    existing: [...latest.values()].sort((a, b) => num(a.SortOrder) - num(b.SortOrder))
      .map((s) => ({ key: str(s.Key), name: str(s.Name), width: num(s.Width), height: num(s.Height), status: str(s.Status) })),
  };
}

interface Slot { key: string; name: string; device: "mobile" | "desktop"; spec: HtmlScreen }
const other = (d: "mobile" | "desktop"): "mobile" | "desktop" => d === "mobile" ? "desktop" : "mobile";

function builtIn(plan: ScreenPlan, plans: readonly ScreenPlan[], x: DesignInput, device: "mobile" | "desktop"): HtmlScreen {
  const here = onDevice(plan, device);
  const img = screenImage(here, plans.map((p) => onDevice(p, device)), x);
  const d = domainOf(`${x.projectName} ${x.brief} ${x.industry} ${x.features.map((f) => f.title).join(" ")}`);
  return {
    device, brand: img.brand, app: appLabel(x.client, x.projectName), title: plan.name, nav: img.nav, activeNav: img.activeNav,
    blocks: img.blocks.map((b) => b.k === "field" && b.label === "E-mail" ? { ...b, value: emailOf(x.clientContact, x.client) } : b),
    ...(here.kind === "signin" ? {} : { person: x.clientContact || d?.people[0] || "" }),
  };
}

function designed(ai: AiDesign, i: number, x: DesignInput, device: "mobile" | "desktop"): HtmlScreen {
  const s = ai.screens[i]!;
  const nav = ai.screens.map((t) => t.navLabel);
  return {
    device, brand: explicitBrandOf(x.instructions) ?? (ai.brand || brandOf(x.instructions, x.client, x.projectName)),
    app: ai.app || appLabel(x.client, x.projectName), title: s.name, ...(s.subtitle ? { subtitle: s.subtitle } : {}),
    nav: device === "mobile" ? nav.slice(0, 5) : nav, activeNav: i, ...(s.person ? { person: s.person } : {}),
    ...(s.search || device === "desktop" ? { search: s.search } : {}), blocks: s.blocks,
  };
}

export function slotsOf(x: DesignInput, plans: ScreenPlan[], ai: AiDesign | null): Slot[] {
  const byName = new Map((ai?.screens ?? []).map((s, i) => [s.name.toLowerCase(), i]));
  if (x.existing.length > 0) return plans.map((plan) => {
    const i = byName.get(plan.name.toLowerCase());
    return { key: plan.key, name: plan.name, device: plan.device, spec: ai && i !== undefined ? designed(ai, i, x, plan.device) : builtIn(plan, plans, x, plan.device) };
  });
  const out: Slot[] = [];
  if (ai) {
    const taken = new Set<string>();
    ai.screens.forEach((s, i) => {
      let key = slugOf(s.name, 40) || `screen-${i + 1}`;
      for (let n = 2; taken.has(key); n++) key = `${slugOf(s.name, 36)}-${n}`;
      taken.add(key);
      for (const device of [s.device, other(s.device)]) out.push({ key: device === s.device ? key : `${key}-${device}`, name: s.name, device, spec: designed(ai, i, x, device) });
    });
  } else for (const plan of plans) for (const device of [plan.device, other(plan.device)]) {
    out.push({ key: device === plan.device ? plan.key : `${plan.key}-${device}`, name: plan.name, device, spec: builtIn(plan, plans, x, device) });
  }
  return out;
}
