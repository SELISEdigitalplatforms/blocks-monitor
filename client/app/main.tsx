import { Toaster, TooltipProvider } from "@/components/core";
import QueryProvider from "@/providers/query-provider";
import "@/styles/globals.css";
import "@seliseblocks/blocks-kit/lib";
import { BlocksAppLayout, ThemeProvider } from "@seliseblocks/blocks-kit/providers";
import { NuqsAdapter } from "nuqs/adapters/react-router/v6";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { router } from "./router";

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
              }}
            >
              <RouterProvider router={router} />
            </BlocksAppLayout>
            <Toaster />
          </NuqsAdapter>
        </TooltipProvider>
      </ThemeProvider>
    </QueryProvider>
  </StrictMode>,
);
