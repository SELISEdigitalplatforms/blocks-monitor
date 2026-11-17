// Ticket dependencies (Ticket.DependsOn): which tickets must be done before another one starts, planned the way a
// software team plans a board, and the order the team works them in. Pure and deterministic: the local engine's
// board.plan / change.build and the sample data use the same rules, so a planned board and a seeded board look alike.
//
// How a team plans (planDependencies):
//   - shared set-up first: sign-in and roles, the back end / API, the interface to another system and the storage on
//     the phone have no dependencies; the build pipeline runs alongside everything (nothing waits for it);
//   - a feature's first story is its foundation (the data and the first screen); its other stories build on it, and a
//     story that carries on the one before it (same subject) waits for that one;
//   - the screens of a milestone wait for its sign-in and back-end tasks; a story that uses the interface or the
//     phone's storage waits for that task;
//   - an overview / tracking / desk feature waits for the features of its milestone whose data it shows;
//   - a feature of a later milestone waits for the earlier work it really builds on (the most related earlier feature,
//     or the back-end task that serves it), never for anything else of earlier milestones;
//   - a security review waits for the stories that handle the data it reviews.
// Features of one milestone that do not build on each other start side by side. Every edge points to a ticket of an
// earlier planning rank, so the plan never has a cycle (and dropCycles guards stored data anyway).

export interface DepFeature {
  key: string;
  /** Position of the feature's milestone (any increasing number). */
  milestone: number;
  title: string;
  description: string;
  /** The people in its stories ("driver", "service desk"). */
  actors: readonly string[];
}

export interface DepItem {
  /** Unique within the plan (the ticket's PlanRef). */
  ref: string;
  milestone: number;
  kind: "story" | "task";
  /** Feature key ("" when none); for a task, the feature it serves. */
  feature: string;
  /** Task tag ("ci", "auth", "int-…", "offline-store", "sec", …); "" for a story. */
  tag: string;
  title: string;
  /** The story's text and acceptance, or the task's description and acceptance. */
  text: string;
}

const MAX_DEPS = 4;

const STOP = new Set(
  (
    "the and for with from that this their they them then than there these those into onto each every other after before " +
    "when where which what while also only more most less over under about without within upon able can could should would " +
    "must may might will shall have has had been being are was were not but all any its it's his her our your you yours " +
    "one two three see sees seen show shows shown open opens check checks checked make makes made get gets use uses used " +
    "need needs work works working keep keeps new own first last next same today day days time times page screen list " +
    "lists data user users people person team app apps application portal system systems way ways sure thing things " +
    "just like want wants so such very well"
  ).split(" "),
);
const SHORT = new Set(["erp", "api", "csv", "pdf", "sms", "crm", "sap", "vat", "qr", "sso", "iot", "gps", "van"]);

function singular(w: string): string {
  if (w.length > 4 && w.endsWith("ies")) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && /(ches|shes|sses|xes)$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !/(ss|us|is)$/.test(w)) return w.slice(0, -1);
  return w;
}

/** The subject words of a text: lower case, no stop words, plural and -ing / -ed folded, cut to six letters
 *  ("signatures" → "signat", "pricing" → "pric", "reports" → "report"). */
export function subjectWords(text: string, ignore: ReadonlySet<string> = new Set()): Set<string> {
  const out = new Set<string>();
  const words = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/'s\b/g, "")
    .match(/[a-z0-9]+/g) ?? [];
  for (const raw of words) {
    if (/^\d+$/.test(raw) || STOP.has(raw)) continue;
    if (raw.length < 4 && !SHORT.has(raw)) continue;
    let w = singular(raw);
    if (STOP.has(w)) continue;
    if (w.length >= 7 && w.endsWith("ing")) w = w.slice(0, -3);
    else if (w.length >= 6 && w.endsWith("ed")) w = w.slice(0, -2);
    if (w.length >= 5 && w.endsWith("e")) w = w.slice(0, -1);
    const k = w.length > 6 ? w.slice(0, 6) : w;
    if (!ignore.has(k)) out.add(k);
  }
  return out;
}

const overlap = (a: ReadonlySet<string>, b: ReadonlySet<string>): number => {
  let n = 0;
  for (const x of a) if (b.has(x)) n += 1;
  return n;
};

export type TaskRole = "pipeline" | "access" | "backend" | "interface" | "offline" | "review" | "other";

