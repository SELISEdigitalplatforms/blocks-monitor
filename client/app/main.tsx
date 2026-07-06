import "./lib/resolve-env";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { NuqsAdapter } from "nuqs/adapters/react-router/v6";
import { Toaster, TooltipProvider } from "@/components/core";
import { ThemeProvider } from "@/hooks/use-theme";
import QueryProvider from "@/providers/query-provider";
import { router } from "./router";
import "./styles/globals.css";
import { BlocksAppLayout } from "@seliseblocks/blocks-kit/layouts";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
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
              }}>
              <RouterProvider router={router} />
            </BlocksAppLayout>
            <Toaster />
          </NuqsAdapter>
        </TooltipProvider>
      </ThemeProvider>
    </QueryProvider>
  </StrictMode>,
);
