import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
// http-client.ts calls getRuntimeEnv() at module load to seed each service's
// baseURL. getRuntimeEnv falls through to `import.meta.env`, which is not
// injected into the externalized blocks-kit dependency under vitest (it throws
// at import). Resolve it to an empty string while keeping the real HttpClient,
// so the module still builds its genuine service instances for the assertions.
vi.mock("@seliseblocks/blocks-kit/lib", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@seliseblocks/blocks-kit/lib")>();
  return { ...actual, getRuntimeEnv: () => "" };
});
import { HealthLayout } from "@/layouts/health-layout/health-layout";
import { serviceInstances, HttpClient } from "@/lib/http-client";
import * as models from "@/models";

describe("HealthLayout", () => {
  it("renders the nested route via Outlet", () => {
    render(
      <MemoryRouter initialEntries={["/x"]}>
        <Routes>
          <Route element={<HealthLayout />}>
            <Route path="/x" element={<div>nested content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText("nested content")).toBeInTheDocument();
    expect(screen.getByRole("main")).toBeInTheDocument();
  });
});

describe("http-client service instances", () => {
  it("exposes the three configured HttpClient instances", () => {
    expect(serviceInstances.observabilityService).toBeDefined();
    expect(serviceInstances.logicService).toBeDefined();
    expect(serviceInstances.idpService).toBeDefined();
    expect(typeof HttpClient).toBe("function");
  });
});

describe("models barrel", () => {
  it("re-exports the model modules without throwing", () => {
    expect(models).toBeDefined();
  });
});
