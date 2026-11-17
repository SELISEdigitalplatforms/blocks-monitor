import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { queryClient } from "./blocks/queryClient";
import { startProjectStartupPrefetch } from "./components/project/startupPrefetch";
import { restoreSession } from "./blocks/session";
import { startI18n } from "./i18n/language";
import { bindProfileLanguage } from "./i18n/profileLanguage";
import { startWorkspaceSync } from "./blocks/workspaces/sync";
import { startSessionFreshness } from "./blocks/sessionFreshness";
import { bindIdentity } from "./state/identity";
import "./styles/index.css";

startI18n();
bindProfileLanguage();
bindIdentity();
startProjectStartupPrefetch();
startWorkspaceSync();
startSessionFreshness();
void restoreSession();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
