/**
 * Auth bridge: subscribes to genesis-os auth stores and populates MADP's useSession store.
 * This replaces MADP's restoreSession() / signIn() / signOut() chain entirely.
 */
import { useAuthStore, useProjectStore } from "@seliseblocks/genesis-os/store";
import { useSession, SUPER_ADMIN_ROLE, USER_ROLE, type BlocksProfile } from "../blocks/session";

function mapProfile(user: { id?: string; userId?: string; email?: string; name?: string; firstName?: string; lastName?: string; roles?: string[] }): BlocksProfile {
  const firstName = user.firstName || user.name?.split(" ")[0] || "";
  const lastName = user.lastName || user.name?.split(" ").slice(1).join(" ") || "";
  const roles = user.roles || [USER_ROLE];
  return {
    userId: user.id || user.userId || "",
    email: user.email || "",
    firstName,
    lastName,
    displayName: user.name || `${firstName} ${lastName}`.trim() || user.email || "",
    roles,
    permissions: [],
    isSuperAdmin: true, // Blocks users get full MADP access
  };
}

let unsubAuth: (() => void) | null = null;

export function startAuthBridge() {
  if (unsubAuth) return;

  // Expose the genesis-os auth store on window so MADP's client.ts can read the token
  (window as Record<string, unknown>).__GENESIS_AUTH_STORE__ = useAuthStore;

  // Sync immediately with current state
  syncAuthState();

  // Subscribe to future changes
  unsubAuth = useAuthStore.subscribe(syncAuthState);
}

function syncAuthState() {
  const { isAuthenticated, user, accessToken } = useAuthStore.getState();

  if (isAuthenticated && user && accessToken) {
    const profile = mapProfile(user as Record<string, unknown>);
    useSession.setState({ status: "signed-in", profile, notice: null });
  } else {
    const current = useSession.getState();
    if (current.status !== "restoring" || current.profile !== null) {
      useSession.setState({ status: "signed-out", profile: null, notice: null });
    }
  }
}

export function stopAuthBridge() {
  if (unsubAuth) {
    unsubAuth();
    unsubAuth = null;
  }
}

/** Returns the current genesis-os access token for use by MADP's Blocks SDK client. */
export function getGenesisAccessToken(): string | undefined {
  return useAuthStore.getState().accessToken ?? undefined;
}
