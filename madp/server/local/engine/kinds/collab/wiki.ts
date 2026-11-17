// The wiki MADP writes from a project's records (WikiPage, Origin factory): overview, guides per role, one page per
// feature, business rules, architecture, the decision log and the release notes (or the milestone previews before the
// first release). An update keeps what is there and adds what is new (versions, changes, decisions). Pure.
import type { Row } from "../../../../../functions/_lib/gateway";
import { SLUG_PATTERN, parseSources, type WikiGroup } from "../../../../../src/domain/wiki";
import { str } from "../../context.ts";
import { cap, clip, lower, slugOf } from "../../text.ts";
import { compareVersions, productVersion, type CollabFacts, type FeatureFact, type StoryFact } from "./facts.ts";
import { pluralActor, storyAction } from "./words.ts";

export type PageKind = "overview" | "guide" | "feature" | "rules" | "architecture" | "decisions" | "releases" | "previews";

export interface PlannedPage {
  kind: PageKind;
  slug: string;
  group: WikiGroup;
  title: string;
  body: string;
  order: number | null;
  sources: { label: string; ref: string }[];
}

const ENV_LABEL: Record<string, string> = { dev: "dev", stage: "stage", production: "production" };
const day = (iso: string): string => iso.slice(0, 10);

function featureStatus(f: CollabFacts, feat: FeatureFact): string {
  const m = feat.milestone;
  const firstRelease = [...f.releases].sort((a, b) => compareVersions(a.version, b.version))[0];
  if (firstRelease && m && (m.status === "done" || m.status === "preview-ready" || f.stage === "release")) {
    const envs = [...new Set(f.releases.map((r) => r.env))].map((e) => ENV_LABEL[e] ?? e);
    return `Released with v${firstRelease.version} (now on ${envs.join(", ")}), from milestone ${m.number} “${m.name}”.`;
  }
  if (!m) return "Not assigned to a milestone yet.";
  if (m.status === "preview-ready" || m.status === "done") {
    const pv = f.previews.find((p) => p.MilestoneId === m.id && p.Status === "ready");
    return `Built in milestone ${m.number} “${m.name}”${pv ? `; preview ${str(pv.Version)} is ready` : ""}.`;
  }
  if (m.status === "building") return `Being built now in milestone ${m.number} “${m.name}”.`;
  return `Planned for milestone ${m.number} “${m.name}”.`;
}

function changesOf(f: CollabFacts, feat: FeatureFact): string[] {
  return f.changes
    .filter((c) => c.featureRef === feat.ref && c.status !== "draft")
    .map((c) => `- ${c.code} ${c.title}${c.version ? ` (v${c.version}, ${c.status === "building" ? "building" : c.status.replace("released-", "on ").replace("promoted-", "on ")})` : ""}`);
}

function overview(f: CollabFacts): PlannedPage {
  const statement = str(f.objective?.Statement) || f.brief || `${f.name} for ${f.client}.`;
  const actors = new Map<string, string[]>();
  for (const feat of f.features) for (const s of feat.stories) if (s.actor) actors.set(s.actor, [...new Set([...(actors.get(s.actor) ?? []), feat.title])]);
  const lines = [`# ${f.name}`, "", statement.trim()];
  if (actors.size) {
    lines.push("", "## Who uses it", "");
    for (const [a, feats] of actors) lines.push(`- **${pluralActor(a)}**: ${feats.map(lower).join(", ")}`);
  }
  if (f.features.length) {
    lines.push("", "## What it does", "");
    for (const feat of f.features) lines.push(`- **${feat.title}**${feat.description ? `: ${lower(feat.description.replace(/[.]+$/, ""))}` : ""}`);
  }
  const envs = ["production", "stage", "dev"].map((e) => [...f.releases.filter((r) => r.env === e)].sort((a, b) => compareVersions(b.version, a.version))[0]).filter(Boolean);
  if (envs.length) {
    lines.push("", "## Where it runs", "", "| Environment | Version | Released |", "| --- | --- | --- |");
    for (const r of envs) lines.push(`| ${cap(ENV_LABEL[r!.env] ?? r!.env)} | ${r!.version} | ${day(r!.releasedAt)} |`);
  }
  if (f.client) lines.push("", `Built for ${f.client}.`);
  const sources = [
    ...(f.objective ? [{ label: "Objective", ref: `brief:${str(f.objective.ItemId)}` }] : []),
    ...f.requirements.filter((r) => r.Priority === "must").slice(0, 2).map((r) => ({ label: str(r.Title), ref: `requirement:${str(r.ItemId)}` })),
  ];
  return { kind: "overview", slug: slugOf(f.name, 60), group: "overview", title: f.name, body: lines.join("\n"), order: 1, sources };
}

