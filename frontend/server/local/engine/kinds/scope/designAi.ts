// Claude-designed screens for design.generate (see ../../ai/index.ts): the product designer names the screens of THIS
// product, says which feature each serves and on which device it is used most, and fills each with real content blocks
// (the assets, people, prices and states of the product). The writer renders each screen for desktop and for the phone
// (screenHtml.ts). acceptDesign is pure and exported for the tests: it keeps only the blocks the renderer knows, in
// their limits, and answers null when fewer than three screens are usable (the writer keeps its built-in screens).
import type { JobRun } from "../../run.ts";
import { aiJson } from "../../ai/index.ts";
import { S, arr, obj, oneOf, text } from "../../ai/check.ts";
import { projectMaterial } from "../../ai/material.ts";
import type { FeatureInfo } from "./common.ts";
import { scopeList, untag } from "./ai.ts";
import type { HtmlBlock } from "./screenHtml.ts";
import { explicitBrandOf, type DesignInput } from "./screens.ts";
import { currencyOfCode } from "../../../../engine-context/currency.ts";
import { factsRules } from "../../../../engine-context/facts.ts";

const DESIGNER = "You are the product designer of the product team.";

export const BLOCK_KINDS = ["hero", "heading", "filters", "grid", "rows", "card", "stats", "table", "steps", "form", "upload", "preview", "summary", "chart", "note", "button"] as const;
type Kind = (typeof BLOCK_KINDS)[number];

export interface AiScreen {
  name: string;
  /** the feature it serves (its ref), when the tag named one */
  featureRef: string;
  device: "desktop" | "mobile";
  navLabel: string;
  subtitle: string;
  person: string;
  search: string;
  blocks: HtmlBlock[];
}

export interface AiDesign {
  app: string;
  /** hex without "#", or "" */
  brand: string;
  screens: AiScreen[];
}

/** No shouting: a label in capitals only ("NEW ARRIVALS") becomes sentence case; short codes ("PNG, SVG") stay. */
export function calm(s: string): string {
  const words = s.match(/\p{L}+/gu) ?? [];
  if (!/\p{Ll}/u.test(s) && words.some((w) => w.length >= 4 && w !== w.toLowerCase())) {
    const t = s.toLowerCase();
    return t.replace(/\p{L}/u, (c) => c.toUpperCase());
  }
  return s;
}

const tagOf = (s: unknown): string => String(s ?? "").replace(/[[\]\s]/g, "").toUpperCase();

/** A button's style word ("primary", "secondary"…): never its text. QUIET: the styles of a second, quieter button. */
const STYLE_WORD = /^(primary|secondary|tertiary|default|main|filled|solid|outline|outlined|ghost|quiet|subtle|plain|link|cta)$/i;
const QUIET = /^(secondary|tertiary|outline|outlined|ghost|quiet|subtle|plain|link)$/i;

/** A hero banner's own colour as Claude gives it (pure): a hex code ("#0b2a5b", "#0af") or a plain colour name ("navy",
 *  "dark blue"), as hex without "#"; null for anything else (the banner then takes the brand colour). */
export function heroColour(v: unknown): string | null {
  const s = String(v ?? "").trim().toLowerCase();
  const hex = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/.exec(s)?.[1];
  if (hex) return hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex;
  return /^(?:(?:dark|deep|light|bright|pale)\s+)?[a-z]+$/.test(s) ? explicitBrandOf(s) : null;
}

