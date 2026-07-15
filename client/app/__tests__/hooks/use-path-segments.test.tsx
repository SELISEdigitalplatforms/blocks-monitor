import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import useRoutePathSegments from "@/hooks/use-path-segments";

const wrapper =
  (path: string) =>
  ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>
  );

describe("useRoutePathSegments", () => {
  it("returns an empty list for the root path", () => {
    const { result } = renderHook(() => useRoutePathSegments(), {
      wrapper: wrapper("/"),
    });
    expect(result.current).toEqual([]);
  });

  it("builds cumulative hrefs and title-cased labels", () => {
    const { result } = renderHook(() => useRoutePathSegments(), {
      wrapper: wrapper("/app/health-check/details"),
    });
    expect(result.current).toEqual([
      { href: "/app", label: "App" },
      { href: "/app/health-check", label: "Health Check" },
      { href: "/app/health-check/details", label: "Details" },
    ]);
  });
});
