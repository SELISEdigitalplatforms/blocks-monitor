import type { Menu } from "@seliseblocks/genesis-os/types";
import { FolderGit2, Home, Package, Sparkles } from "lucide-react";

// Built per call so the labels follow the chosen language.
export const getNavigationMenus = (t: (key: string) => string): Menu[] => [
  {
    id: "madp",
    type: "menu",
    name: "MADP",
    path: "/app/madp",
    icon: Sparkles,
  },
  {
    type: "separator",
    id: "separator-identity",
  },
  {
    id: "blocks-overview",
    type: "menu",
    name: t("NAVIGATION_MENUS.OVERVIEW"),
    path: "/app/overview",
    icon: Home,
  },
  {
    id: "repos",
    type: "menu",
    name: t("NAVIGATION_MENUS.REPOS"),
    path: "/app/repositories",
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
