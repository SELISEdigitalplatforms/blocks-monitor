import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  project: {
    itemId: "item-1",
    tenantId: "tenant-1",
    tenantGroupId: "group-1",
    name: "Factory",
    environment: "dev",
  },
  repositories: [{ itemId: "repo-1", repoName: "app", repoUrl: "https://github.com/org/app" }],
  theme: "light" as "light" | "dark",
  navigate: vi.fn(),
  getBranches: vi.fn(),
  withSessionLock: vi.fn(),
  refreshSession: vi.fn(),
  impersonation: {
    isImpersonated: true,
    impersonatedTenantId: "tenant-1",
    detachedReason: null as string | null,
    impersonationError: null as unknown,
  },
}));
vi.mock("@seliseblocks/genesis-os/lib", () => ({
  iamClient: {
    withSessionLock: state.withSessionLock,
    refreshWithinSessionLock: state.refreshSession,
  },
}));
vi.mock("@/services/github-info.service", () => ({
  githubInfoService: { getGithubBranches: state.getBranches },
}));
vi.mock("@seliseblocks/genesis-os/store", () => ({
  useProjectStore: Object.assign(
    (selector: (store: unknown) => unknown) => selector({ selectedProject: state.project }),
    { getState: () => ({ selectedProject: state.project }) },
  ),
  useImpersonateStore: { getState: () => state.impersonation },
}));
vi.mock("@seliseblocks/genesis-os/hooks", () => ({
  useGetEnvRepositories: () => ({ data: { data: state.repositories } }),
  useTheme: () => ({ resolvedTheme: state.theme }),
}));
vi.mock("react-router", () => ({ useNavigate: () => state.navigate }));
import MadpPage from "./index";

const renderPage = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    ...render(
      <QueryClientProvider client={client}>
        <MadpPage />
      </QueryClientProvider>,
    ),
    client,
    refresh: () => (
      <QueryClientProvider client={client}>
        <MadpPage />
      </QueryClientProvider>
    ),
  };
};

