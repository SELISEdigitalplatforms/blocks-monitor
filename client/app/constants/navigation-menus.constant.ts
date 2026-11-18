import type { Menu } from "@seliseblocks/genesis-os/types";
import {
  Home,
  LayoutDashboard,
  FileText,
  Hammer,
  Rocket,
  BookOpen,
  Settings,
  Package,
} from "lucide-react";

// User is already inside a Blocks project. MADP menus start from the workflow steps,
// not project creation (Blocks handles project/environment management).
export const getNavigationMenus = (_t: (key: string) => string): Menu[] => [
  {
    id: "overview-project",
    type: "menu",
    name: "Overview",
    path: "/app/dashboard",
    icon: Home,
  },
  {
    type: "separator",
    id: "separator-madp",
  },
  {
    id: "madp-home",
    type: "menu",
    name: "Home",
    path: "/app/home",
    icon: LayoutDashboard,
  },
  {
    id: "madp-analysis",
    type: "menu",
    name: "Analysis",
    path: "/app/analysis",
    icon: FileText,
  },
  {
    id: "madp-build",
    type: "menu",
    name: "Build",
    path: "/app/build",
    icon: Hammer,
  },
  {
    id: "madp-release",
    type: "menu",
    name: "Release",
    path: "/app/release",
    icon: Rocket,
  },
  {
    id: "madp-wiki",
    type: "menu",
    name: "Wiki",
    path: "/app/wiki",
    icon: BookOpen,
  },
  {
    type: "separator",
    id: "separator-settings",
  },
  {
    id: "madp-settings",
    type: "menu",
    name: "Settings",
    path: "/app/settings",
    icon: Settings,
  },
  {
    id: "environments",
    type: "menu",
    name: "Environments",
    path: "/app/project/environments",
    icon: Package,
  },
];
