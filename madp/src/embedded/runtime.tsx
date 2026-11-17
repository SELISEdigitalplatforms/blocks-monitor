import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { queryClient } from "@/blocks/queryClient";
import { startI18n } from "@/i18n/language";
import { bindIdentity } from "@/state/identity";
import { startShellBridge } from "./context";
import { UnifiedApp } from "./UnifiedApp";
import "@/styles/index.css";
import "./embedded.css";

startI18n();
bindIdentity();
startShellBridge();

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <MemoryRouter><UnifiedApp /></MemoryRouter>
  </QueryClientProvider>,
);
