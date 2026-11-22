// Renders React components without a DOM, so their hooks, effects and data subscriptions run in a node test as they
// do in the browser (the host elements are plain objects and never drawn). For tests that count what a page reads.
// Load it after vi.useFakeTimers(): the scheduler then keeps to the test's clock.
import type { ReactNode } from "react";

type Root = { render(node: ReactNode): void; unmount(): void };

const LEGACY_ROOT = 0;
const DEFAULT_EVENT_PRIORITY = 16;

const noop = () => undefined;
let shared: ReconcilerApi | null = null;

/** One renderer for the whole test file (a context provider is only ever rendered by one renderer). */
async function renderer(): Promise<ReconcilerApi> {
  if (shared) return shared;
  const { default: Reconciler } = (await import("react-reconciler")) as unknown as { default: (host: unknown) => ReconcilerApi };
  shared = Reconciler(HOST);
  return shared;
}

export async function createHeadlessRoot(): Promise<Root> {
  const r = await renderer();
  const container = r.createContainer({}, LEGACY_ROOT, null, false, null, "", (e: Error) => { throw e; }, null);
  return {
    render: (node) => r.updateContainer(node, container, null, noop),
    unmount: () => r.updateContainer(null, container, null, noop),
  };
}

const HOST = (() => {
  const host = {
    supportsMutation: true,
    supportsPersistence: false,
    supportsHydration: false,
    isPrimaryRenderer: true,
    noTimeout: -1,
    supportsMicrotasks: true,
    scheduleMicrotask: (fn: () => void) => queueMicrotask(fn),
    scheduleTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    cancelTimeout: (h: ReturnType<typeof setTimeout>) => clearTimeout(h),
    createInstance: (type: string) => ({ type }),
    createTextInstance: (text: string) => ({ text }),
    appendInitialChild: noop,
    appendChild: noop,
    appendChildToContainer: noop,
    insertBefore: noop,
    insertInContainerBefore: noop,
    removeChild: noop,
    removeChildFromContainer: noop,
    finalizeInitialChildren: () => false,
    prepareUpdate: () => null,
    commitUpdate: noop,
    commitMount: noop,
    commitTextUpdate: noop,
    resetTextContent: noop,
    shouldSetTextContent: () => false,
    getRootHostContext: () => ({}),
    getChildHostContext: (parent: unknown) => parent,
    getPublicInstance: (i: unknown) => i,
    prepareForCommit: () => null,
    resetAfterCommit: noop,
    preparePortalMount: noop,
    clearContainer: noop,
    hideInstance: noop,
    unhideInstance: noop,
    hideTextInstance: noop,
    unhideTextInstance: noop,
    getCurrentEventPriority: () => DEFAULT_EVENT_PRIORITY,
    getInstanceFromNode: () => null,
    beforeActiveInstanceBlur: noop,
    afterActiveInstanceBlur: noop,
    prepareScopeUpdate: noop,
    getInstanceFromScope: () => null,
    detachDeletedInstance: noop,
  };
  return host;
})();

interface ReconcilerApi {
  createContainer(info: unknown, tag: number, hydration: null, strict: boolean, concurrent: null, prefix: string, onError: (e: Error) => void, transitions: null): unknown;
  updateContainer(node: ReactNode, container: unknown, parent: null, done: () => void): void;
}