function guides(f: CollabFacts): PlannedPage[] {
  const byActor = new Map<string, { feat: FeatureFact; story: StoryFact }[]>();
  for (const feat of f.features) for (const s of feat.stories) if (s.actor) byActor.set(s.actor, [...(byActor.get(s.actor) ?? []), { feat, story: s }]);
  const out: PlannedPage[] = [];
  let order = 1;
  for (const [actor, items] of byActor) {
    if (items.length < 2) continue;
    const who = pluralActor(actor);
    const lines = [`# Guide for ${lower(who)}`, "", `What ${lower(who)} do in ${f.name}, feature by feature.`];
    const feats = [...new Set(items.map((i) => i.feat))];
    for (const feat of feats) {
      lines.push("", `## ${feat.title}`, "");
      items.filter((i) => i.feat === feat).forEach((i, n) => lines.push(`${n + 1}. **${i.story.title.replace(/[.]+$/, "")}**: ${lower(storyAction(i.story, "you"))}.`));
      const tip = items.find((i) => i.feat === feat && i.story.criteria.length)?.story.criteria[0];
      if (tip) lines.push("", `> Note: ${cap(tip.replace(/[.]+$/, ""))}.`);
    }
    out.push({
      kind: "guide",
      slug: `guide-${slugOf(actor, 40)}`,
      group: "guide",
      title: `Guide for ${lower(who)}`,
      body: lines.join("\n"),
      order: order++,
      sources: feats.slice(0, 6).map((x) => ({ label: x.title, ref: `feature:${x.id}` })),
    });
  }
  return out;
}

function featurePages(f: CollabFacts): PlannedPage[] {
  return f.features.map((feat, i) => {
    const lines = [`# ${feat.title}`, ""];
    if (feat.description) lines.push(feat.description.trim(), "");
    if (feat.stories.length) {
      lines.push("## What it covers", "");
      for (const s of feat.stories) lines.push(`- **${s.title.replace(/[.]+$/, "")}**: ${lower(storyAction(s, "they"))}.`);
      const criteria = [...new Set(feat.stories.flatMap((s) => s.criteria))].slice(0, 12);
      if (criteria.length) {
        lines.push("", "## Acceptance criteria", "");
        for (const c of criteria) lines.push(`- ${cap(c.replace(/[.]+$/, ""))}`);
      }
      lines.push("");
    }
    lines.push("## Status", "", featureStatus(f, feat));
    const changes = changesOf(f, feat);
    if (changes.length) lines.push("", "## Changes", "", ...changes);
    const reqs = f.requirements.filter((r) => feat.requirementKeys.includes(str(r.Key)));
    const sources = [
      { label: feat.title, ref: `feature:${feat.id}` },
      ...reqs.slice(0, 3).map((r) => ({ label: str(r.Title), ref: `requirement:${str(r.ItemId)}` })),
      ...f.changes.filter((c) => c.featureRef === feat.ref && c.status !== "draft").map((c) => ({ label: `${c.code} ${c.title}`, ref: `${c.lane === "fix" ? "fix" : "change"}:${c.id}` })),
    ].slice(0, 20);
    return { kind: "feature" as const, slug: slugOf(feat.key, 80), group: "features" as const, title: feat.title, body: lines.join("\n"), order: i + 1, sources };
  });
}

