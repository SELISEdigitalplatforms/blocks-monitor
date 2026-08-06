import type { Menu } from "@seliseblocks/genesis-os/types";
import { Activity, Home, Package } from "lucide-react";

export const navigationMenus: Menu[] = [
  {
    id: "overview-project",
    type: "menu",
    name: "Overview",
    path: "/app/dashboard",
    icon: Home,
  },
  {
    type: "separator",
    id: "separator-identity",
  },
  {
    id: "monitor",
    type: "menu",
    name: "Monitor",
    path: "/app/monitor",
    icon: Activity,
  },
  {
    id: "environments",
    type: "menu",
    name: "Environments",
    path: "/app/project/environments",
    icon: Package,
  },
];
