/** FlowMap — the ONE map for every flow MADP Factory shows: the Build queue's dependencies today, architecture maps
 *  (screens, services, data flows) and technical decisions in Goals & requirements and Scope next. It looks and
 *  behaves exactly like MADP Studio's queue graph (madp-studio web/src/components/queue/QueueGraph.tsx), in the
 *  Factory's colour tokens (light and dark): left-to-right depth columns, the same node card (key pill, status dot with a
 *  ping while it runs, icon + word, two-line title, a note line, a link), the same node size and pitch, hidden
 *  handles, bezier edges (dashed while the node they start from is not done, moving while the node they lead to is
 *  worked on), a dot grid, the zoom controls bottom right, fitted to view, read-only, pan by dragging, no scroll zoom
 *  and a one-sentence-per-node summary for screen readers. On a phone the map keeps a readable size and its card
 *  scrolls sideways.
 *
 *  API (the model and the layout are pure, in src/domain/flowMap.ts):
 *    <FlowMap
 *      label="Dependency map"                         // what the map is (screen readers)
 *      nodes={FlowNode[]}                             // { id, key?, title, kind?, status?, statusLabel?, note?,
 *                                                     //   noteTone?, group?, href?, linkLabel?, description? }
 *      edges={FlowEdge[]}                             // { from, to, label?, state?: "done" | "pending" | "active" }
 *                                                     //   from = first / the dependency, to = the one that waits
 *      groups={FlowGroup[]} grouping="lanes"|"layers" // optional: lanes = horizontal bands (milestones, swimlanes),
 *                                                     //   layers = one column per group (Screens / Services / Data)
 *      onOpen={(node) => …} openLabel="Open"          // optional: the whole card becomes a button; a node's
 *                                                     //   linkLabel ("Open task") shows bottom right, like Studio's "Open run"
 *      statusLabels={{ active: "Agreed" }}            // optional: other words for the states
 *      arrows                                         // optional: arrow heads (data flows); Studio has none
 *      legend={<FlowLegend … />}                      // optional slot above the map (the map itself never changes)
 *      emptyText="Nothing planned yet" />
 *    <FlowLegend statuses={[…]} labels={…} counts={…} edges />   // the swatches + the three line styles
 *    <FlowStatusBadge status="active" label="In progress · In review" />  // the same status as a chip
 *  States (FlowStatus): waiting · ready · active · fixing · done · stopped; none = a neutral box. */
