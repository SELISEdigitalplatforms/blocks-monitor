import { useMemo } from "react";
import { useParams } from "react-router";
import { useFilteredMenus, type PaletteNavSection } from "@seliseblocks/app-kit";
import { navigationMenus } from "@/constants/navigation-menus.constant";

/** Console's /app/project subtree is not scoped to an environment, as app-kit's DashboardRoute did. */
const UNSCOPED_PREFIXES = ["/app/project"];

/** The sidebar and command menu share the same filtered, URL-scoped destinations. */
export function useMonitorNavigation(): PaletteNavSection[] {
  const { itemId } = useParams();
  const menus = useFilteredMenus(navigationMenus);

  return useMemo(() => {
    if (!itemId) return [];
    const items = menus.flatMap((menu) =>
      menu.type === "menu"
        ? [
            {
              ...menu,
              path: UNSCOPED_PREFIXES.some((prefix) => menu.path.startsWith(prefix))
                ? menu.path
                : menu.path.replace(/^\/app\//, `/app/${itemId}/`),
            },
          ]
        : [],
    );
    return [
      { id: "overview", items: items.filter((item) => item.id === "overview-project") },
      {
        id: "monitor",
        label: "Monitor",
        items: items.filter((item) => item.id !== "overview-project"),
      },
    ].filter((section) => section.items.length > 0);
  }, [itemId, menus]);
}
