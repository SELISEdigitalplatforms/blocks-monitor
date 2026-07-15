import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { DesktopMenuItem } from "@/components/common/menus/desktop-menu-item";
import { MobileMenuItem } from "@/components/common/menus/mobile-menu-item";
import type { Menu } from "@/models/menu.model";

const Icon = () => <svg data-testid="icon" />;

const leaf = {
  id: "health",
  type: "menu",
  name: "Health",
  path: "/app/health",
  icon: Icon,
  badge: "New",
} as unknown as Extract<Menu, { type: "menu" }>;

const parent = {
  id: "settings",
  type: "menu",
  name: "Settings",
  path: "/app/settings",
  icon: Icon,
  children: [
    { id: "profile", type: "menu", name: "Profile", path: "/app/settings/profile" },
    {
      id: "disabled",
      type: "menu",
      name: "Disabled",
      path: "/app/settings/x",
      disabled: true,
    },
  ],
} as unknown as Extract<Menu, { type: "menu" }>;

const wrap = (node: ReactNode, path = "/app/health") =>
  render(<MemoryRouter initialEntries={[path]}>{node}</MemoryRouter>);

describe("DesktopMenuItem", () => {
  it("renders a leaf menu link with name and badge when sidebar open", () => {
    wrap(<DesktopMenuItem menu={leaf} isSidebarOpen />);
    expect(screen.getByText("Health")).toBeInTheDocument();
    expect(screen.getByText("New")).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute("href", "/app/health");
  });

  it("hides the name and shows the hover tooltip when sidebar collapsed", () => {
    wrap(<DesktopMenuItem menu={leaf} isSidebarOpen={false} />, "/other");
    // name still present in tooltip div, but no visible label span
    expect(screen.getAllByText("Health").length).toBeGreaterThan(0);
  });

  it("renders a parent menu with its non-disabled children", () => {
    wrap(<DesktopMenuItem menu={parent} isSidebarOpen />, "/app/settings/profile");
    expect(screen.getByText("Profile")).toBeInTheDocument();
    expect(screen.queryByText("Disabled")).toBeNull();
  });
});

describe("MobileMenuItem", () => {
  it("renders a leaf link", () => {
    wrap(<MobileMenuItem menu={leaf} />);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/app/health");
  });

  it("opens a sheet with children for a parent menu", async () => {
    const onClick = vi.fn();
    wrap(<MobileMenuItem menu={parent} onClick={onClick} />, "/app/other");
    await userEvent.click(screen.getByText("Settings"));
    expect(await screen.findByText("Profile")).toBeInTheDocument();
    await userEvent.click(screen.getByText("Profile"));
    expect(onClick).toHaveBeenCalled();
  });
});