function block(raw: unknown, features: readonly FeatureInfo[]): HtmlBlock | null {
  const b = obj(raw);
  if (!b) return null;
  const kind = oneOf(b.kind, BLOCK_KINDS) as Kind | null;
  if (!kind) return null;
  const t = (v: unknown, max: number, min = 1): string | null => {
    const x = text(v, max, min);
    return x ? calm(untag(x, features)) : null;
  };
  const title = t(b.title, 80);
  const body = t(b.text, 220);
  const value = t(b.value, 40);
  const items = arr(b.items).flatMap((i) => {
    const o = obj(i);
    const label = o ? t(o.label, 60) : null;
    return o && label ? [{ label, value: t(o.value, 40) ?? "", detail: t(o.detail, 70) ?? "" }] : [];
  }).slice(0, 8);
  switch (kind) {
    case "hero": {
      const colour = heroColour(b.value);
      return title ? { k: "hero", title, ...(body ? { text: body } : {}), ...(colour ? { colour } : {}) } : null;
    }
    case "heading":
      return title ? { k: "heading", text: title } : null;
    case "filters": {
      const chips = items.map((i) => i.label).slice(0, 7);
      if (chips.length < 2) return null;
      const on = items.findIndex((i) => /^(on|active|selected|yes|true)$/i.test(i.value));
      return { k: "filters", items: chips, active: on < 0 ? 0 : on, ...(value ? { sort: value } : {}) };
    }
    case "grid": {
      const cards = items.filter((i) => i.value).map((i) => {
        const [creator, rating] = i.detail.split(/\s*[·|]\s*/);
        const r = /\d(?:[.,]\d)?/.exec(rating ?? "")?.[0];
        return { title: i.label, price: i.value, creator: creator ?? "", ...(r ? { rating: r.replace(",", ".") } : {}) };
      });
      return cards.length >= 2 ? { k: "grid", items: cards } : null;
    }
    case "rows":
      return items.length >= 2 ? { k: "rows", ...(title ? { title } : {}), items: items.map((i) => ({ label: i.label, value: i.value, ...(i.detail ? { detail: i.detail } : {}) })) } : null;
    case "card": {
      const lines = [body, ...items.map((i) => (i.value ? `${i.label}: ${i.value}` : i.label))].filter((x): x is string => Boolean(x)).slice(0, 3);
      return title ? { k: "card", title, lines, ...(value ? { badge: value } : {}) } : null;
    }
    case "stats": {
      const tiles = items.filter((i) => i.value).slice(0, 4).map((i): [string, string] => [i.label, i.detail ? `${i.value} | ${i.detail}` : i.value]);
      return tiles.length >= 2 ? { k: "stats", items: tiles } : null;
    }
    case "table": {
      const head = arr(b.columns).map((c) => t(c, 24)).filter((c): c is string => Boolean(c)).slice(0, 6);
      if (head.length < 2) return null;
      const rows = arr(b.rows).flatMap((r) => {
        const cells = arr(r).map((c) => t(c, 40) ?? "").slice(0, head.length);
        return cells.filter(Boolean).length >= 2 ? [[...cells, ...Array(head.length - cells.length).fill("")]] : [];
      }).slice(0, 7);
      return rows.length >= 2 ? { k: "table", head, rows } : null;
    }
    case "steps": {
      const labels = items.map((i) => i.label).slice(0, 5);
      if (labels.length < 3) return null;
      const now = items.findIndex((i) => /^(current|now|active)$/i.test(i.value));
      const done = items.filter((i) => /^(done|complete|completed|yes)$/i.test(i.value)).length;
      return { k: "steps", items: labels, active: now >= 0 ? now : Math.min(labels.length - 1, done) };
    }
    case "form": {
      const fields = items.map((i): [string, string] => [i.label, i.value || i.detail]).slice(0, 6);
      return fields.length >= 2 ? { k: "form", ...(title ? { title } : {}), fields } : null;
    }
    case "upload":
      return title ? { k: "upload", title, ...(body ? { text: body } : {}) } : null;
    case "preview": {
      const meta = items.map((i) => (i.value ? `${i.label}: ${i.value}` : i.label)).slice(0, 4);
      return title ? { k: "preview", title, ...(body ? { text: body } : {}), ...(meta.length ? { meta } : {}) } : null;
    }
    case "summary": {
      const lines = items.filter((i) => i.value).map((i): [string, string] => [i.label, i.value]);
      if (lines.length < 2) return null;
      const last = lines[lines.length - 1]!;
      const total = /total|due|to pay|you get|you receive|you earn|payout|balance/i.test(last[0]) ? lines.pop() : undefined;
      return { k: "summary", title: title ?? "Summary", lines, ...(total ? { total } : {}) };
    }
    case "chart": {
      const points = items.map((i) => ({ label: i.label, n: Number(String(i.value).replace(/[^\d.]/g, "")) })).filter((p) => String(p.n) !== "NaN" && p.n >= 0).slice(0, 12);
      return points.length >= 4 && points.some((p) => p.n > 0) ? { k: "bars", ...(title ? { title } : {}), values: points.map((p) => p.n), labels: points.map((p) => p.label.slice(0, 10)) } : null;
    }
    case "note":
      return body || title ? { k: "note", text: (body ?? title)! } : null;
    case "button": {
      // the text is the title; Claude sometimes answers it in text (or value) with a style word beside it
      const label = [title, body, value].find((l): l is string => Boolean(l) && l!.length <= 32 && !STYLE_WORD.test(l!));
      const quiet = [b.value, b.title, b.text].some((v) => QUIET.test(String(v ?? "").trim()));
      return label ? { k: "button", text: label, ...(quiet ? { secondary: true } : {}) } : null;
    }
  }
}

