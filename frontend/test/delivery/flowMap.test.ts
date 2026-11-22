// The shared FlowMap (src/domain/flowMap.ts + src/components/flow/FlowMap.tsx): Studio's depth layout, node size and
// pitch, edge states, lanes / layers, and a server render of the map (cards, keys, notes, the screen-reader summary)
// and of the Build queue's graph.
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import {
  FLOW_COL_PITCH, FLOW_NODE_H, FLOW_ROW_PITCH, flowColumns, flowDepths, flowEdgeState, flowLayout, flowMinWidth, flowSummary,
  flowViewHeight, flowWaitingOn, type FlowEdge, type FlowNode,
} from "@/domain/flowMap";
import { FlowLegend, FlowMap } from "@/components/flow/FlowMap";
import { QueueGraph } from "@/components/build/queue/QueueGraph";
import { buildQueue } from "@/domain/buildQueue";

const n = (id: string, o: Partial<FlowNode> = {}): FlowNode => ({ id, key: id.toUpperCase(), title: `Node ${id}`, ...o });
const e = (from: string, to: string, o: Partial<FlowEdge> = {}): FlowEdge => ({ from, to, ...o });

describe("layout (Studio's queue graph)", () => {
  const nodes = [n("a", { status: "done" }), n("b", { status: "active" }), n("c", { status: "waiting" }), n("d", { status: "ready" })];
  const edges = [e("a", "b"), e("a", "c"), e("b", "c"), e("zz", "d"), e("d", "d")];

  it("depth columns left to right; unknown ids and self-loops ignored", () => {
    expect(flowDepths(nodes, edges)).toEqual({ a: 0, b: 1, c: 2, d: 0 });
    expect(flowColumns(nodes, edges).map((c) => c.map((x) => x.id))).toEqual([["a", "d"], ["b"], ["c"]]);
    expect(flowWaitingOn(nodes[2], nodes, edges)).toEqual(["b"]);
  });
  it("Studio's pitch: x = depth × 344, each column centred on the tallest (row pitch 124)", () => {
    const l = flowLayout(nodes, edges);
    expect(l.bands).toEqual([]);
    expect(l.maxRows).toBe(2);
    expect(l.positions.get("a")).toEqual({ x: 0, y: 0 });
    expect(l.positions.get("d")).toEqual({ x: 0, y: FLOW_ROW_PITCH });
    expect(l.positions.get("b")).toEqual({ x: FLOW_COL_PITCH, y: FLOW_ROW_PITCH / 2 });
    expect(l.positions.get("c")).toEqual({ x: 2 * FLOW_COL_PITCH, y: FLOW_ROW_PITCH / 2 });
    expect(flowViewHeight(l)).toBe(Math.min(640, Math.max(260, 120 + 2 * FLOW_ROW_PITCH)));
  });
  it("orders a column by its dependencies' height, so lines cross less", () => {
    const ns = [n("a"), n("b"), n("x"), n("y")];
    const l = flowLayout(ns, [e("b", "x"), e("a", "y")]);
    expect(l.positions.get("y")!.y).toBeLessThan(l.positions.get("x")!.y);
  });
  it("edge states: own state wins; moving into active work, dashed from unfinished work, solid otherwise", () => {
    const byId = new Map(nodes.map((x) => [x.id, x]));
    expect(flowEdgeState(e("a", "b"), byId)).toBe("active");
    expect(flowEdgeState(e("b", "c"), byId)).toBe("pending");
    expect(flowEdgeState(e("a", "c"), byId)).toBe("done");
    expect(flowEdgeState(e("b", "c", { state: "done" }), byId)).toBe("done");
    expect(flowEdgeState(e("p", "q"), new Map([["p", n("p")], ["q", n("q")]]))).toBe("done");
  });
  it("lanes: one band per group, top to bottom, the depth columns shared", () => {
    const ns = [n("a", { group: "m1" }), n("b", { group: "m1" }), n("c", { group: "m2" })];
    const l = flowLayout(ns, [e("a", "b"), e("b", "c")], { groups: [{ id: "m1", label: "Milestone 1" }, { id: "m2", label: "Milestone 2" }] });
    expect(l.bands.map((b) => b.group.label)).toEqual(["Milestone 1", "Milestone 2"]);
    expect(l.positions.get("c")!.x).toBe(2 * FLOW_COL_PITCH);
    expect(l.positions.get("c")!.y).toBeGreaterThan(l.bands[0].y + l.bands[0].height);
    expect(l.bands[1].y + l.bands[1].height).toBe(l.height);
    // a single group is drawn exactly like Studio (no band)
    expect(flowLayout([n("a", { group: "m1" })], [], { groups: [{ id: "m1", label: "M" }] }).bands).toEqual([]);
  });
  it("layers: one column per group (Screens / Services / Data)", () => {
    const ns = [n("s1", { group: "screens" }), n("api", { group: "services" }), n("db", { group: "data" }), n("s2", { group: "screens" })];
    const l = flowLayout(ns, [e("s1", "api"), e("s2", "api"), e("api", "db")], {
      grouping: "layers", groups: [{ id: "screens", label: "Screens" }, { id: "services", label: "Services" }, { id: "data", label: "Data" }],
    });
    expect(["s1", "s2", "api", "db"].map((id) => l.positions.get(id)!.x)).toEqual([0, 0, FLOW_COL_PITCH, 2 * FLOW_COL_PITCH]);
    expect(l.bands.map((b) => b.group.label)).toEqual(["Screens", "Services", "Data"]);
  });
  it("a phone keeps the map readable: a minimum width from the zoom the height allows", () => {
    const ns = Array.from({ length: 6 }, (_, i) => n(`n${i}`));
    const es = ns.slice(1).map((x, i) => e(ns[i].id, x.id));
    const l = flowLayout(ns, es);
    const h = flowViewHeight(l);
    expect(l.height).toBe(FLOW_NODE_H);
    expect(flowMinWidth(l, h)).toBeGreaterThan(1200);
    expect(flowMinWidth({ width: 0, height: 0, bands: [] }, h)).toBe(0);
  });
  it("one sentence per node for screen readers", () => {
    expect(flowSummary([n("a", { status: "waiting", note: "waits for B" }), n("b", { key: undefined })])).toBe("A Node a: Waiting, waits for B; Node b");
  });
});

