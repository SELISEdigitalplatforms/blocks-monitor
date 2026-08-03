import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@seliseblocks/genesis-os", () => ({
  useProjectStore: () => ({ selectedProject: { tenantId: "proj-1" } }),
}));

const controllerStub = {
  form: { handleSubmit: (fn: () => void) => fn },
  monitorType: "request",
  sourceType: "none",
  deployedRepos: [],
  services: [],
  isLoadingRepos: false,
  isLoadingServices: false,
  isSubmitting: false,
  isEditMode: false,
  sourceError: "",
  isSourceBlocked: false,
  setMonitorType: vi.fn(),
  setSourceType: vi.fn(),
  setSelectedRepoId: vi.fn(),
  setSelectedServiceId: vi.fn(),
  submit: vi.fn(),
};

const controllerSpy = vi.fn(() => controllerStub);
vi.mock("@/components/module/monitor/form/use-monitor-form-controller", () => ({
  useMonitorFormController: (params: unknown) => controllerSpy(params),
}));

vi.mock("@/components/module/monitor/form/monitor-form-fields", () => ({
  MonitorFormFields: (props: { mode: string; isEditMode: boolean }) => (
    <div data-testid="fields" data-mode={props.mode} data-edit={String(props.isEditMode)} />
  ),
}));

import { AddSingleMonitorForm } from "@/components/module/monitor/form/add-monitor-form";
import { EditSingleMonitorForm } from "@/components/module/monitor/form/edit-monitor-form";
import { MonitorModal } from "@/components/module/monitor/modal/monitor-modal";

describe("Add/Edit monitor form wrappers", () => {
  it("AddSingleMonitorForm wires the controller in add mode", () => {
    render(<AddSingleMonitorForm />);
    expect(controllerSpy).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "add", projectKey: "proj-1" }),
    );
    expect(screen.getByTestId("fields")).toHaveAttribute("data-mode", "add");
  });

  it("EditSingleMonitorForm wires the controller in edit mode with itemId", () => {
    render(<EditSingleMonitorForm itemId="m-9" />);
    expect(controllerSpy).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "edit", itemId: "m-9", projectKey: "proj-1" }),
    );
  });
});

describe("MonitorModal", () => {
  it("shows 'Add monitor' when there is no itemId", () => {
    render(
      <MonitorModal itemId={null} open onOpenChange={vi.fn()}>
        <div>body</div>
      </MonitorModal>,
    );
    expect(screen.getByText("Add monitor")).toBeInTheDocument();
    expect(screen.getByText("body")).toBeInTheDocument();
  });

  it("shows 'Configure' when an itemId is present", () => {
    render(
      <MonitorModal itemId="m1" open onOpenChange={vi.fn()}>
        <div>body</div>
      </MonitorModal>,
    );
    expect(screen.getByText("Configure")).toBeInTheDocument();
  });

  it("calls onOpenChange(false) when the close button is clicked", async () => {
    const onOpenChange = vi.fn();
    render(
      <MonitorModal itemId="m1" open onOpenChange={onOpenChange}>
        <div>body</div>
      </MonitorModal>,
    );
    await userEvent.click(screen.getByText("Close"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