/** What a cross-cutting task is, from its tag and title. */
export function taskRole(tag: string, title: string): TaskRole {
  const tg = tag.toLowerCase();
  const t = title.toLowerCase();
  if (/^(sec|security)/.test(tg) || /security review|review of|penetration|privacy review/.test(t)) return "review";
  if (/^ci$|^pipeline/.test(tg) || /pipeline|preview environment/.test(t)) return "pipeline";
  if (/^(auth|sso|login|roles?)$/.test(tg) || /sign-in|sign in|log-in|login|roles|accounts/.test(t)) return "access";
  if (/^int-/.test(tg) || /interface to|integration with|connection to/.test(t)) return "interface";
  if (/^offline/.test(tg) || /offline|storage on the (phone|device|tablet)/.test(t)) return "offline";
  if (/^(api|backend|back-end|data|model)$/.test(tg) || /\bapi\b|back end|back-end|endpoint|data model|database/.test(t)) return "backend";
  return "other";
}

const DESK_ACTOR = /desk|dispatch|office|admin|manager|planner|accountant|employer|purchasing|quality|supervisor|controller|back office/i;
const CONSUMER_TITLE = /overview|dashboard|tracking|notification|reminder|history|statistic|analytics|reporting\b/i;
const INTEGRATION = /\b(erp|sap|abacus|bexio|export|import|csv|interface|api|crm|accounting|webhook|sales order|booking into)\b/i;
const OFFLINE = /\b(offline|signal|photo|photos|photograph|queue|queued|sync|no connection|without connection|back online)\b/i;
const TESTS_DOCS = /\b(tests?|regression|user guide|documentation|help text|training)\b/i;

/** An overview, tracking or desk feature: it shows what the other features record. */
export function isConsumerFeature(f: Pick<DepFeature, "title" | "description" | "actors">): boolean {
  if (CONSUMER_TITLE.test(f.title)) return true;
  return f.actors.length > 0 && f.actors.every((a) => DESK_ACTOR.test(a));
}

