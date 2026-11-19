/**
 * MadpBridgeProvider: wraps MADP pages inside the Blocks shell.
 * Initializes auth/workspace bridges, provides MADP's own QueryClient,
 * and mounts MADP overlay hosts (setup windows, toasts, guided start).
 */
import { lazy, Suspense, useEffect, type ReactNode } from "react";
import { useParams } from "react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { startAuthBridge, stopAuthBridge, startWorkspaceBridge, stopWorkspaceBridge } from "./bridge";
import { BlocksProjectProvider } from "./bridge/blocksProject";
// Use MADP's own queryClient so livePoll, data transport, and React hooks all share the same cache.
import { queryClient as madpQueryClient } from "./blocks/queryClient";
import { setPathPrefix } from "./lib/pathPrefix";

// Lazy-load MADP overlay hosts so they don't block initial render
const SetupWindowsHost = lazy(() =>
  import("./components/setup/SetupWindowsHost").then((m) => ({ default: m.SetupWindowsHost }))
);

interface MadpBridgeProviderProps {
  children: ReactNode;
}

export function MadpBridgeProvider({ children }: MadpBridgeProviderProps) {
  // Read :itemId from the Blocks shell route (/app/:itemId/...) and set the MADP path prefix
  const { itemId } = useParams<{ itemId: string }>();
  useEffect(() => {
    if (itemId) {
      setPathPrefix(`/app/${itemId}`);
      (window as unknown as Record<string, unknown>).__BLOCKS_ITEM_ID__ = itemId;
    }
    return () => {
      setPathPrefix("");
      delete (window as unknown as Record<string, unknown>).__BLOCKS_ITEM_ID__;
    };
  }, [itemId]);

  useEffect(() => {
    startAuthBridge();
    startWorkspaceBridge();

    // Claim the MADP data cache for the current user so queries are associated correctly
    try {
      const store = (window as unknown as Record<string, unknown>).__GENESIS_AUTH_STORE__;
      if (store && typeof store === "object" && "getState" in store) {
        const state = (store as { getState: () => Record<string, unknown> }).getState();
        const userId = state.user && typeof state.user === "object" ? (state.user as Record<string, unknown>).id as string : undefined;
        if (userId) {
          import("./blocks/queryClient").then(({ claimCacheFor }) => claimCacheFor(userId)).catch(() => {});
        }
      }
    } catch { /* ignore */ }

    return () => {
      stopAuthBridge();
      stopWorkspaceBridge();
    };
  }, []);

  return (
    <QueryClientProvider client={madpQueryClient}>
      <BlocksProjectProvider blocksProjectId={itemId ?? ""}>
        <div className="madp-scope">
          {children}
          {/* MADP overlay hosts — setup windows, guided start, etc. */}
          <Suspense fallback={null}>
            <SetupWindowsHost />
          </Suspense>
        </div>
      </BlocksProjectProvider>
    </QueryClientProvider>
  );
}
