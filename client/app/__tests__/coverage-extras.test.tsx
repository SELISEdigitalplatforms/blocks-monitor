import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
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
