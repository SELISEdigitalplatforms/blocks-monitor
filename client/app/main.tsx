import { Toaster, TooltipProvider } from "@/components/core";
import { SERVICE_NAME } from "@/constants/service.constant";
import QueryProvider, { getQueryClient } from "@/providers/query-provider";
import "@/styles/globals.css";
import "@seliseblocks/genesis-os/lib";
import {
  RollbarProvider,
  attachQueryErrorReporting,
  getRollbar,
} from "@seliseblocks/genesis-os/observability";
import { BlocksAppLayout, ThemeProvider } from "@seliseblocks/genesis-os/providers";
import { NuqsAdapter } from "nuqs/adapters/react-router/v8";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router/dom";
import { router } from "./router";

// This app builds its own QueryClient, so RollbarProvider's automatic wiring would instrument the
// package's client - which nothing here renders - and query/mutation functions would report
// nothing, silently. Attach the reporter to the client QueryProvider actually uses instead.
// Module scope: runs once, and the client lives as long as the app, so the returned unsubscribe
// is never needed.
attachQueryErrorReporting(getQueryClient(), getRollbar({ service: SERVICE_NAME }));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* Outermost, above the query, theme and router providers, so a throw during their own setup
        is still caught and reported rather than blanking the page. */}
    <RollbarProvider service={SERVICE_NAME}>
      <QueryProvider>
        <ThemeProvider>
          <TooltipProvider>
            <NuqsAdapter>
              <BlocksAppLayout
                config={{
                  appLogoUrl: {
                    dark: "/Logo_Dark.svg",
                    light: "/Logo_Light.svg",
                  },
                  name: "blocks-monitor",
                }}
              >
                <RouterProvider router={router} />
              </BlocksAppLayout>
              <Toaster />
            </NuqsAdapter>
          </TooltipProvider>
        </ThemeProvider>
      </QueryProvider>
    </RollbarProvider>
  </StrictMode>,
);
