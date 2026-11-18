/**
 * MadpBridgeProvider: wraps MADP pages inside the Blocks shell.
 * Initializes auth/workspace bridges, provides MADP's own QueryClient,
 * and mounts MADP overlay hosts (setup windows, toasts, guided start).
 */
import { lazy, Suspense, useEffect, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { startAuthBridge, stopAuthBridge, startWorkspaceBridge, stopWorkspaceBridge } from "./bridge";

// Lazy-load MADP overlay hosts so they don't block initial render
const SetupWindowsHost = lazy(() =>
  import("./components/setup/SetupWindowsHost").then((m) => ({ default: m.SetupWindowsHost }))
);

// MADP gets its own QueryClient to avoid key collisions with the Blocks shell's queries.
const madpQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: 1,
      refetchOnWindowFocus: true,
    },
  },
});

interface MadpBridgeProviderProps {
  children: ReactNode;
}

export function MadpBridgeProvider({ children }: MadpBridgeProviderProps) {
  useEffect(() => {
    startAuthBridge();
    startWorkspaceBridge();

    return () => {
      stopAuthBridge();
      stopWorkspaceBridge();
    };
  }, []);

  return (
    <QueryClientProvider client={madpQueryClient}>
      <div className="madp-scope">
        {children}
        {/* MADP overlay hosts — setup windows, guided start, etc. */}
        <Suspense fallback={null}>
          <SetupWindowsHost />
        </Suspense>
      </div>
    </QueryClientProvider>
  );
}
