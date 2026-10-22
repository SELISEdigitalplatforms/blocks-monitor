import type { ReactNode } from "react";
import { AppShell as SharedAppShell } from "@seliseblocks/app-kit";
import {
  CommandPaletteProvider,
  useCommandPalette,
} from "@/components/command-palette/command-palette-provider";
import { useMonitorNavigation } from "@/hooks/use-monitor-navigation";

type AppShellProps = { children: ReactNode; sidebar?: boolean };

function MonitorShell(props: AppShellProps) {
  const sections = useMonitorNavigation();
  const openPalette = useCommandPalette();
  return <SharedAppShell {...props} sections={sections} onOpenCommand={() => openPalette(true)} />;
}

export function AppShell(props: AppShellProps) {
  return (
    <CommandPaletteProvider>
      <MonitorShell {...props} />
    </CommandPaletteProvider>
  );
}