/** Claude's screens mapped onto what the renderer draws (pure); null when fewer than three are usable. `keep`: the
 *  names of a re-generation (only those screens are kept, matched by name). */
export function acceptDesign(raw: unknown, o: { features: readonly FeatureInfo[]; keep?: readonly string[] }): AiDesign | null {
  const r = obj(raw);
  if (!r) return null;
  const byTag = new Map(o.features.map((f, i) => [`F${i + 1}`, f]));
  const keep = new Map((o.keep ?? []).map((n) => [n.toLowerCase(), n]));
  const names = new Set<string>();
  const screens: AiScreen[] = [];
  for (const s of arr(r.screens)) {
    const x = obj(s);
    let name = x ? text(x.name, 40, 3) : null;
    if (!x || !name) continue;
    name = calm(untag(name, o.features)).replace(/[.:]$/, "");
    if (keep.size) {
      const k = keep.get(name.toLowerCase());
      if (!k) continue;
      name = k;
    }
    if (names.has(name.toLowerCase())) continue;
    const blocks = arr(x.blocks).map((b) => block(b, o.features)).filter((b): b is HtmlBlock => b !== null).slice(0, 7);
    // a screen is more than a title and a button
    if (blocks.filter((b) => b.k !== "button" && b.k !== "heading" && b.k !== "note").length < 2) continue;
    names.add(name.toLowerCase());
    const f = byTag.get(tagOf(x.feature)) ?? byTag.get(tagOf(x.feature).split(".")[0]!);
    const nav = text(x.navLabel, 16, 2);
    screens.push({
      name,
      featureRef: f?.ref ?? "",
      device: oneOf(x.device, ["desktop", "mobile"] as const) ?? "desktop",
      navLabel: calm(nav ?? name.split(/\s+/).slice(0, 2).join(" ")),
      subtitle: calm(text(x.subtitle, 110, 3) ?? ""),
      person: text(x.signedIn, 40, 3) ?? "",
      search: text(x.search, 40, 2) ?? "",
      blocks,
    });
    if (screens.length >= 6) break;
  }
  const need = keep.size ? Math.min(3, keep.size) : 3;
  if (screens.length < need) return null;
  const hex = /#?([0-9a-f]{6})\b/i.exec(String(r.brandColour ?? ""))?.[1]?.toLowerCase() ?? "";
  const app = text(r.appName, 28, 2);
  return { app: app ? calm(app) : "", brand: hex, screens };
}

const item = S.obj({
  label: S.str(),
  value: S.str(),
  detail: S.str(),
});

const DESIGN_SCHEMA = S.obj({
  appName: S.str("The product's name as its header shows it, at most 24 characters."),
  brandColour: S.str("The main colour as a hex code (#2f5bea), matching the look and feel."),
  screens: S.list(S.obj({
    name: S.str("Screen name in Title Case, at most 32 characters."),
    feature: S.str('Tag of the feature it serves ("F2"), or "".'),
    device: S.enum(["desktop", "mobile"], "Where people use this screen most."),
    navLabel: S.str("One or two words for the app's menu, at most 14 characters."),
    subtitle: S.str("One short line under the screen title."),
    signedIn: S.str("Full name of the person signed in on this screen, or \"\" on a sign-in screen."),
    search: S.str("What is typed in the search field, or \"\"."),
    blocks: S.list(S.obj({
      kind: S.enum(BLOCK_KINDS),
      title: S.str(),
      text: S.str(),
      value: S.str(),
      items: S.list(item, 8),
      columns: S.list(S.str(), 6),
      rows: S.list(S.list(S.str(), 6), 7),
    }), 7),
  }), 6),
});

