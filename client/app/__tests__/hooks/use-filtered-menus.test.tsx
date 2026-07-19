import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useFilteredMenus } from "@/hooks/use-filtered-menus";
import type { Menu } from "@/models/menu.model";

const menus: Menu[] = [
  { id: "a", type: "menu", name: "A", path: "/a" } as Menu,
  { id: "sep", type: "separator" } as Menu,
  { id: "b", type: "menu", name: "B", path: "/b", disabled: true } as Menu,
  { id: "c", type: "menu", name: "C", path: "/c" } as Menu,
];

describe("useFilteredMenus", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("filters out separators and disabled items", () => {
    const { result } = renderHook(() => useFilteredMenus(menus));
    const ids = result.current.map((m) => m.id);
    expect(ids).toEqual(["a", "c"]);
  });

  it("filters out ids listed in BLOCKS_BLOCKED_MENU", () => {
    vi.stubEnv("BLOCKS_BLOCKED_MENU", JSON.stringify(["c"]));
    const { result } = renderHook(() => useFilteredMenus(menus));
    expect(result.current.map((m) => m.id)).toEqual(["a"]);
  });

  it("tolerates malformed BLOCKS_BLOCKED_MENU JSON", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("BLOCKS_BLOCKED_MENU", "not-json");
    const { result } = renderHook(() => useFilteredMenus(menus));
    expect(result.current.map((m) => m.id)).toEqual(["a", "c"]);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