/** The dependencies of a planned board, by ref (every ref of the input has an entry; [] = independent). */
export function planDependencies(o: { items: readonly DepItem[]; features: readonly DepFeature[] }): Map<string, string[]> {
  const items = o.items;
  const stories = items.filter((x) => x.kind === "story");
  // Words that say nothing about a subject here: the people ("As a driver I …") and words in most stories.
  // (a role's head noun only: "order desk" -> "desk", so "order" stays a subject)
  const people = subjectWords(o.features.flatMap((f) => f.actors.map((a) => a.trim().split(/[\s_-]+/).pop() ?? "")).join(" "));
  const ignore = new Set(people);
  if (stories.length >= 5) {
    const df = new Map<string, number>();
    for (const s of stories) for (const w of subjectWords(`${s.title} ${s.text}`)) df.set(w, (df.get(w) ?? 0) + 1);
    for (const [w, n] of df) if (n / stories.length > 0.6) ignore.add(w);
  }
  const words = (text: string) => subjectWords(text, ignore);

  const featureByKey = new Map(o.features.map((f) => [f.key, f]));
  const consumer = new Set(o.features.filter(isConsumerFeature).map((f) => f.key));
  const featureWords = new Map(o.features.map((f) => [f.key, words(`${f.title} ${f.description}`)]));
  // the same with only the people left out: the subject of a feature may be the word most stories share ("order")
  const featureAll = new Map(o.features.map((f) => [f.key, subjectWords(`${f.title} ${f.description}`, people)]));
  const storiesOf = new Map<string, DepItem[]>();
  for (const s of stories) {
    const list = storiesOf.get(s.feature) ?? [];
    list.push(s);
    storiesOf.set(s.feature, list);
  }
  const baseOf = (key: string): DepItem | undefined => storiesOf.get(key)?.[0];
  const tasks = items.filter((x) => x.kind === "task").map((x) => ({ item: x, role: taskRole(x.tag, x.title) }));
  const tasksIn = (m: number, role: TaskRole) => tasks.filter((t) => t.item.milestone === m && t.role === role).map((t) => t.item);

  // Planning rank: an edge only ever points to a lower rank, so the plan has no cycle.
  const index = new Map(items.map((x, i) => [x.ref, i]));
  const phase = (x: DepItem): number => {
    if (x.kind === "task") return taskRole(x.tag, x.title) === "review" ? 5 : 0;
    const list = storiesOf.get(x.feature) ?? [];
    const base = list[0]?.ref === x.ref;
    return (consumer.has(x.feature) ? 3 : 1) + (base ? 0 : 1);
  };
  const rank = (x: DepItem): [number, number, number] => [x.milestone, phase(x), index.get(x.ref)!];
  const lower = (a: DepItem, b: DepItem): boolean => {
    const ra = rank(a);
    const rb = rank(b);
    return ra[0] < rb[0] || (ra[0] === rb[0] && (ra[1] < rb[1] || (ra[1] === rb[1] && ra[2] < rb[2])));
  };

  const out = new Map<string, string[]>();
  for (const x of items) {
    const deps: DepItem[] = [];
    const add = (d: DepItem | undefined) => {
      if (d && d.ref !== x.ref && lower(d, x) && !deps.includes(d)) deps.push(d);
    };
    if (x.kind === "story") {
      const own = storiesOf.get(x.feature) ?? [x];
      const i = own.findIndex((s) => s.ref === x.ref);
      const f = featureByKey.get(x.feature);
      const fw = featureWords.get(x.feature) ?? words(x.title);
      const text = `${x.title} ${x.text}`;
      const iface = tasks.find((t) => t.role === "interface" && t.item.feature === x.feature && t.item.milestone <= x.milestone)?.item;
      const usesIface = !!iface && own.some((s) => INTEGRATION.test(`${s.title} ${s.text}`));
      if (i <= 0) {
        // the foundation of the feature: its milestone's sign-in and back end, then what it really builds on
        for (const t of tasksIn(x.milestone, "access")) add(t);
        for (const t of tasksIn(x.milestone, "backend")) add(t);
        if (iface && !usesIface) add(iface);
        if (consumer.has(x.feature)) {
          for (const g of o.features) if (g.milestone === x.milestone && g.key !== x.feature && !consumer.has(g.key)) add(baseOf(g.key));
        }
        if (f) {
          // one link to earlier milestones, where the work really builds on it: the most related earlier feature (ties:
          // the later milestone, then the first feature), else a back-end task of an earlier milestone that serves it
          const related = (ws: ReadonlyMap<string, Set<string>>): DepFeature | null => {
            let best: DepFeature | null = null;
            let score = 0;
            for (const g of o.features) {
              if (g.milestone >= x.milestone) continue;
              const n = overlap(ws.get(g.key)!, ws.get(x.feature)!);
              if (n > 0 && (n > score || (n === score && best !== null && g.milestone > best.milestone))) [best, score] = [g, n];
            }
            return best;
          };
          const best = related(featureWords) ?? related(featureAll);
          const backend = tasks.find((t) => t.role === "backend" && t.item.milestone < x.milestone && overlap(words(`${t.item.title} ${t.item.text}`), fw) > 0);
          if (best && baseOf(best.key)) add(baseOf(best.key));
          else if (backend) add(backend.item);
        }
      } else {
        // carries on the story before it (same subject), else builds on the feature's foundation
        const prev = own[i - 1]!;
        const sameSubject = i >= 2 && overlap(words(prev.title), words(x.title)) > 0;
        add(sameSubject ? prev : own[0]);
        if (TESTS_DOCS.test(x.title)) for (const s of own.slice(0, i).slice(-3)) add(s);
      }
      if (iface && usesIface && INTEGRATION.test(text)) add(iface);
      if (OFFLINE.test(text)) {
        const store = tasks.filter((t) => t.role === "offline" && t.item.milestone <= x.milestone).map((t) => t.item);
        add(store[store.length - 1]);
      }
    } else if (taskRole(x.tag, x.title) === "review") {
      // a security review waits for the stories that handle what it reviews (its own milestone first)
      const generic = subjectWords("security review access storage retention findings fixed accepted roles leak");
      const rw = new Set([...words(`${x.title} ${x.text}`)].filter((w) => !generic.has(w)));
      const hits = stories.filter((s) => s.milestone <= x.milestone && overlap(rw, words(`${s.title} ${s.text}`)) > 0);
      const own = hits.filter((s) => s.milestone === x.milestone);
      const chosen = (own.length > 0 ? own : hits).slice(-3);
      if (chosen.length === 0) {
        const mine = stories.filter((s) => s.milestone === x.milestone);
        if (mine.length > 0) chosen.push(mine[mine.length - 1]!);
      }
      for (const s of chosen) add(s);
    }
    out.set(x.ref, deps.sort((a, b) => index.get(a.ref)! - index.get(b.ref)!).slice(0, MAX_DEPS).map((d) => d.ref));
  }
  return dropCycles(items.map((x) => x.ref), out);
}

/** The dependencies of a change's tickets (in their order), by position: tests, docs and a regression test wait for
 *  the work before them; a ticket on the same subject as an earlier one waits for the latest such; the rest is
 *  independent (the team works it side by side). */
export function changeDependencies(titles: readonly string[]): number[][] {
  const ws = titles.map((t) => subjectWords(t));
  return titles.map((title, k) => {
    if (k === 0) return [];
    if (TESTS_DOCS.test(title)) return Array.from({ length: k }, (_, i) => i).slice(-3);
    for (let j = k - 1; j >= 0; j--) if (overlap(ws[j]!, ws[k]!) > 0) return [j];
    return [];
  });
}

