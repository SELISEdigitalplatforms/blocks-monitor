// Types of release.mjs (plain JavaScript, loaded by start.mjs before Vite is up).

export const WORKER_ENTRY: string;
export function concreteDir(dir: string): string;
export function releaseIdOf(frontend: string): string | null;
export function releaseLabel(frontend: string): string;
export function linkTarget(link: string): string | null;
export function releaseReady(frontend: string): boolean;
export function pinRelease(frontend: string): () => void;

export interface ReleaseLinkWatch {
  check(): void;
  stop(): void;
}
export function watchReleaseLink(o: {
  link: string;
  current(): string;
  onSwitch(target: string): void;
  refused?: () => string | null;
  everyMs?: number;
  log?: (line: string) => void;
}): ReleaseLinkWatch;

export interface ClosableServer {
  close(): Promise<void> | void;
}
export interface ServerPool<S extends ClosableServer> {
  acquire(root: string): Promise<S>;
  release(root: string, current: string): Promise<void>;
  sweep(current: string): Promise<void>;
  server(root: string): Promise<S> | null;
  loaded(): { root: string; users: number }[];
  closeAll(): Promise<void>;
}
export function createServerPool<S extends ClosableServer>(o: { create(root: string): S | Promise<S>; log?: (line: string) => void }): ServerPool<S>;