import { Background, BackgroundVariant, Controls, Handle, MarkerType, Position, ReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "./flow-map.css";
import { Activity, CheckCircle2, CirclePlay, Clock, RotateCcw, XCircle } from "lucide-react";
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { ChipTone } from "@/data/types";
import { cn } from "@/lib/cn";
import { Chip } from "@/ui/kit";
import { t, useCulture, useT } from "@/i18n";
import {
  FLOW_FIT_PADDING, FLOW_NODE_H, FLOW_NODE_W, FLOW_STATUSES, flowEdgeState, flowLayout, flowMinWidth,
  flowStatusLabel, flowSummary, flowViewHeight,
  type FlowEdge, type FlowEdgeState, type FlowGroup, type FlowGrouping, type FlowNode, type FlowStatus,
} from "@/domain/flowMap";

export type { FlowEdge, FlowGroup, FlowNode, FlowStatus } from "@/domain/flowMap";

/* ── Studio's tokens in the Factory's ─────────────────────────────────────────────────────────────────────────────
   surface → surface · surface-2 → surface2 · surface-3 → ink/6 % · line → line · line-strong → ink3/30 % ·
   brand-500 → accent · brand-ink → accent text · success/warning/danger (-ink → their text tokens) */
const LINE_STRONG = "rgb(var(--c-ink3) / 0.3)";
const ACCENT = "rgb(var(--c-accent))";

/** React Flow's own variables (controls, background) in the Factory's tokens: Studio's FLOW_VARS. */
export const FLOW_VARS = {
  "--xy-background-color": "rgb(var(--c-surface2))",
  "--xy-edge-stroke": LINE_STRONG,
  "--xy-controls-button-background-color": "rgb(var(--c-surface))",
  "--xy-controls-button-background-color-hover": "rgb(var(--c-surface2))",
  "--xy-controls-button-color": "rgb(var(--c-ink2))",
  "--xy-controls-button-color-hover": "rgb(var(--c-ink))",
  "--xy-controls-button-border-color": "rgb(var(--c-line))",
  "--xy-controls-box-shadow": "0 1px 2px rgb(0 0 0 / 0.08)",
  "--xy-attribution-background-color": "rgb(var(--c-surface) / 0.8)",
} as CSSProperties;

/** Studio's HIDDEN_HANDLE: edges attach left and right, nothing to grab. */
export const HIDDEN_HANDLE = { className: "!opacity-0", isConnectable: false } as const;

/** How each state looks; never colour alone: an icon and a word always come with it. */
export const FLOW_STATUS_LOOK: Record<FlowStatus, { icon: ReactNode; border: string; dot: string; ink: string; tone: ChipTone; pulse?: boolean }> = {
  // both kinds of Studio's "Pending": grey; the icon and the word (and the card's "waits for …" line) tell them apart
  waiting: { icon: <Clock />, border: "border-ink3/30", dot: "bg-ink3", ink: "text-ink3", tone: "neutral" },
  ready: { icon: <CirclePlay />, border: "border-ink3/30", dot: "bg-ink3", ink: "text-ink3", tone: "neutral" },
  active: { icon: <Activity />, border: "border-accent shadow-[0_10px_26px_-10px_rgb(var(--c-accent)/0.6)]", dot: "bg-accent", ink: "text-accent", tone: "accent", pulse: true },
  fixing: { icon: <RotateCcw />, border: "border-warning", dot: "bg-warning", ink: "text-warning", tone: "warning" },
  done: { icon: <CheckCircle2 />, border: "border-success", dot: "bg-success", ink: "text-success", tone: "success" },
  stopped: { icon: <XCircle />, border: "border-danger", dot: "bg-danger", ink: "text-danger", tone: "danger" },
};
const NEUTRAL_BORDER = "border-ink3/30";
const NOTE_TONE = { muted: "", success: "text-success", danger: "text-danger" } as const;

/** The status dot: solid, with Studio's ping while the node runs. */
function StatusDot({ status }: { status: FlowStatus }) {
  const st = FLOW_STATUS_LOOK[status];
  return (
    <span className="relative inline-flex size-1.5 shrink-0">
      {st.pulse && <span className={cn("flow-ping absolute inline-flex size-full rounded-full", st.dot)} />}
      <span className={cn("relative inline-flex size-1.5 rounded-full", st.dot)} />
    </span>
  );
}

/** A state as a chip (tables, lists): the dot while it runs, else the icon; then the word. */
export function FlowStatusBadge({ status, label, className }: { status: FlowStatus; label?: string; className?: string }) {
  useT();
  const st = FLOW_STATUS_LOOK[status];
  return (
    <Chip tone={st.tone} className={cn("[&_svg]:size-3.5", className)}
      icon={st.pulse ? <StatusDot status={status} /> : st.icon}>
      {label ?? flowStatusWord(status)}
    </Chip>
  );
}

/* ── the nodes ─────────────────────────────────────────────────────────────────────────────────────────────────── */

type CardData = { node: FlowNode; status: string | null; onOpen?: (n: FlowNode) => void; openLabel: string };
type CardNodeT = Node<CardData, "card">;
type BandNodeT = Node<{ label: string }, "band">;

// Studio's card: its height follows its content (the node box is 264 × 104; edges meet it at the box's middle)
const CARD = "flex flex-col rounded-[14px] border-2 bg-surface px-3 py-2.5 text-left shadow-card";

function NodeLink({ href, label }: { href: string; label: string }) {
  const cls = "nodrag nopan pointer-events-auto ml-auto shrink-0 font-semibold text-accent hover:underline";
  return /^https?:\/\//.test(href)
    ? <a className={cls} href={href} target="_blank" rel="noopener noreferrer">{label}</a>
    : <Link className={cls} to={href}>{label}</Link>;
}

function CardNode({ data }: NodeProps<CardNodeT>) {
  const { node, status, onOpen, openLabel } = data;
  const st = node.status ? FLOW_STATUS_LOOK[node.status] : null;
  const content = (<>
    <span className="flex items-center gap-2">
      {node.key && <span className="rounded-md bg-ink/[0.06] px-1.5 py-0.5 font-mono text-[11px] leading-[14px] text-ink2">{node.key}</span>}
      {node.kind && <span className="text-[11px] font-medium leading-[14px] text-ink3">{node.kind}</span>}
      {st && node.status && status && (
        <span className={cn("ml-auto inline-flex items-center gap-1.5 text-[11px] font-medium leading-[14px] [&_svg]:size-3", st.ink)}>
          <StatusDot status={node.status} />{st.icon}{status}
        </span>
      )}
    </span>
    <span className="mt-1.5 line-clamp-2 text-[13px] font-semibold leading-[18px] text-ink" title={node.title}>{node.title}</span>
    {(node.note || node.href || (onOpen && node.linkLabel)) && (
      <span className="mt-1 flex items-center gap-2 text-[11px] leading-[14px] text-ink3">
        {node.note && <span className={cn("truncate", NOTE_TONE[node.noteTone ?? "muted"])} title={node.note}>{node.note}</span>}
        {node.href ? <NodeLink href={node.href} label={node.linkLabel ?? openLabel} />
          : onOpen && node.linkLabel && <span aria-hidden className="ml-auto shrink-0 font-semibold text-accent">{node.linkLabel}</span>}
      </span>
    )}
  </>);
  const border = st?.border ?? NEUTRAL_BORDER;
  const said = [node.key, node.title, status, node.note, node.description].filter(Boolean).join(", ");
  return (
    <div className="h-full" style={{ width: FLOW_NODE_W }}>
      <Handle type="target" position={Position.Left} {...HIDDEN_HANDLE} />
      {onOpen && !node.href ? (
        <button type="button" onClick={() => onOpen(node)} aria-label={`${said}. ${openLabel}`} title={node.description}
          className={cn(CARD, border, "pointer-events-auto w-full cursor-pointer outline-none transition-[box-shadow,transform] hover:-translate-y-px focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface2")}>
          {content}
        </button>
      ) : (
        <div className={cn(CARD, border)} title={node.description} aria-label={said} role="group">{content}</div>
      )}
      <Handle type="source" position={Position.Right} {...HIDDEN_HANDLE} />
    </div>
  );
}

/** A lane or layer: a quiet band with its name, behind the edges. */
function BandNode({ data }: NodeProps<BandNodeT>) {
  return (
    <div className="h-full w-full rounded-[18px] border border-dashed border-ink3/30 bg-surface/55">
      <div className="truncate px-4 pt-2.5 text-[11px] font-semibold uppercase leading-[14px] tracking-wider text-ink3">{data.label}</div>
    </div>
  );
}

const NODE_TYPES = { card: CardNode, band: BandNode };

/* ── the map ───────────────────────────────────────────────────────────────────────────────────────────────────── */

/** Below 640 px the map keeps a readable size and scrolls inside its card; dragging then scrolls instead of panning. */
function useNarrow(): boolean {
  const query = "(max-width: 639px)";
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(query);
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return narrow;
}

export interface FlowMapProps {
  /** what the map is, for screen readers ("Dependency map") */
  label: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
  groups?: FlowGroup[];
  grouping?: FlowGrouping;
  onOpen?: (node: FlowNode) => void;
  openLabel?: string;
  statusLabels?: Partial<Record<FlowStatus, string>>;
  arrows?: boolean;
  legend?: ReactNode;
  emptyText?: string;
  className?: string;
}

export function FlowMap({ label, nodes, edges, groups, grouping = "lanes", onOpen, openLabel: openLabelIn, statusLabels: statusLabelsIn, arrows = false, legend, emptyText: emptyTextIn, className }: FlowMapProps) {
  const t = useT();
  const narrow = useNarrow();
  const openLabel = openLabelIn ?? t("project.flow.open", "Open");
  const emptyText = emptyTextIn ?? t("project.flow.empty", "Nothing to show yet.");
  // the map's words for the states in the chosen language; the caller's own words win
  const culture = useCulture();
  const statusLabels = useMemo(() => ({ ...flowStatusWords(), ...statusLabelsIn }), [statusLabelsIn, culture]); // eslint-disable-line react-hooks/exhaustive-deps
  const { rfNodes, rfEdges, summary, height, minWidth } = useMemo(() => {
    const layout = flowLayout(nodes, edges, { groups, grouping });
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const ns: Node[] = layout.bands.map((b) => ({
      id: `band:${b.group.id}`, type: "band", position: { x: b.x, y: b.y }, width: b.width, height: b.height,
      data: { label: b.group.label }, zIndex: -1, selectable: false, focusable: false, draggable: false,
    }));
    for (const n of nodes) {
      ns.push({
        id: n.id, type: "card", width: FLOW_NODE_W, height: FLOW_NODE_H, position: layout.positions.get(n.id) ?? { x: 0, y: 0 },
        data: { node: n, status: flowStatusLabel(n, statusLabels), onOpen, openLabel } satisfies CardData,
      });
    }
    const es: Edge[] = [];
    const seen = new Set<string>();
    for (const e of edges) {
      const id = `${e.from}->${e.to}`;
      if (seen.has(id) || e.from === e.to || !byId.has(e.from) || !byId.has(e.to)) continue;
      seen.add(id);
      const look: FlowEdgeState = flowEdgeState(e, byId);
      const stroke = look === "active" ? ACCENT : LINE_STRONG;
      es.push({
        id, source: e.from, target: e.to, animated: look === "active",
        style: { stroke, strokeWidth: 1.5, ...(look === "pending" ? { strokeDasharray: "4 4" } : {}) },
        ...(e.label ? { label: e.label, labelBgPadding: [6, 3] as [number, number], labelBgBorderRadius: 6 } : {}),
        ...(arrows ? { markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: stroke } } : {}),
      });
    }
    const viewHeight = flowViewHeight(layout);
    return { rfNodes: ns, rfEdges: es, summary: flowSummary(nodes, statusLabels), height: viewHeight, minWidth: flowMinWidth(layout, viewHeight) };
  }, [nodes, edges, groups, grouping, onOpen, openLabel, statusLabels, arrows]);

  if (nodes.length === 0) {
    return <div className={cn("grid min-h-[200px] place-items-center rounded-block hatched bg-surface2 px-6 py-10 text-center text-[14px] text-ink2", className)}>{emptyText}</div>;
  }
  // a new structure (other nodes or edges) fits the view again; a status change alone keeps where you panned to
  const shape = `${nodes.map((n) => `${n.id}:${n.group ?? ""}`).join(",")}|${edges.map((e) => `${e.from}>${e.to}`).join(",")}|${grouping}|${narrow ? "n" : "w"}`;
  return (
    <div className={cn("flex min-w-0 flex-col gap-3", className)}>
      {legend}
      <div className={cn("flow-map relative w-full rounded-[18px] ring-1 ring-line", narrow ? "scroll-thin overflow-x-auto overflow-y-hidden overscroll-x-contain" : "overflow-hidden")}
        role="group" aria-label={`${label}. ${summary}`}>
        <div style={{ height, minWidth: narrow ? minWidth : undefined }}>
          <ReactFlow
            key={shape}
            nodes={rfNodes}
            edges={rfEdges}
            nodeTypes={NODE_TYPES}
            fitView
            fitViewOptions={{ padding: FLOW_FIT_PADDING }}
            minZoom={0.3}
            maxZoom={1.5}
            nodesDraggable={false}
            nodesConnectable={false}
            nodesFocusable={false}
            edgesFocusable={false}
            elementsSelectable={false}
            panOnDrag={!narrow}
            zoomOnPinch={!narrow}
            zoomOnDoubleClick={!narrow}
            zoomOnScroll={false}
            preventScrolling={false}
            style={FLOW_VARS}
          >
            <Background variant={BackgroundVariant.Dots} gap={18} size={1} color={LINE_STRONG} bgColor="rgb(var(--c-surface2))" />
            <Controls showInteractive={false} position="bottom-right" />
          </ReactFlow>
        </div>
      </div>
    </div>
  );
}

