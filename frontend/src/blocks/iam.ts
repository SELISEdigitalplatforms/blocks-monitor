// Roles and permissions in Blocks OS IAM for the Platform management sections: where they are read from, the IAM sync,
// the roles IAM holds and one person's IAM roles per organization. Every check happens in the admin function
// (functions/admin/ops/iam); these hooks only call it and refresh what changed.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { callFunction, newRequestId } from "./fn";
import { useSession } from "./session";
import { adminMounted } from "./config";
import { adminErrorMessage } from "./admin";
import { meKeys } from "./workspaces/queries";
import { refreshSessionAccess } from "./sessionFreshness";

export type RbacSource = "factory" | "iam";
export type IamRoleScope = "platform" | "template" | "organization";

export interface IamStatus {
  source: RbacSource;
  canSync: boolean;
  available: boolean;
  unavailable: null | "not-connected" | "unreachable" | "refused";
  counts: { permissions: number; roles: number; organizations: number } | null;
  drift: { permissions: number; roles: number; organizations: number; total: number } | null;
  sync: { checkedAt?: string; drift?: number; syncedAt?: string; syncedBy?: string; applied?: number; failed?: number } | null;
  parity: { at?: string; ok?: boolean; mismatches?: number; url?: string } | null;
}

export interface IamRole {
  slug: string;
  scope: IamRoleScope;
  key: string;
  builtIn: boolean;
  workspaceId: string | null;
  workspaceName: string | null;
  name: string;
  description: string;
  permissions: string[];
}

export interface IamPersonAccess {
  userId: string;
  platformRoles: string[];
  organizations: {
    workspaceId: string;
    workspaceName: string;
    workspaceStatus: string;
    organizationId: string | null;
    membershipId: string | null;
    iamRoles: string[];
    factoryRole: string | null;
    inStep: boolean;
  }[];
  unlinked: { organizationId: string; roles: string[] }[];
}

export interface IamGrantLine { userId: string; email: string; workspaceId?: string; organizationId?: string; roles: string[] }
export interface IamPlan {
  direction: "factory-to-iam" | "fill-missing";
  permissions: { create: string[] };
  roles: { create: { slug: string; name: string }[]; update: { slug: string; name: string; add: string[]; remove: string[] }[]; onlyInIam: string[] };
  organizations: { create: { workspaceId: string; name: string }[] };
  grants: { add: IamGrantLine[]; remove: IamGrantLine[]; peopleChecked: number; peopleNotChecked: number };
  drift: number;
}
export interface IamSyncAnswer { dryRun: boolean; source: RbacSource; plan: IamPlan; applied: number; failed: number }

const uidNow = () => useSession.getState().profile?.userId ?? "";
export const iamKeys = {
  status: (uid: string) => meKeys.admin(uid, "iam.status"),
  roles: (uid: string) => meKeys.admin(uid, "iam.roles.list"),
  access: (uid: string, userId: string) => meKeys.admin(uid, "iam.access.get", { userId }),
};

function useAdminRead<T>(key: readonly unknown[], op: string, args: Record<string, unknown>, enabled: boolean, staleTime: number) {
  const uid = useSession((s) => s.profile?.userId ?? null);
  return useQuery({
    queryKey: key,
    queryFn: async () => (await callFunction<T>("admin", op, args)).data,
    enabled: enabled && adminMounted() && Boolean(uid),
    staleTime,
    refetchOnWindowFocus: false,
    retry: 0,
  });
}

/** iam.status: the source of roles and permissions and the IAM sync state. */
export function useIamStatus(enabled = true) {
  const uid = useSession((s) => s.profile?.userId ?? "");
  return useAdminRead<IamStatus>(iamKeys.status(uid), "iam.status", {}, enabled, 30_000);
}

/** iam.roles.list: the Factory's roles as Blocks OS IAM holds them. */
export function useIamRoles(enabled = true) {
  const uid = useSession((s) => s.profile?.userId ?? "");
  return useAdminRead<{ roles: IamRole[] }>(iamKeys.roles(uid), "iam.roles.list", {}, enabled, 30_000);
}

/** iam.access.get: one person's roles in Blocks OS IAM (audited). */
export function useIamAccess(userId: string | null, enabled = true) {
  const uid = useSession((s) => s.profile?.userId ?? "");
  return useAdminRead<IamPersonAccess>(iamKeys.access(uid, userId ?? ""), "iam.access.get", { userId }, enabled && Boolean(userId), 60_000);
}

function useIamWrite<TArgs extends Record<string, unknown>, R = unknown>(op: string, refresh: (args: TArgs) => readonly (readonly unknown[])[]) {
  const client = useQueryClient();
  return useMutation<R, Error, TArgs>({
    mutationFn: async (args) => {
      try {
        return (await callFunction<R>("admin", op, args, { requestId: newRequestId() })).data;
      } catch (e) {
        throw new Error(adminErrorMessage(e));
      }
    },
    retry: 0,
    onSuccess: async (_d, args) => {
      // every IAM write can change platform access (a role's permissions, who holds it, the roles source): the signed-in
      // person's own profile and permissions are read again at once
      void refreshSessionAccess();
      for (const queryKey of refresh(args)) await client.invalidateQueries({ queryKey });
    },
  });
}

const rolesAndStatus = () => [
  iamKeys.roles(uidNow()), iamKeys.status(uidNow()), meKeys.admin(uidNow(), "platformRole.list"), meKeys.admin(uidNow(), "audit.list"),
];

export type IamRoleSaveArgs = { scope: IamRoleScope; key: string; name: string; description: string; permissions: string[]; workspaceId?: string };
export const useSaveIamRole = () => useIamWrite<IamRoleSaveArgs>("iam.roles.save", rolesAndStatus);
export const useDeleteIamRole = () => useIamWrite<{ scope: IamRoleScope; key: string; workspaceId?: string }>("iam.roles.delete", rolesAndStatus);

export type IamAccessSetArgs = { userId: string; workspaceId?: string; roleKeys: string[] };
export type IamAccessSetAnswer = { factory?: { membershipId: string; roleKey: string; needsUpdate: boolean }; factoryInStep?: boolean };
export const useSetIamAccess = () =>
  useIamWrite<IamAccessSetArgs, IamAccessSetAnswer>("iam.access.set", (a) => [
    iamKeys.access(uidNow(), a.userId), iamKeys.status(uidNow()), meKeys.admin(uidNow(), "people.access"),
    meKeys.admin(uidNow(), "platformRole.list"), meKeys.admin(uidNow(), "audit.list"),
  ]);

/** iam.sync.run: dryRun answers the plan only (Check); without it the plan is applied (Sync now, platform admins). */
export const useIamSync = () =>
  useIamWrite<{ dryRun: boolean }, IamSyncAnswer>("iam.sync.run", () => [iamKeys.status(uidNow()), iamKeys.roles(uidNow()), meKeys.admin(uidNow(), "audit.list")]);

export const useSetRbacSource = () =>
  useIamWrite<{ source: RbacSource }, { source: RbacSource }>("iam.source.set", () => [iamKeys.status(uidNow()), iamKeys.roles(uidNow()), meKeys.admin(uidNow(), "audit.list")]);
