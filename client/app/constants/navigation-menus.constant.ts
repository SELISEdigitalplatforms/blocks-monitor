import type { Menu } from "@seliseblocks/genesis-os/types";
import { Activity, FolderGit2, Home, Mail, Package } from "lucide-react";

// Built per call so the labels follow the chosen language.
export const getNavigationMenus = (t: (key: string) => string): Menu[] => [
  {
    id: "overview-project",
    type: "menu",
    name: t("NAVIGATION_MENUS.OVERVIEW"),
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
    name: t("NAVIGATION_MENUS.MONITOR"),
    path: "/app/monitor",
    icon: Activity,
  },
  {
    id: "alert-recipients",
    type: "menu",
    name: t("NAVIGATION_MENUS.ALERT_RECIPIENTS"),
    path: "/app/alert-recipients",
    icon: Mail,
  },
  {
    id: "repos",
    type: "menu",
    name: t("NAVIGATION_MENUS.REPOS"),
    path: "/app/repos",
    icon: FolderGit2,
  },
  {
    id: "environments",
    type: "menu",
    name: t("NAVIGATION_MENUS.ENVIRONMENTS"),
    path: "/app/project/environments",
    icon: Package,
  },
];