describe("render", () => {
  const html = (el: ReturnType<typeof createElement>) => renderToString(createElement(MemoryRouter, null, el));

  it("FlowMap: the cards (key pill, state word, two-line title, note), the summary and the read-only map", () => {
    const out = html(createElement(FlowMap, {
      label: "Dependency map",
      nodes: [n("a", { status: "done", note: "done" }), n("b", { status: "active", note: "In review" }), n("c", { status: "waiting", note: "waits for B" })],
      edges: [e("a", "b"), e("b", "c")],
      onOpen: () => {},
      legend: createElement(FlowLegend, {}),
    }));
    expect(out).toContain('aria-label="Dependency map. A Node a: Done, done; B Node b: In progress, In review; C Node c: Waiting, waits for B"');
    expect(out).toContain("react-flow");
    for (const s of ["Node a", "Node b", "Node c", "waits for B", "In progress", "Waiting", "Done"]) expect(out).toContain(s);
    // the running node pings; the cards are buttons that open the item
    expect(out).toContain("flow-ping");
    expect(out.match(/<button type="button"/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    // the legend: every state and the three line styles
    for (const s of ["Ready", "Being fixed", "Stopped", "Dashed line: not done yet", "Moving line: being worked on now"]) expect(out).toContain(s);
  });
  it("FlowMap: an empty map says so", () => {
    expect(html(createElement(FlowMap, { label: "Map", nodes: [], edges: [], emptyText: "Nothing planned yet." }))).toContain("Nothing planned yet.");
  });
  it("QueueGraph: the project's tickets with their keys and what they wait for", () => {
    const items = buildQueue({
      tickets: [
        { id: "t1", number: 1, planRef: "r1.1", title: "Sign in", type: "story", agent: "dev", column: "done", isDone: true, doneAt: null, milestoneId: "m1", sortOrder: 1, source: "plan", dependsOn: [] },
        { id: "t2", number: 2, planRef: "r1.2", title: "Order list", type: "story", agent: "dev", column: "planned", isDone: false, doneAt: null, milestoneId: "m1", sortOrder: 2, source: "plan", dependsOn: ["t1", "t3"] },
        { id: "t3", number: 3, planRef: "r1.3", title: "Driver profile", type: "story", agent: "dev", column: "test", isDone: false, doneAt: null, milestoneId: "m1", sortOrder: 3, source: "plan", dependsOn: [] },
      ],
      events: [], milestones: [{ id: "m1", number: 1, sortOrder: 1 }], jobs: [],
    });
    const out = html(createElement(QueueGraph, { items, onOpen: () => {} }));
    for (const s of ["MF-1", "MF-2", "MF-3", "Sign in", "waits for MF-3", "In progress", "Testing"]) expect(out).toContain(s);
  });
});
