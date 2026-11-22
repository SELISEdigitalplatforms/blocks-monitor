// Process-wide facts that never change after creation: which workspace a project belongs to and which project an
// anchor row (a task, a screen, ...) belongs to. They only let the router start the right reads one round earlier;
// every use is verified against rows read in the same request, so a stale entry costs a round, never correctness.
export interface FactMemo {
  workspaceOf(projectId: string): string | null;
  projectOf(schema: string, itemId: string): string | null;
  rememberProject(projectId: string, workspaceId: string): void;
  rememberAnchor(schema: string, itemId: string, projectId: string): void;
  forget(projectId: string): void;
  clear(): void;
}

const DEFAULT_MAX = 10_000;

class Lru {
  private readonly map = new Map<string, string>();
  constructor(private readonly max: number) {}
  get(key: string): string | null {
    const val = this.map.get(key);
    if (val === undefined) return null;
    this.map.delete(key);
    this.map.set(key, val);
    return val;
  }
  set(key: string, val: string): void {
    this.map.delete(key);
    this.map.set(key, val);
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }
  delete(key: string): void {
    this.map.delete(key);
  }
  clear(): void {
    this.map.clear();
  }
}

export function createFactMemo(o: { max?: number } = {}): FactMemo {
  const max = Math.max(1, o.max ?? DEFAULT_MAX);
  const projects = new Lru(max);
  const anchors = new Lru(max);
  const anchorKey = (schema: string, itemId: string): string => `${schema}|${itemId}`;
  return {
    workspaceOf: (projectId) => projects.get(projectId),
    projectOf: (schema, itemId) => anchors.get(anchorKey(schema, itemId)),
    rememberProject(projectId, workspaceId) {
      if (projectId && workspaceId) projects.set(projectId, workspaceId);
    },
    rememberAnchor(schema, itemId, projectId) {
      if (itemId && projectId) anchors.set(anchorKey(schema, itemId), projectId);
    },
    forget(projectId) {
      projects.delete(projectId);
    },
    clear() {
      projects.clear();
      anchors.clear();
    },
  };
}

export const processFacts: FactMemo = createFactMemo();