/** The same dependencies without cycles: walking the ids in the given order, an edge that would close a cycle is
 *  dropped (deterministic). Unknown ids and self-references are dropped too. */
export function dropCycles(order: readonly string[], deps: ReadonlyMap<string, readonly string[]>): Map<string, string[]> {
  const known = new Set(order);
  const kept = new Map<string, string[]>(order.map((id) => [id, []]));
  const reaches = (from: string, to: string): boolean => {
    const seen = new Set<string>();
    const stack = [from];
    while (stack.length > 0) {
      const at = stack.pop()!;
      if (at === to) return true;
      if (seen.has(at)) continue;
      seen.add(at);
      for (const d of kept.get(at) ?? []) stack.push(d);
    }
    return false;
  };
  for (const id of order) {
    for (const d of deps.get(id) ?? []) {
      if (d === id || !known.has(d) || kept.get(id)!.includes(d)) continue;
      // the edge id -> d closes a cycle when d already (transitively) depends on id
      if (reaches(d, id)) continue;
      kept.get(id)!.push(d);
    }
  }
  return kept;
}

/** True when following the dependencies from some id leads back to it. */
export function hasCycle(deps: ReadonlyMap<string, readonly string[]>): boolean {
  const state = new Map<string, 1 | 2>();
  const visit = (id: string): boolean => {
    const s = state.get(id);
    if (s === 2) return false;
    if (s === 1) return true;
    state.set(id, 1);
    for (const d of deps.get(id) ?? []) if (deps.has(d) && visit(d)) return true;
    state.set(id, 2);
    return false;
  };
  return [...deps.keys()].some((id) => visit(id));
}

/** The order the team works the tickets in: every ticket after the tickets it waits for, otherwise in the given order.
 *  Dependencies outside the list count as met; a cycle in stored data is broken at its first ticket in the given
 *  order (deterministic), so the order always contains every id once. */
export function workOrder(ids: readonly string[], depsOf: (id: string) => readonly string[]): string[] {
  const inList = new Set(ids);
  const pending = new Map(ids.map((id) => [id, new Set(depsOf(id).filter((d) => d !== id && inList.has(d)))]));
  const out: string[] = [];
  const placed = new Set<string>();
  while (out.length < ids.length) {
    let next = ids.find((id) => !placed.has(id) && [...pending.get(id)!].every((d) => placed.has(d)));
    if (next === undefined) next = ids.find((id) => !placed.has(id))!;
    placed.add(next);
    out.push(next);
  }
  return out;
}

/** The order a team picks the tickets up in: a ticket only after the tickets it waits for; among those ready, first the
 *  one that the longest chain of other tickets waits for (set-up work first), then in the given order. */
export function teamOrder(ids: readonly string[], depsOf: (id: string) => readonly string[]): string[] {
  const inList = new Set(ids);
  const deps = new Map(ids.map((id) => [id, depsOf(id).filter((d) => d !== id && inList.has(d))]));
  // tail: the longest chain of tickets that (transitively) wait for this one, the ticket itself included
  const tail = new Map<string, number>();
  for (const id of [...workOrder(ids, (x) => deps.get(x)!)].reverse()) {
    let best = 0;
    for (const other of ids) if (deps.get(other)!.includes(id) && tail.has(other)) best = Math.max(best, tail.get(other)!);
    tail.set(id, best + 1);
  }
  const placed = new Set<string>();
  const out: string[] = [];
  while (out.length < ids.length) {
    const ready = ids.filter((id) => !placed.has(id) && deps.get(id)!.every((d) => placed.has(d)));
    const pool = ready.length > 0 ? ready : ids.filter((id) => !placed.has(id)).slice(0, 1);
    let next = pool[0]!;
    for (const id of pool) if (tail.get(id)! > tail.get(next)!) next = id;
    placed.add(next);
    out.push(next);
  }
  return out;
}

/** The longest chain of tickets (counted in tickets) that wait for each other, among the given ids. */
export function chainLength(ids: readonly string[], depsOf: (id: string) => readonly string[]): number {
  const inList = new Set(ids);
  const depth = new Map<string, number>();
  for (const id of workOrder(ids, depsOf)) {
    const ds = depsOf(id).filter((d) => d !== id && inList.has(d) && depth.has(d));
    depth.set(id, 1 + Math.max(0, ...ds.map((d) => depth.get(d)!)));
  }
  return Math.max(0, ...depth.values());
}
