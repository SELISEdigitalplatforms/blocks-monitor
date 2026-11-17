import { githubInfoService } from "@/services/github-info.service";
import { useQueryClient } from "@tanstack/react-query";
import { useGetEnvRepositories, useTheme } from "@seliseblocks/genesis-os/hooks";
import { useT } from "@seliseblocks/genesis-os/i18n";
import { iamClient } from "@seliseblocks/genesis-os/lib";
import { useImpersonateStore, useProjectStore } from "@seliseblocks/genesis-os/store";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router";
import {
  MADP_BRIDGE_VERSION,
  isConnectedRepository,
  readMadpMessage,
  type BlocksContextMessage,
  type BlocksRepositoryBranchesMessage,
  type BlocksSessionRefreshMessage,
} from "./protocol";

export default function MadpPage() {
  const { t } = useT("monitor.repos");
  const project = useProjectStore((state) => state.selectedProject);
  const { data: repositoryResponse } = useGetEnvRepositories(project?.tenantId ?? "");
  const { resolvedTheme } = useTheme();
  const frame = useRef<HTMLIFrameElement>(null);
  const refreshes = useRef(new Map<string, Promise<boolean>>());
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const context = useMemo<BlocksContextMessage | null>(
    () =>
      project
        ? {
            type: "blocks:context",
            version: MADP_BRIDGE_VERSION,
            project: {
              itemId: project.itemId,
              tenantId: project.tenantId,
              tenantGroupId: project.tenantGroupId,
              name: project.name,
              environment: project.environment,
            },
            repositories: (repositoryResponse?.data ?? []).map(({ itemId, repoName, repoUrl }) => ({
              itemId,
              repoName,
              repoUrl,
            })),
            theme: resolvedTheme,
          }
        : null,
    [project, repositoryResponse, resolvedTheme],
  );
  const currentContext = useRef(context);
  useLayoutEffect(() => { currentContext.current = context; }, [context]);

  const sendContext = useCallback(() => {
    if (context) frame.current?.contentWindow?.postMessage(context, window.location.origin);
  }, [context]);

  useEffect(() => {
    const sessionMatches = (tenantId: string) => {
      const session = useImpersonateStore.getState();
      return (
        currentContext.current?.project.tenantId === tenantId &&
        useProjectStore.getState().selectedProject?.tenantId === tenantId &&
        session.isImpersonated &&
        session.impersonatedTenantId === tenantId &&
        !session.detachedReason &&
        !session.impersonationError
      );
    };
    const receive = (event: MessageEvent) => {
      const message = readMadpMessage(event, frame.current?.contentWindow, window.location.origin);
      if (!message) return;
      if (message.type === "madp:session-refresh") {
        const target = frame.current?.contentWindow;
        const tenantId = currentContext.current?.project.tenantId;
        if (!target || !tenantId) return;
        const respond = (ok: boolean) => {
          if (
            frame.current?.contentWindow !== target ||
            currentContext.current?.project.tenantId !== tenantId ||
            useProjectStore.getState().selectedProject?.tenantId !== tenantId
          )
            return;
          const response: BlocksSessionRefreshMessage = {
            type: "blocks:session-refresh",
            version: MADP_BRIDGE_VERSION,
            requestId: message.requestId,
            ok: ok && sessionMatches(tenantId),
          };
          target.postMessage(response, window.location.origin);
        };
        if (message.tenantId !== tenantId || !sessionMatches(tenantId)) {
          respond(false);
          return;
        }
        let pending = refreshes.current.get(tenantId);
        if (!pending) {
          pending = iamClient
            .withSessionLock(async () => {
              // The lock may have waited behind a project switch in another tab.
              if (!sessionMatches(tenantId)) return false;
              await iamClient.refreshWithinSessionLock();
              return sessionMatches(tenantId);
            })
            .catch(() => false);
          const refresh = pending;
          refreshes.current.set(tenantId, refresh);
          void refresh.finally(() => {
            if (refreshes.current.get(tenantId) === refresh) refreshes.current.delete(tenantId);
          });
        }
        void pending.then(respond);
      } else if (message.type === "madp:repo-branches") {
        const requestedContext = currentContext.current;
        const target = frame.current?.contentWindow;
        if (!requestedContext || !target) return;
        const tenantId = requestedContext.project.tenantId;
        const respond = (branches: BlocksRepositoryBranchesMessage["branches"], error?: string) => {
          const latest = currentContext.current;
          if (frame.current?.contentWindow !== target || latest?.project.tenantId !== tenantId)
            return;
          if (!error && !isConnectedRepository(message.repository, latest.repositories)) return;
          const response: BlocksRepositoryBranchesMessage = {
            type: "blocks:repo-branches",
            version: MADP_BRIDGE_VERSION,
            requestId: message.requestId,
            branches,
            ...(error ? { error } : {}),
          };
          target.postMessage(response, window.location.origin);
        };
        if (!isConnectedRepository(message.repository, requestedContext.repositories)) {
          respond([], "This repository is not connected to the selected Blocks project.");
          return;
        }
        void queryClient
          .fetchQuery({
            queryKey: ["madp", "repo-branches", tenantId, message.repository],
            queryFn: () => githubInfoService.getGithubBranches(message.repository, tenantId),
            staleTime: 30_000,
            retry: false,
          })
          .then(
            (branches) => respond(branches.map(({ name }) => ({ name }))),
            () => respond([], "Could not load branches from the Blocks repository connection."),
          );
      } else if (message.type === "madp:ready") sendContext();
      else if (message.destination === "projects") navigate("/app/console");
      else if (project) navigate(`/app/${encodeURIComponent(project.itemId)}/repositories`);
    };
    window.addEventListener("message", receive);
    sendContext();
    return () => window.removeEventListener("message", receive);
  }, [navigate, project, queryClient, sendContext]);

  if (!project)
    return <p className="p-6 text-muted-foreground">{t("MADP_HOST.SELECT_PROJECT")}</p>;

  return (
    <iframe
      key={project.tenantId}
      ref={frame}
      src="/madp/index.html"
      title={t("MADP_HOST.FRAME_TITLE", { name: project.name })}
      className="block h-full min-h-[32rem] w-full border-0"
      onLoad={sendContext}
      allow="clipboard-write"
    />
  );
}