/* ── the legend ────────────────────────────────────────────────────────────────────────────────────────────────── */

function edgeWord(state: FlowEdgeState): string {
  switch (state) {
    case "done": return t("project.flow.edge.done", "Solid line: done");
    case "pending": return t("project.flow.edge.pending", "Dashed line: not done yet");
    case "active": return t("project.flow.edge.active", "Moving line: being worked on now");
  }
}

/** The word for a state in the chosen language (the domain's FLOW_STATUS_LABEL in English). */
export function flowStatusWord(status: FlowStatus): string {
  switch (status) {
    case "waiting": return t("project.flow.status.waiting", "Waiting");
    case "ready": return t("project.flow.status.ready", "Ready");
    case "active": return t("project.flow.status.active", "In progress");
    case "fixing": return t("project.flow.status.fixing", "Being fixed");
    case "done": return t("project.flow.status.done", "Done");
    case "stopped": return t("project.flow.status.stopped", "Stopped");
  }
}

/** Every state's word in the chosen language. */
export function flowStatusWords(): Record<FlowStatus, string> {
  return Object.fromEntries(FLOW_STATUSES.map((s) => [s, flowStatusWord(s)])) as Record<FlowStatus, string>;
}

function EdgeSample({ state }: { state: FlowEdgeState }) {
  return (
    <svg width="30" height="8" viewBox="0 0 30 8" aria-hidden className="shrink-0 overflow-visible">
      <path d="M1 4 H29" fill="none" strokeWidth="1.5" stroke={state === "active" ? ACCENT : LINE_STRONG}
        strokeDasharray={state === "pending" ? "4 4" : undefined} className={state === "active" ? "flow-moving" : undefined} />
    </svg>
  );
}

