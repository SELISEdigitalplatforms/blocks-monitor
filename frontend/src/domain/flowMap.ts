/** The shared model of every flow / dependency map in MADP Factory (the Build queue, architecture maps, technical
 *  decisions): pure functions, no React. The view is src/components/flow/FlowMap.tsx (its header documents the API).
 *
 *  Layout = MADP Studio's queue graph (madp-studio shared/src/queue.ts + web/src/components/queue/QueueGraph.tsx):
 *  left to right by depth (a node sits one column right of its deepest dependency), the same node size and pitch, each
 *  column centred on the tallest one. On top of that, optional groups: "lanes" (horizontal bands, e.g. milestones; the
 *  depth columns run through every band) or "layers" (one fixed column per group, e.g. Screens / Services / Data). */

/** A node's state. Without one the node is neutral (an architecture box). */
export const FLOW_STATUSES = ["waiting", "ready", "active", "fixing", "done", "stopped"] as const;
export type FlowStatus = (typeof FLOW_STATUSES)[number];

/** The default words for each state (plain words; a map can rename them). */
export const FLOW_STATUS_LABEL: Record<FlowStatus, string> = {
  waiting: "Waiting", ready: "Ready", active: "In progress", fixing: "Being fixed", done: "Done", stopped: "Stopped",
};

/** done = solid line, pending = dashed (the node it starts from is not done yet), active = moving (the node it leads to
 *  is being worked on). */
export type FlowEdgeState = "done" | "pending" | "active";

export interface FlowNode {
  /** unique within the map; edges refer to it */
  id: string;
  /** the short code in the pill (e.g. "MF-12"); none = no pill */
  key?: string;
  title: string;
  /** a small type word next to the pill ("Fix", "Service", "Decision") */
  kind?: string;
  status?: FlowStatus;
  /** replaces the status word on this node (e.g. "In progress" → "Agreed") */
  statusLabel?: string;
  /** the line under the title ("waits for MF-3", "ready to start", "done 26.10.2026 14:05") */
  note?: string;
  noteTone?: "muted" | "success" | "danger";
  /** the lane or layer (FlowGroup id) the node belongs to */
  group?: string;
  /** a link on the node (in-app route or URL); otherwise the map's onOpen makes the whole card a button */
  href?: string;
  /** the link word shown bottom right ("Open task"; Studio's "Open run"); none = the card is still clickable */
  linkLabel?: string;
  /** extra words for screen readers and the tooltip */
  description?: string;
}

export interface FlowEdge {
  /** the node that comes first (the dependency, the source of a data flow) */
  from: string;
  /** the node that waits for / receives from `from` */
  to: string;
  label?: string;
  /** when left out it follows the nodes: see flowEdgeState */
  state?: FlowEdgeState;
}

export interface FlowGroup { id: string; label: string }
export type FlowGrouping = "lanes" | "layers";

/* ── Studio's depth logic (queueDepths / queueColumns / waitingOn), over nodes + edges ─────────────────────────── */

/** Each node's dependencies (edges into it from nodes on the map), deduplicated, in edge order. */
export function flowDeps(nodes: readonly FlowNode[], edges: readonly FlowEdge[]): Map<string, string[]> {
  const ids = new Set(nodes.map((n) => n.id));
  const deps = new Map<string, string[]>(nodes.map((n) => [n.id, []]));
  for (const e of edges) {
    if (e.from === e.to || !ids.has(e.from) || !ids.has(e.to)) continue;
    const list = deps.get(e.to)!;
    if (!list.includes(e.from)) list.push(e.from);
  }
  return deps;
}

/** Depth = 1 + the deepest dependency's depth (0 without dependencies). Cycles and unknown ids are ignored. */
export function flowDepths(nodes: readonly FlowNode[], edges: readonly FlowEdge[]): Record<string, number> {
  const deps = flowDeps(nodes, edges);
  const depth: Record<string, number> = {};
  const stack = new Set<string>();
  const visit = (id: string): number => {
    if (id in depth) return depth[id];
    stack.add(id);
    let d = 0;
    for (const dep of deps.get(id) ?? []) {
      if (stack.has(dep)) continue;
      d = Math.max(d, visit(dep) + 1);
    }
    stack.delete(id);
    depth[id] = d;
    return d;
  };
  for (const n of nodes) visit(n.id);
  return depth;
}

/** The nodes by depth column, each column in the given order; empty columns dropped (Studio's queueColumns). */
export function flowColumns(nodes: readonly FlowNode[], edges: readonly FlowEdge[]): FlowNode[][] {
  const depth = flowDepths(nodes, edges);
  const cols: FlowNode[][] = [];
  for (const n of nodes) (cols[depth[n.id]] ??= []).push(n);
  return cols.filter(Boolean);
}