function rules(f: CollabFacts): PlannedPage | null {
  const answered = f.clarifications.filter((c) => c.Status === "answered" && str(c.Answer).trim());
  if (answered.length < 2) return null;
  const cell = (s: string) => clip(s.replace(/\|/g, "/").replace(/\s+/g, " ").trim(), 220);
  const lines = [
    "# Business rules",
    "",
    `The questions settled while understanding the project, as ${f.name} applies them.`,
    "",
    "| Question | Rule |",
    "| --- | --- |",
    ...answered.slice(0, 25).map((c) => `| ${cell(str(c.Question))} | ${cell(str(c.Answer))} |`),
  ];
  const linked = f.decisions.filter((d) => answered.some((c) => c.ItemId === d.ClarificationId));
  return {
    kind: "rules",
    slug: "business-rules",
    group: "logic",
    title: "Business rules",
    body: lines.join("\n"),
    order: null,
    sources: linked.slice(0, 10).map((d) => ({ label: str(d.Title), ref: `decision:${str(d.ItemId)}` })),
  };
}

function architecture(f: CollabFacts): PlannedPage | null {
  const arch = str(f.objective?.ArchitectureMd).trim();
  const tech = f.techDecisions.filter((t) => t.Status !== "rejected");
  if (!arch && tech.length === 0) return null;
  const lines = ["# Architecture", ""];
  if (arch) {
    const body = arch
      .split(/\r?\n/)
      .filter((l) => !/^#\s/.test(l))
      .map((l) => (/^##?#?\s/.test(l) ? l.replace(/^#+\s/, "## ") : l))
      .join("\n")
      .trim();
    lines.push(body, "");
  }
  if (tech.length) {
    lines.push("## Technical decisions", "");
    for (const t of tech) lines.push(`- **${str(t.Title)}** (${str(t.Area) || "other"}): ${lower(str(t.Choice).replace(/[.]+$/, ""))}${str(t.Status) === "proposed" ? " (proposed)" : ""}.`);
    lines.push("");
  }
  if (f.repo.name) {
    lines.push("## Repository", "", `- \`${f.repo.owner ? `${f.repo.owner}/` : ""}${f.repo.name}\`, branch \`${f.repo.branch}\`${f.existing ? " (the existing product)" : ""}`);
  }
  return {
    kind: "architecture",
    slug: "architecture",
    group: "technical",
    title: "Architecture",
    body: lines.join("\n").trim(),
    order: null,
    sources: tech.slice(0, 10).map((t) => ({ label: str(t.Title), ref: `decision:${str(t.ItemId)}` })),
  };
}

function decisionItems(f: CollabFacts): { title: string; line: string; ref: string }[] {
  const out = f.decisions.map((d) => ({
    title: str(d.Title),
    line: `**${str(d.Title)}** - ${lower(str(d.Statement).replace(/[.]+$/, ""))}${str(d.Rationale) ? `. ${cap(str(d.Rationale).replace(/[.]+$/, ""))}` : ""}.`,
    ref: `decision:${str(d.ItemId)}`,
  }));
  for (const t of f.techDecisions.filter((x) => x.Status === "accepted")) {
    out.push({ title: str(t.Title), line: `**${str(t.Title)}** - ${lower(str(t.Choice).replace(/[.]+$/, ""))}.`, ref: `decision:${str(t.ItemId)}` });
  }
  return out.filter((d) => d.title);
}

function decisions(f: CollabFacts): PlannedPage | null {
  const items = decisionItems(f);
  if (!items.length) return null;
  return {
    kind: "decisions",
    slug: "decision-log",
    group: "decisions",
    title: "Decision log",
    body: ["# Decision log", "", ...items.map((d, i) => `${i + 1}. ${d.line}`)].join("\n"),
    order: null,
    sources: items.slice(0, 20).map((d) => ({ label: d.title, ref: d.ref })),
  };
}

function versionSections(f: CollabFacts): { version: string; lines: string[] }[] {
  const versions = [...new Set(f.releases.map((r) => r.version))].sort((a, b) => compareVersions(b, a));
  const lowest = versions[versions.length - 1];
  return versions.map((v) => {
    const rels = f.releases.filter((r) => r.version === v);
    const crIds = new Set(rels.flatMap((r) => r.changeRequestIds));
    const crs = f.changes.filter((c) => crIds.has(c.id) || (c.version === v && c.status !== "draft" && c.status !== "building"));
    const lines: string[] = [];
    if (crs.length) for (const c of crs) lines.push(`- ${c.title} (${c.code})${c.description ? `: ${lower(clip(c.description.split(/(?<=[.!?])\s/)[0] ?? "", 160).replace(/[.]+$/, ""))}` : ""}`);
    else if (v === lowest) for (const feat of f.features) lines.push(`- ${feat.title}`);
    else lines.push("- Maintenance release");
    const when = ["dev", "stage", "production"]
      .map((e) => rels.find((r) => r.env === e))
      .filter(Boolean)
      .map((r) => `${ENV_LABEL[r!.env]} on ${day(r!.releasedAt)}`);
    if (when.length) lines.push("", `Released to ${when.join(", ")}.`);
    return { version: v, lines };
  });
}

function releases(f: CollabFacts): PlannedPage | null {
  if (f.releases.length) {
    const lines = ["# Release notes"];
    for (const s of versionSections(f)) lines.push("", `## ${s.version}`, "", ...s.lines);
    const latest = [...f.releases].sort((a, b) => compareVersions(b.version, a.version))[0]!;
    return {
      kind: "releases",
      slug: "release-notes",
      group: "releases",
      title: "Release notes",
      body: lines.join("\n"),
      order: null,
      sources: [
        { label: `${latest.version} on ${ENV_LABEL[latest.env] ?? latest.env}`, ref: `release:${latest.id}` },
        ...f.changes.filter((c) => c.status !== "draft").slice(0, 10).map((c) => ({ label: `${c.code} ${c.title}`, ref: `${c.lane === "fix" ? "fix" : "change"}:${c.id}` })),
      ],
    };
  }
  const ready = f.previews.filter((p) => p.Status === "ready");
  if (!ready.length) return null;
  const lines = ["# Milestone previews", "", `Every milestone of ${f.name} is deployed to a preview once it is built.`];
  const sorted = [...ready].sort((a, b) => compareVersions(str(b.Version), str(a.Version)));
  for (const p of sorted) {
    const m = f.milestones.find((x) => x.id === p.MilestoneId);
    const feats = f.features.filter((x) => m?.featureRefs.includes(x.ref)).map((x) => x.title);
    lines.push("", `## ${str(p.Version)}`, "");
    if (m) lines.push(`Milestone ${m.number} “${m.name}”${m.goal ? `: ${lower(m.goal.replace(/[.]+$/, ""))}` : ""}.`, "");
    for (const t of feats) lines.push(`- ${t}`);
    if (/^https:\/\//.test(str(p.Url))) lines.push("", `[Open the preview](${str(p.Url)})${str(p.ReadyAt) ? `, ready since ${day(str(p.ReadyAt))}` : ""}.`);
  }
  return { kind: "previews", slug: "milestone-previews", group: "releases", title: "Milestone previews", body: lines.join("\n"), order: null, sources: [] };
}

/** Every page MADP writes for the project now, in the order they are written. */
export function planWiki(f: CollabFacts): PlannedPage[] {
  const pages = [overview(f), ...guides(f), ...featurePages(f), rules(f), architecture(f), decisions(f), releases(f)].filter((p): p is PlannedPage => p !== null);
  const taken = new Set<string>();
  for (const p of pages) {
    let s = SLUG_PATTERN.test(p.slug) ? p.slug : `page-${slugOf(p.title, 60)}`;
    if (taken.has(s)) s = `${p.kind}-${s}`.slice(0, 120);
    for (let n = 2; taken.has(s); n++) s = `${p.slug}-${n}`;
    taken.add(s);
    p.slug = s;
    p.body = p.body.slice(0, 200000);
    p.title = clip(p.title, 200);
  }
  return pages;
}

export function sourcesJson(p: { order: number | null; sources: { label: string; ref: string }[] }): string {
  return JSON.stringify({ order: p.order, items: p.sources.slice(0, 20).map((s) => ({ label: clip(s.label, 200), ref: s.ref })) });
}

export function wikiVersion(f: CollabFacts): string {
  const v = productVersion(f);
  return v ? `v${v}` : "";
}

/** Adds to an existing factory page what the plan has and the page does not (new versions, changes, decisions). */
export function mergeBody(existing: string, planned: PlannedPage, f: CollabFacts): string {
  const body = existing.trimEnd();
  switch (planned.kind) {
    case "releases":
    case "previews": {
      const have = new Set([...body.matchAll(/^##\s+v?(\d+\.\d+\.\d+)\s*$/gm)].map((m) => m[1]!));
      const sections: string[] = [];
      if (planned.kind === "releases") {
        for (const s of versionSections(f)) if (!have.has(s.version)) sections.push(`## ${s.version}`, "", ...s.lines, "");
      } else {
        const blocks = planned.body.split(/^(?=## )/m).slice(1);
        for (const b of blocks) {
          const v = /^##\s+(\S+)/.exec(b)?.[1] ?? "";
          if (v && !have.has(v)) sections.push(b.trimEnd(), "");
        }
      }
      if (!sections.length) return body;
      const at = body.search(/^## /m);
      if (at < 0) return `${body}\n\n${sections.join("\n").trimEnd()}`;
      return `${body.slice(0, at)}${sections.join("\n").trimEnd()}\n\n${body.slice(at)}`;
    }
    case "decisions": {
      const items = decisionItems(f).filter((d) => !body.includes(d.title));
      if (!items.length) return body;
      const n = [...body.matchAll(/^(\d+)\.\s/gm)].length;
      return `${body}\n${items.map((d, i) => `${n + i + 1}. ${d.line}`).join("\n")}`;
    }
    case "feature": {
      const lines = (/^## Changes\n\n([\s\S]*?)(?=\n## |$)/m.exec(planned.body)?.[1] ?? "").split("\n").filter((l) => l.startsWith("- "));
      const missing = lines.filter((l) => {
        const code = /^- ((?:CR|FX)-\d+)/.exec(l)?.[1];
        return code ? !body.includes(code) : false;
      });
      if (!missing.length) return body;
      return /^## Changes\s*$/m.test(body) ? `${body}\n${missing.join("\n")}` : `${body}\n\n## Changes\n\n${missing.join("\n")}`;
    }
    default:
      return body;
  }
}

/** True when a person has edited the page (their saves leave history rows): MADP then leaves it alone. */
export function editedByPerson(page: Row, history: Row[]): boolean {
  if (page.Origin === "person") return true;
  return history.some((h) => h.PageId === page.ItemId && h.Origin === "person");
}

/** The existing page a planned page updates: the same slug, else the factory page of the same feature, guide or group. */
export function existingPageFor(pages: readonly Row[], planned: PlannedPage, claimed: ReadonlySet<string>): Row | undefined {
  const free = pages.filter((p) => !claimed.has(str(p.ItemId)));
  const bySlug = free.find((p) => p.Slug === planned.slug);
  if (bySlug) return bySlug;
  const factory = free.filter((p) => p.Origin === "factory");
  const refsOf = (p: Row) => parseSources(str(p.SourcesJson)).items.map((i) => i.ref);
  switch (planned.kind) {
    case "feature": {
      const ref = planned.sources[0]?.ref;
      return ref ? factory.find((p) => p.PageGroup === "features" && refsOf(p).includes(ref)) : undefined;
    }
    case "guide": {
      const refs = new Set(planned.sources.map((x) => x.ref));
      return factory.find((p) => p.PageGroup === "guide" && refsOf(p).some((r) => refs.has(r)));
    }
    case "overview":
      return factory.find((p) => p.PageGroup === "overview");
    case "rules":
      return factory.find((p) => p.PageGroup === "logic");
    case "architecture":
      return factory.find((p) => p.PageGroup === "technical");
    case "decisions":
      return factory.find((p) => p.PageGroup === "decisions");
    case "releases":
    case "previews":
      return factory.find((p) => p.PageGroup === "releases");
  }
}