/** The swatch of each state (its card border, dot and icon) and, optionally, the three line styles. */
export function FlowLegend({ statuses = FLOW_STATUSES, labels, counts, edges = true, className }: {
  statuses?: readonly FlowStatus[]; labels?: Partial<Record<FlowStatus, string>>; counts?: Partial<Record<FlowStatus, number>>;
  edges?: boolean; className?: string;
}) {
  const t = useT();
  return (
    <div className={cn("flex flex-wrap items-center gap-x-5 gap-y-2 text-[12px] text-ink2", className)}>
      <ul aria-label={t("project.flow.legendColours", "What the colours mean")} className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {statuses.map((s) => {
          const st = FLOW_STATUS_LOOK[s];
          const n = counts?.[s];
          return (
            <li key={s} className="inline-flex items-center gap-1.5">
              <span aria-hidden className={cn("inline-flex h-4 w-6 items-center justify-center rounded-[5px] border-2 bg-surface", st.border.split(" ")[0])}>
                <StatusDot status={s} />
              </span>
              <span className={cn("inline-flex items-center gap-1 [&_svg]:size-3", st.ink)} aria-hidden>{st.icon}</span>
              <span>{labels?.[s] ?? flowStatusWord(s)}{n !== undefined && <span className="num ml-1 text-ink3">{n}</span>}</span>
            </li>
          );
        })}
      </ul>
      {edges && (
        <ul aria-label={t("project.flow.legendLines", "What the lines mean")} className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {(["done", "pending", "active"] as const).map((s) => (
            <li key={s} className="inline-flex items-center gap-1.5"><EdgeSample state={s} />{edgeWord(s)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