export const BLOCK_GUIDE = [
  "Blocks (fill only the fields a kind uses; leave the others \"\" or []):",
  "- hero: title + text (a welcome or promotion banner); value = the banner's own colour as a hex code (\"#0b2a5b\"), only when the client asks for a colour for it, else \"\" (it takes the brand colour).",
  "- heading: title (a section heading).",
  "- filters: items = the filter chips (label); value \"on\" on the selected chip; block value = the sort order (\"Most popular\").",
  "- grid: items = products or assets on sale: label = name, value = price with currency, detail = \"<creator name> · <rating 4.8>\"; 4 to 8 items.",
  "- rows: title + items = a list: label, value (amount, count or status), detail (a second line).",
  "- card: title, text, value = a short status badge, items = up to two facts (label, value).",
  "- stats: items = 2 to 4 figures: label, value (an amount, count or share, \"4,820.00\" in the project's currency), detail = the change (\"+12% this month\").",
  "- table: columns (3 to 6 headers) + rows (4 to 7 rows of cells); a status cell holds a plain status word (Paid, In review, Rejected…).",
  "- steps: items = 3 to 5 stages; value \"done\" on finished ones, \"current\" on the one in progress.",
  "- form: title + items = the fields: label, value = what the person has typed.",
  "- upload: title + text (a drop zone for files).",
  "- preview: title + text = the large preview of one asset; items = its facts (label, value: file types, size, licence).",
  "- summary: title + items = order or payout lines (label, value); the last item is the total.",
  "- chart: items = 6 to 12 values (label = period, value = a number).",
  "- note: text (one short helpful line).",
  "- button: title = the button text; value \"secondary\" for a second, quieter button.",
].join("\n");

/** A screen's blocks written back in the fields Claude answers with (DESIGN_SCHEMA, BLOCK_GUIDE): the inverse of
 *  block(), so a redesign shows Claude the screen as it is now in the same fields it answers in (pure). Only the fields
 *  a kind uses; a map (no block draws one for Claude) is left out. */