describe("MADP host frame", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.theme = "light";
    state.project = {
      itemId: "item-1",
      tenantId: "tenant-1",
      tenantGroupId: "group-1",
      name: "Factory",
      environment: "dev",
    };
    state.impersonation = {
      isImpersonated: true,
      impersonatedTenantId: "tenant-1",
      detachedReason: null,
      impersonationError: null,
    };
    state.withSessionLock.mockImplementation((callback: () => Promise<unknown>) =>
      Promise.resolve().then(callback),
    );
    state.refreshSession.mockResolvedValue(undefined);
  });

  it("sends Blocks project, repositories, and theme on load and ready", () => {
    const { rerender, refresh } = renderPage();
    const frame = screen.getByTitle("MADP — Factory") as HTMLIFrameElement;
    expect(frame.getAttribute("src")).toBe("/madp/index.html");
    const post = vi.spyOn(frame.contentWindow!, "postMessage");
    fireEvent.load(frame);
    expect(post).toHaveBeenLastCalledWith(
      {
        type: "blocks:context",
        version: 1,
        project: state.project,
        repositories: state.repositories,
        theme: "light",
      },
      window.location.origin,
    );
    window.dispatchEvent(
      new MessageEvent("message", {
        source: frame.contentWindow,
        origin: window.location.origin,
        data: { type: "madp:ready", version: 1 },
      }),
    );
    expect(post).toHaveBeenCalledTimes(2);
    state.theme = "dark";
    rerender(refresh());
    expect(post.mock.lastCall?.[0]).toMatchObject({ theme: "dark" });
  });

  it("routes only navigation requests from the mounted same-origin frame", () => {
    renderPage();
    const frame = screen.getByTitle("MADP — Factory") as HTMLIFrameElement;
    const send = (
      destination: string,
      source = frame.contentWindow,
      origin = window.location.origin,
    ) =>
      window.dispatchEvent(
        new MessageEvent("message", {
          source,
          origin,
          data: { type: "madp:navigate", version: 1, destination },
        }),
      );
    send("projects", window);
    send("projects", frame.contentWindow, "https://other.example");
    send("unsupported");
    expect(state.navigate).not.toHaveBeenCalled();
    send("projects");
    expect(state.navigate).toHaveBeenLastCalledWith("/app/console");
    send("repositories");
    expect(state.navigate).toHaveBeenLastCalledWith("/app/item-1/repositories");
  });

  it("reads branches through the tenant-scoped Blocks connection and rejects unconnected repositories", async () => {
    state.getBranches.mockResolvedValue([{ name: "main", commit: { sha: "123" } }]);
    const { client } = renderPage();
    const frame = screen.getByTitle("MADP — Factory") as HTMLIFrameElement;
    const post = vi.spyOn(frame.contentWindow!, "postMessage");
    const send = (requestId: string, repository: string) =>
      window.dispatchEvent(
        new MessageEvent("message", {
          source: frame.contentWindow,
          origin: window.location.origin,
          data: { type: "madp:repo-branches", version: 1, requestId, repository },
        }),
      );
    send("blocked", "other/app");
    expect(state.getBranches).not.toHaveBeenCalled();
    expect(post).toHaveBeenLastCalledWith(
      expect.objectContaining({ requestId: "blocked", branches: [], error: expect.any(String) }),
      window.location.origin,
    );
    send("allowed", "org/app");
    await waitFor(() =>
      expect(post).toHaveBeenLastCalledWith(
        {
          type: "blocks:repo-branches",
          version: 1,
          requestId: "allowed",
          branches: [{ name: "main" }],
        },
        window.location.origin,
      ),
    );
    expect(state.getBranches).toHaveBeenCalledWith("org/app", "tenant-1");
    expect(client.getQueryData(["madp", "repo-branches", "tenant-1", "org/app"])).toEqual([
      { name: "main", commit: { sha: "123" } },
    ]);
  });

  it("drops branch replies after the selected tenant changes", async () => {
    let resolveBranches: (branches: { name: string }[]) => void = () => {};
    state.getBranches.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveBranches = resolve;
        }),
    );
    const { rerender, refresh } = renderPage();
    const frame = screen.getByTitle("MADP — Factory") as HTMLIFrameElement;
    const oldPost = vi.spyOn(frame.contentWindow!, "postMessage");
    window.dispatchEvent(
      new MessageEvent("message", {
        source: frame.contentWindow,
        origin: window.location.origin,
        data: { type: "madp:repo-branches", version: 1, requestId: "old", repository: "org/app" },
      }),
    );
    await waitFor(() => expect(state.getBranches).toHaveBeenCalled());
    state.project = { ...state.project, itemId: "item-2", tenantId: "tenant-2" };
    rerender(refresh());
    const newFrame = screen.getByTitle("MADP — Factory") as HTMLIFrameElement;
    const newPost = vi.spyOn(newFrame.contentWindow!, "postMessage");
    await act(async () => {
      resolveBranches([{ name: "old-branch" }]);
    });
    expect(oldPost.mock.calls.some(([message]) => message.type === "blocks:repo-branches")).toBe(
      false,
    );
    expect(newPost.mock.calls.some(([message]) => message.type === "blocks:repo-branches")).toBe(
      false,
    );
  });

  it("deduplicates shared-cookie refreshes and replies without forwarding tokens", async () => {
    let finishRefresh = () => {};
    state.refreshSession.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishRefresh = resolve;
        }),
    );
    renderPage();
    const frame = screen.getByTitle("MADP — Factory") as HTMLIFrameElement;
    const post = vi.spyOn(frame.contentWindow!, "postMessage");
    for (const requestId of ["refresh-1", "refresh-2"]) {
      window.dispatchEvent(
        new MessageEvent("message", {
          source: frame.contentWindow,
          origin: window.location.origin,
          data: { type: "madp:session-refresh", version: 1, requestId, tenantId: "tenant-1" },
        }),
      );
    }
    await waitFor(() => expect(state.refreshSession).toHaveBeenCalledTimes(1));
    expect(state.withSessionLock).toHaveBeenCalledTimes(1);
    await act(async () => {
      finishRefresh();
    });
    expect(post.mock.calls.map(([message]) => message)).toEqual([
      { type: "blocks:session-refresh", version: 1, requestId: "refresh-1", ok: true },
      { type: "blocks:session-refresh", version: 1, requestId: "refresh-2", ok: true },
    ]);
  });

  it("rejects refreshes from sibling frames, other origins, wrong tenants, and detached sessions", () => {
    renderPage();
    const frame = screen.getByTitle("MADP — Factory") as HTMLIFrameElement;
    const post = vi.spyOn(frame.contentWindow!, "postMessage");
    const send = (
      requestId: string,
      tenantId: string,
      source = frame.contentWindow,
      origin = window.location.origin,
    ) =>
      window.dispatchEvent(
        new MessageEvent("message", {
          source,
          origin,
          data: { type: "madp:session-refresh", version: 1, requestId, tenantId },
        }),
      );
    send("sibling", "tenant-1", window);
    send("origin", "tenant-1", frame.contentWindow, "https://other.example");
    expect(post).not.toHaveBeenCalled();
    send("wrong-tenant", "tenant-2");
    state.impersonation.detachedReason = "another-project";
    send("detached", "tenant-1");
    state.impersonation.detachedReason = null;
    state.impersonation.impersonatedTenantId = "tenant-2";
    send("moved", "tenant-1");
    expect(state.withSessionLock).not.toHaveBeenCalled();
    expect(state.refreshSession).not.toHaveBeenCalled();
    expect(post.mock.calls.map(([message]) => message)).toEqual([
      { type: "blocks:session-refresh", version: 1, requestId: "wrong-tenant", ok: false },
      { type: "blocks:session-refresh", version: 1, requestId: "detached", ok: false },
      { type: "blocks:session-refresh", version: 1, requestId: "moved", ok: false },
    ]);
  });

  it("drops refresh replies after a project switch", async () => {
    let finishRefresh = () => {};
    state.refreshSession.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishRefresh = resolve;
        }),
    );
    const { rerender, refresh } = renderPage();
    const frame = screen.getByTitle("MADP — Factory") as HTMLIFrameElement;
    const oldPost = vi.spyOn(frame.contentWindow!, "postMessage");
    window.dispatchEvent(
      new MessageEvent("message", {
        source: frame.contentWindow,
        origin: window.location.origin,
        data: { type: "madp:session-refresh", version: 1, requestId: "old", tenantId: "tenant-1" },
      }),
    );
    await waitFor(() => expect(state.refreshSession).toHaveBeenCalledTimes(1));
    state.project = { ...state.project, itemId: "item-2", tenantId: "tenant-2" };
    state.impersonation.impersonatedTenantId = "tenant-2";
    rerender(refresh());
    const newFrame = screen.getByTitle("MADP — Factory") as HTMLIFrameElement;
    const newPost = vi.spyOn(newFrame.contentWindow!, "postMessage");
    await act(async () => {
      finishRefresh();
    });
    expect(oldPost.mock.calls.some(([message]) => message.type === "blocks:session-refresh")).toBe(
      false,
    );
    expect(newPost.mock.calls.some(([message]) => message.type === "blocks:session-refresh")).toBe(
      false,
    );
  });

  it("checks session ownership after acquiring the refresh lock and reports failure", async () => {
    let runLocked: () => Promise<unknown> = async () => {};
    state.withSessionLock.mockImplementation(
      (callback: () => Promise<unknown>) =>
        new Promise((resolve) => {
          runLocked = async () => resolve(await callback());
        }),
    );
    renderPage();
    const frame = screen.getByTitle("MADP — Factory") as HTMLIFrameElement;
    const post = vi.spyOn(frame.contentWindow!, "postMessage");
    window.dispatchEvent(
      new MessageEvent("message", {
        source: frame.contentWindow,
        origin: window.location.origin,
        data: {
          type: "madp:session-refresh",
          version: 1,
          requestId: "waited",
          tenantId: "tenant-1",
        },
      }),
    );
    state.impersonation.detachedReason = "another-project";
    await act(async () => {
      await runLocked();
    });
    expect(state.refreshSession).not.toHaveBeenCalled();
    expect(post).toHaveBeenLastCalledWith(
      {
        type: "blocks:session-refresh",
        version: 1,
        requestId: "waited",
        ok: false,
      },
      window.location.origin,
    );
  });
});