/** The dependencies of a node that are not done yet (ids). */
export function flowWaitingOn(node: FlowNode, nodes: readonly FlowNode[], edges: readonly FlowEdge[]): string[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return (flowDeps(nodes, edges).get(node.id) ?? []).filter((d) => byId.get(d)?.status !== "done");
}

/** An edge's look: its own state wins; else moving while the node it leads to is worked on, dashed while the node it
 *  starts from is not done, solid otherwise (and between neutral nodes). */
export function flowEdgeState(edge: FlowEdge, byId: ReadonlyMap<string, FlowNode>): FlowEdgeState {
  if (edge.state) return edge.state;
  const to = byId.get(edge.to)?.status;
  if (to === "active" || to === "fixing") return "active";
  const from = byId.get(edge.from)?.status;
  return from && from !== "done" ? "pending" : "done";
}

/** The status word of a node: its own label, else the map's word for its state, else none. */
export function flowStatusLabel(node: FlowNode, labels?: Partial<Record<FlowStatus, string>>): string | null {
  if (node.statusLabel) return node.statusLabel;
  return node.status ? labels?.[node.status] ?? FLOW_STATUS_LABEL[node.status] : null;
}

/* ── positions ─────────────────────────────────────────────────────────────────────────────────────────────────── */

/** Studio's node size and pitch. */
export const FLOW_NODE_W = 264;
export const FLOW_NODE_H = 104;
export const FLOW_COL_PITCH = 344;
export const FLOW_ROW_PITCH = 124;
/** a group band: room for its name above the first row, padding around its nodes, the gap to the next band */
export const FLOW_BAND_HEAD = 34;
export const FLOW_BAND_PAD = 18;
export const FLOW_BAND_GAP = 26;

export interface FlowBand { group: FlowGroup; x: number; y: number; width: number; height: number }
export interface FlowLayout {
  /** top-left corner of each node */
  positions: Map<string, { x: number; y: number }>;
  /** one per group when grouped (none on an ungrouped map, exactly like Studio) */
  bands: FlowBand[];
  /** the most nodes stacked in one column (of one band) */
  maxRows: number;
  columns: number;
  /** the content's size */
  width: number;
  height: number;
}

/** The groups actually used, in the given order, then any unnamed ones in node order ("" = no group, last). */
function usedGroups(nodes: readonly FlowNode[], groups: readonly FlowGroup[]): FlowGroup[] {
  const used = new Set(nodes.map((n) => n.group ?? ""));
  const out = groups.filter((g) => used.has(g.id));
  for (const n of nodes) {
    const id = n.group ?? "";
    if (id && !out.some((g) => g.id === id)) out.push({ id, label: id });
  }
  if (used.has("")) out.push({ id: "", label: "Other" });
  return out;
}

/** Orders a column so lines cross as little as possible: by the mean height of each node's already placed
 *  dependencies (stable; nodes without placed dependencies keep their order and go first). */
function orderColumn(col: FlowNode[], deps: Map<string, string[]>, placed: Map<string, { x: number; y: number }>): FlowNode[] {
  const key = (n: FlowNode) => {
    const ys = (deps.get(n.id) ?? []).map((d) => placed.get(d)?.y).filter((y): y is number => y !== undefined);
    return ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : -Infinity;
  };
  return col.map((n, i) => ({ n, i, k: key(n) })).sort((a, b) => a.k - b.k || a.i - b.i).map((x) => x.n);
}

/** Where every node goes. Ungrouped (or a single group): Studio's layout exactly, x = depth × column pitch, each column
 *  centred on the tallest. "lanes": one band per group, top to bottom, the depth columns shared by all bands.
 *  "layers": one column per group, left to right, nodes stacked by depth inside it. */