export function schemaBlocks(list: readonly HtmlBlock[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const it = (label: string, value = "", detail = "") => ({ label, ...(value ? { value } : {}), ...(detail ? { detail } : {}) });
  const fact = (l: string) => {
    const m = /^(.+?):\s+(.+)$/.exec(l);
    return m ? it(m[1]!, m[2]!) : it(l);
  };
  let fields: { label: string }[] | null = null; // a run of sign-in fields is one form
  for (const b of list) {
    if (b.k !== "field") fields = null;
    switch (b.k) {
      case "hero": out.push({ kind: "hero", title: b.title, ...(b.text ? { text: b.text } : {}), ...(b.colour ? { value: `#${b.colour}` } : {}) }); break;
      case "heading": out.push({ kind: "heading", title: b.text }); break;
      case "filters": out.push({ kind: "filters", items: b.items.map((c, i) => it(c, i === b.active ? "on" : "")), ...(b.sort ? { value: b.sort } : {}) }); break;
      case "grid": out.push({ kind: "grid", items: b.items.map((g) => it(g.title, g.price, g.rating ? `${g.creator} · ${g.rating}` : g.creator)) }); break;
      case "rows": out.push({ kind: "rows", ...(b.title ? { title: b.title } : {}), items: b.items.map((r) => it(r.label, r.value, r.detail)) }); break;
      case "list": out.push({ kind: "rows", items: b.items.map(([l, v]) => it(l, v)) }); break;
      case "card": {
        const [first, ...more] = b.lines ?? [];
        out.push({ kind: "card", title: b.title, ...(first ? { text: first } : {}), ...(b.badge ? { value: b.badge } : {}), ...(more.length ? { items: more.map(fact) } : {}) });
        break;
      }
      case "stats": out.push({ kind: "stats", items: b.items.map(([l, v]) => { const [value, detail] = v.split(/\s*\|\s*/); return it(l, value ?? "", detail ?? ""); }) }); break;
      case "table": out.push({ kind: "table", columns: b.head, rows: b.rows }); break;
      case "steps": out.push({ kind: "steps", items: b.items.map((x, i) => it(x, i < b.active ? "done" : i === b.active ? "current" : "")) }); break;
      case "form": out.push({ kind: "form", ...(b.title ? { title: b.title } : {}), items: b.fields.map(([l, v]) => it(l, v)) }); break;
      case "field":
        if (fields) fields.push(it(b.label, b.value ?? ""));
        else out.push({ kind: "form", items: (fields = [it(b.label, b.value ?? "")]) });
        break;
      case "upload": out.push({ kind: "upload", title: b.title, ...(b.text ? { text: b.text } : {}) }); break;
      case "preview": out.push({ kind: "preview", title: b.title, ...(b.text ? { text: b.text } : {}), ...(b.meta?.length ? { items: b.meta.map(fact) } : {}) }); break;
      case "summary": out.push({ kind: "summary", title: b.title, items: [...b.lines, ...(b.total ? [b.total] : [])].map(([l, v]) => it(l, v)) }); break;
      case "bars": out.push({ kind: "chart", ...(b.title ? { title: b.title } : {}), items: b.values.map((n, i) => it(b.labels[i] || String(i + 1), String(n))) }); break;
      case "chart": out.push({ kind: "chart", items: b.values.map((n, i) => it(String(i + 1), String(n))) }); break;
      case "note": out.push({ kind: "note", text: b.text }); break;
      case "button": out.push({ kind: "button", title: b.text, ...(b.secondary ? { value: "secondary" } : {}) }); break;
      case "map": break;
    }
  }
  return out;
}

/** Money in the project's own currency (the material's), never a home-region default; with the project's other facts
 *  (tax rate, payout day, country: engine-context/facts.ts), the same ones the build uses. */
export function currencyRule(x: Pick<DesignInput, "currency" | "facts">): string {
  const c = x.currency ? currencyOfCode(x.currency) : null;
  const money = c
    ? `- Every price, fee, payout and amount is in ${c.code}, the currency the material uses, written like "${c.format(24)}" and "${c.format(4820)}"; no other currency anywhere.`
    : '- The material names no currency: write amounts as plain numbers ("24.00", "4,820.00") without a currency sign or code.';
  if (!x.facts) return money;
  // the currency line stays as it is; the tax, payout and country lines come from the shared facts
  return [money, ...factsRules({ ...x.facts, currency: x.currency || x.facts.currency }).slice(1)].join("\n");
}

/** The names a re-generation keeps (the screens not yet accepted). */
export const keptNames = (x: DesignInput): string[] => [...new Set(x.existing.filter((s) => s.status !== "accepted").map((s) => s.name))];

/** The designer's task (pure): the rules, the blocks, the look and feel, the scope and the project's material. */
export function designPrompt(x: DesignInput, material: string): string {
  const keep = keptNames(x);
  const features = x.features.length
    ? `Features in scope:\n${scopeList(x.features).split("\n").filter((l) => !/Checks:/.test(l) || l.length < 260).join("\n")}`
    : `Requirements (the scope has no features yet):\n${x.requirements.slice(0, 14).map((r) => `- ${r.title}${r.text ? `: ${r.text.slice(0, 160)}` : ""}`).join("\n")}`;
  return [
    `Design the key screens of ${x.projectName}: what each screen shows, filled with the content a real person would see on a normal working day.`,
    "",
    "Rules:",
    keep.length
      ? `- These screens exist already and are designed again, keep exactly these names: ${keep.map((n) => `"${n}"`).join(", ")}.`
      : "- Four or five screens of the main flows, in the order people meet them (for a marketplace: finding and browsing what is on sale, one item in detail, buying it, the seller's upload and the seller's sales or payouts, the review of new items by the team). Pick what the features say; no sign-in screen.",
    "- Each screen: three to six blocks that fit the screen's purpose; the blocks are laid out for desktop and for the phone automatically.",
    "- Real, specific content: product and asset names, creators and customers with believable full names, prices, dates, counts and statuses that agree with each other across the screens.",
    currencyRule(x),
    "- The client's answers and decisions in the material override the notes and files: every screen shows what the answers say (for example the words of the main button), never a document's other version.",
    "- Sentence case everywhere, never all capitals; short labels; no placeholder text.",
    "- The look and feel the client confirmed decides the colour and the tone.",
    "",
    BLOCK_GUIDE,
    "",
    `Look and feel: ${x.instructions.trim() || "not described yet: calm, clear and modern."}`,
    "",
    features,
    "",
    `Material:\n${material}`,
  ].join("\n");
}

export const DESIGN_TASK = { role: DESIGNER, schema: DESIGN_SCHEMA };

export async function aiDesign(run: JobRun, x: DesignInput): Promise<AiDesign | null> {
  const m = await projectMaterial(run, { budget: 2500, contextBudget: 1200 });
  const keep = keptNames(x);
  return aiJson(run, {
    task: "design screens",
    role: DESIGNER,
    prompt: designPrompt(x, m.text),
    schema: DESIGN_SCHEMA,
    timeoutMs: 120_000,
    accept: (raw) => acceptDesign(raw, { features: x.features, keep }),
  });
}
