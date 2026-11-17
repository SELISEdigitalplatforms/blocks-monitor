export const MADP_BRIDGE_VERSION = 1 as const;

export interface BlocksProjectContext {
  itemId: string;
  tenantId: string;
  tenantGroupId: string;
  name: string;
  environment: string;
}

export interface BlocksRepositoryContext {
  itemId: string;
  repoName: string;
  repoUrl: string;
}

export interface BlocksContextMessage {
  type: "blocks:context";
  version: typeof MADP_BRIDGE_VERSION;
  project: BlocksProjectContext;
  repositories: BlocksRepositoryContext[];
  theme: "light" | "dark";
}

export interface BlocksRepositoryBranchesMessage {
  type: "blocks:repo-branches";
  version: typeof MADP_BRIDGE_VERSION;
  requestId: string;
  branches: { name: string; isDefault?: boolean }[];
  error?: string;
}

export interface BlocksSessionRefreshMessage {
  type: "blocks:session-refresh";
  version: typeof MADP_BRIDGE_VERSION;
  requestId: string;
  ok: boolean;
}

export type MadpMessage =
  | { type: "madp:ready"; version: typeof MADP_BRIDGE_VERSION }
  | {
      type: "madp:navigate";
      version: typeof MADP_BRIDGE_VERSION;
      destination: "projects" | "repositories";
    }
  | {
      type: "madp:repo-branches";
      version: typeof MADP_BRIDGE_VERSION;
      requestId: string;
      repository: string;
    }
  | {
      type: "madp:session-refresh";
      version: typeof MADP_BRIDGE_VERSION;
      requestId: string;
      tenantId: string;
    };

const repositoryPattern = /^[\w.-]+\/[\w.-]+$/;

export function isConnectedRepository(
  repository: string,
  connected: BlocksRepositoryContext[],
): boolean {
  const requested = repository.toLowerCase();
  return connected.some((repo) => {
    const sshMatch = /^git@github\.com:([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/i.exec(repo.repoUrl);
    if (sshMatch) return sshMatch[1].toLowerCase() === requested;
    try {
      const url = new URL(repo.repoUrl);
      if (url.hostname.toLowerCase() !== "github.com" || url.username || url.password) return false;
      const name = url.pathname
        .replace(/^\//, "")
        .replace(/\/$/, "")
        .replace(/\.git$/, "");
      return repositoryPattern.test(name) && name.toLowerCase() === requested;
    } catch {
      return false;
    }
  });
}

/** Accept messages only from the mounted, same-origin MADP document. */
export function readMadpMessage(
  event: MessageEvent,
  frameWindow: Window | null | undefined,
  origin: string,
): MadpMessage | null {
  if (!frameWindow || event.source !== frameWindow || event.origin !== origin) return null;
  const value: unknown = event.data;
  if (!value || typeof value !== "object") return null;
  const message = value as Record<string, unknown>;
  if (message.version !== MADP_BRIDGE_VERSION) return null;
  if (message.type === "madp:ready") return { type: message.type, version: MADP_BRIDGE_VERSION };
  if (
    message.type === "madp:session-refresh" &&
    typeof message.requestId === "string" &&
    message.requestId.length > 0 &&
    message.requestId.length <= 128 &&
    typeof message.tenantId === "string" &&
    message.tenantId.length > 0 &&
    message.tenantId.length <= 200
  ) {
    return {
      type: message.type,
      version: MADP_BRIDGE_VERSION,
      requestId: message.requestId,
      tenantId: message.tenantId,
    };
  }
  if (
    message.type === "madp:navigate" &&
    (message.destination === "projects" || message.destination === "repositories")
  ) {
    return {
      type: message.type,
      version: MADP_BRIDGE_VERSION,
      destination: message.destination,
    };
  }
  if (
    message.type === "madp:repo-branches" &&
    typeof message.requestId === "string" &&
    message.requestId.length > 0 &&
    message.requestId.length <= 128 &&
    typeof message.repository === "string" &&
    message.repository.length <= 200 &&
    repositoryPattern.test(message.repository) &&
    !message.repository.split("/").some((part) => part === "." || part === "..")
  ) {
    return {
      type: message.type,
      version: MADP_BRIDGE_VERSION,
      requestId: message.requestId,
      repository: message.repository,
    };
  }
  return null;
}
