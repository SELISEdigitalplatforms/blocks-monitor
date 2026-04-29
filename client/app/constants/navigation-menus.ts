import { Activity } from "lucide-react";
import { Menu } from "@/models/menu-models";

export const navigationMenus: Menu[] = [
  {
    id: "health",
    type: "menu",
    name: "Health",
    path: "/health",
    icon: Activity,
  },
];