export function flowLayout(nodes: readonly FlowNode[], edges: readonly FlowEdge[],
  opts: { groups?: readonly FlowGroup[]; grouping?: FlowGrouping } = {}): FlowLayout {
  const deps = flowDeps(nodes, edges);
  const depth = flowDepths(nodes, edges);
  const groups = opts.groups?.length ? usedGroups(nodes, opts.groups) : [];
  const grouped = groups.length > 1 || (groups.length === 1 && opts.grouping === "layers");
  const positions = new Map<string, { x: number; y: number }>();

  if (grouped && opts.grouping === "layers") {
    const cols = groups.map((g) => nodes.filter((n) => (n.group ?? "") === g.id)
      .map((n, i) => ({ n, i })).sort((a, b) => depth[a.n.id] - depth[b.n.id] || a.i - b.i).map((x) => x.n));
    const maxRows = cols.reduce((m, c) => Math.max(m, c.length), 0);
    const bands: FlowBand[] = [];
    cols.forEach((col, gi) => {
      col.forEach((n, row) => positions.set(n.id, {
        x: gi * FLOW_COL_PITCH,
        y: FLOW_BAND_HEAD + row * FLOW_ROW_PITCH + ((maxRows - col.length) * FLOW_ROW_PITCH) / 2,
      }));
      bands.push({ group: groups[gi], x: gi * FLOW_COL_PITCH - FLOW_BAND_PAD, y: 0, width: FLOW_NODE_W + 2 * FLOW_BAND_PAD,
        height: FLOW_BAND_HEAD + (maxRows - 1) * FLOW_ROW_PITCH + FLOW_NODE_H + FLOW_BAND_PAD });
    });
    return { positions, bands, maxRows, columns: cols.length,
      width: (cols.length - 1) * FLOW_COL_PITCH + FLOW_NODE_W, height: bands[0]?.height ?? 0 };
  }

  const columns = nodes.length ? Math.max(...nodes.map((n) => depth[n.id])) + 1 : 0;
  const lanes = grouped ? groups.map((g) => nodes.filter((n) => (n.group ?? "") === g.id)) : [nodes.slice()];
  // each lane's columns (empty ones kept so the depth columns line up across lanes)
  const laneCols = lanes.map((ns) => {
    const cols: FlowNode[][] = Array.from({ length: columns }, () => []);
    for (const n of ns) cols[depth[n.id]].push(n);
    return cols;
  });
  const laneRows = laneCols.map((cols) => cols.reduce((m, c) => Math.max(m, c.length), 0));
  const head = grouped ? FLOW_BAND_HEAD : 0;
  const tops: number[] = [];
  let top = 0;
  for (const rows of laneRows) {
    tops.push(top);
    top += head + (rows - 1) * FLOW_ROW_PITCH + FLOW_NODE_H + (grouped ? FLOW_BAND_PAD + FLOW_BAND_GAP : 0);
  }
  for (let d = 0; d < columns; d++) {
    laneCols.forEach((cols, li) => {
      const col = d === 0 ? cols[d] : orderColumn(cols[d], deps, positions);
      col.forEach((n, row) => positions.set(n.id, {
        x: d * FLOW_COL_PITCH,
        y: tops[li] + head + row * FLOW_ROW_PITCH + ((laneRows[li] - col.length) * FLOW_ROW_PITCH) / 2,
      }));
    });
  }
  const width = columns ? (columns - 1) * FLOW_COL_PITCH + FLOW_NODE_W : 0;
  const bands: FlowBand[] = grouped ? groups.map((g, li) => ({
    group: g, x: -FLOW_BAND_PAD, y: tops[li], width: width + 2 * FLOW_BAND_PAD,
    height: head + (laneRows[li] - 1) * FLOW_ROW_PITCH + FLOW_NODE_H + FLOW_BAND_PAD,
  })) : [];
  const maxRows = laneRows.reduce((m, r) => Math.max(m, r), 0);
  const height = grouped ? (bands.at(-1)!.y + bands.at(-1)!.height) : maxRows ? (maxRows - 1) * FLOW_ROW_PITCH + FLOW_NODE_H : 0;
  return { positions, bands, maxRows, columns, width, height };
}

/** The map's height on screen: Studio's formula on an ungrouped map (260–640 px), a little taller for bands. */
export function flowViewHeight(layout: Pick<FlowLayout, "bands" | "maxRows" | "height">): number {
  if (!layout.bands.length) return Math.min(640, Math.max(260, 120 + layout.maxRows * FLOW_ROW_PITCH));
  return Math.min(760, Math.max(280, 96 + layout.height));
}

/** Studio's fitView padding. */
export const FLOW_FIT_PADDING = 0.12;

/** The width a map needs to stay readable on a phone (its card scrolls sideways instead of shrinking it to nothing):
 *  the content at the zoom the height allows, capped at `zoom`. */
export function flowMinWidth(layout: Pick<FlowLayout, "width" | "height" | "bands">, viewHeight: number, zoom = 0.8): number {
  if (!layout.width || !layout.height) return 0;
  // React Flow's fitView: zoom = min(view width / (content width × (1 + padding)), the same for the height)
  const width = layout.width + (layout.bands.length ? 2 * FLOW_BAND_PAD : 0);
  const fitH = viewHeight / (layout.height * (1 + FLOW_FIT_PADDING));
  return Math.ceil(width * (1 + FLOW_FIT_PADDING) * Math.min(zoom, fitH));
}

/** One sentence per node for screen readers: "MF-3 Sign-in: Done; MF-4 Orders: Waiting, waits for MF-3". */
export function flowSummary(nodes: readonly FlowNode[], labels?: Partial<Record<FlowStatus, string>>): string {
  return nodes.map((n) => {
    const status = flowStatusLabel(n, labels);
    return `${n.key ? `${n.key} ` : ""}${n.title}${status ? `: ${status}` : ""}${n.note ? `, ${n.note}` : ""}`;
  }).join("; ");
}
