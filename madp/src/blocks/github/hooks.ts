// TanStack hooks over the GitHub connection of the signed-in person (whatever implements ./source.ts).
import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "../session";
import { github } from "./source";
import type { GithubConnection, GithubViewer } from "./types";

export const githubKeys = {
  all: (userId: string) => ["github", userId] as const,
  status: (userId: string) => ["github", userId, "status"] as const,
  repos: (userId: string) => ["github", userId, "repos"] as const,
  branches: (userId: string, fullName: string) => ["github", userId, "branches", fullName] as const,
};

/** The signed-in person as the GitHub source sees them; null while signed out. */
export function useGithubViewer(): GithubViewer | null {
  const userId = useSession((s) => s.profile?.userId ?? "");
  const name = useSession((s) => s.profile?.displayName || [s.profile?.firstName, s.profile?.lastName].filter(Boolean).join(" ") || "");
  const email = useSession((s) => s.profile?.email ?? "");
  return useMemo(() => (userId ? { userId, name, email } : null), [userId, name, email]);
}

export function useGithubStatus() {
  const viewer = useGithubViewer();
  return useQuery({
    queryKey: githubKeys.status(viewer?.userId ?? ""),
    queryFn: () => github.status(viewer!),
    enabled: Boolean(viewer),
    staleTime: 5 * 60_000,
  });
}

function useSetStatus() {
  const qc = useQueryClient();
  const viewer = useGithubViewer();
  return (c: GithubConnection) => {
    if (!viewer) return;
    // a new or ended connection changes what the person can see: forget the repositories and branches read before
    qc.removeQueries({ queryKey: githubKeys.repos(viewer.userId) });
    qc.removeQueries({ queryKey: ["github", viewer.userId, "branches"] });
    qc.setQueryData(githubKeys.status(viewer.userId), c);
  };
}

export function useConnectGithub() {
  const viewer = useGithubViewer();
  const set = useSetStatus();
  return useMutation({
    mutationFn: () => {
      if (!viewer) throw new Error("Sign in first.");
      return github.connect(viewer);
    },
    onSuccess: set,
  });
}

export function useDisconnectGithub() {
  const viewer = useGithubViewer();
  const set = useSetStatus();
  return useMutation({
    mutationFn: () => {
      if (!viewer) throw new Error("Sign in first.");
      return github.disconnect(viewer);
    },
    onSuccess: set,
  });
}

export function useGithubRepos(enabled = true) {
  const viewer = useGithubViewer();
  const status = useGithubStatus();
  return useQuery({
    queryKey: githubKeys.repos(viewer?.userId ?? ""),
    queryFn: () => github.repos(viewer!),
    enabled: enabled && Boolean(viewer) && status.data?.connected === true,
    staleTime: 60_000,
  });
}

export function useGithubBranches(repo: { owner: string; name: string } | null) {
  const viewer = useGithubViewer();
  const status = useGithubStatus();
  return useQuery({
    queryKey: githubKeys.branches(viewer?.userId ?? "", repo ? `${repo.owner}/${repo.name}` : ""),
    queryFn: () => github.branches(viewer!, repo!.owner, repo!.name),
    enabled: Boolean(viewer && repo) && status.data?.connected === true,
    staleTime: 60_000,
  });
}
