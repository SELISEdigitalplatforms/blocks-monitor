import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Dialog } from "@/components/core";
import { MonitorFormFields } from "@/components/module/monitor/form/monitor-form-fields";
import {
  getMonitorFormDefaultValues,
  monitorFormSchema,
  type MonitorFormValues,
} from "@/components/module/monitor/form/schema";

type Overrides = Partial<React.ComponentProps<typeof MonitorFormFields>>;

function Harness({
  overrides = {},
  initialValues,
}: {
  overrides?: Overrides;
  initialValues?: Partial<MonitorFormValues>;
}) {
  const form = useForm<MonitorFormValues>({
    defaultValues: { ...getMonitorFormDefaultValues("request"), ...initialValues },
    resolver: zodResolver(monitorFormSchema),
    mode: "onChange",
  });

  const baseProps: React.ComponentProps<typeof MonitorFormFields> = {
    form,
    mode: "add",
    onSubmit: (e) => e.preventDefault(),
    monitorType: "request",
    sourceType: "none",
    deployedRepos: [{ itemId: "r1", repoName: "Repo One" }],
    services: [{ serviceId: "s1", name: "Service One" }],
    isLoadingRepos: false,
    isLoadingServices: false,
    isSubmitting: false,
    isEditMode: false,
    sourceError: "",
    isSourceBlocked: false,
    onMonitorTypeChange: vi.fn(),
    onSourceTypeChange: vi.fn(),
    onRepoChange: vi.fn(),
    onServiceChange: vi.fn(),
  };

  // FormActionsRow uses DialogClose, which needs a Dialog ancestor (in the app
  // the form always renders inside MonitorModal's Dialog).
  return (
    <Dialog open onOpenChange={() => {}}>
      <MonitorFormFields {...baseProps} {...overrides} />
    </Dialog>
  );
}

describe("MonitorFormFields", () => {
  it("renders the add-mode request form with monitor type + URL", () => {
    render(<Harness />);
    expect(screen.getByText("Monitor type")).toBeInTheDocument();
    expect(screen.getByText("URL to monitor")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Enter monitor name")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("hides monitor type and shows the locked note in edit mode", () => {
    render(<Harness overrides={{ isEditMode: true }} />);
    expect(screen.queryByText("Monitor type")).toBeNull();
    expect(
      screen.getByText("Monitor source cannot be changed for existing monitors."),
    ).toBeInTheDocument();
  });

  it("shows the repo selector when source is deployed", () => {
    render(<Harness overrides={{ sourceType: "deployed" }} />);
    expect(screen.getByText("Select repo")).toBeInTheDocument();
  });

  it("shows the service selector when source is my-services", () => {
    render(<Harness overrides={{ sourceType: "my-services" }} />);
    expect(screen.getByText("Select service")).toBeInTheDocument();
  });

  it("renders a source error message when provided", () => {
    render(<Harness overrides={{ sourceError: "Select a deployed repo." }} />);
    expect(screen.getByText("Select a deployed repo.")).toBeInTheDocument();
  });

  it("hides the URL field for callback monitors", () => {
    render(<Harness overrides={{ monitorType: "callback" }} />);
    expect(screen.queryByText("URL to monitor")).toBeNull();
  });

  it("fires onMonitorTypeChange when picking a type", async () => {
    const onMonitorTypeChange = vi.fn();
    render(<Harness overrides={{ onMonitorTypeChange }} />);
    await userEvent.click(screen.getByLabelText("Heartbeat"));
    expect(onMonitorTypeChange).toHaveBeenCalledWith("callback");
  });

  it("fires onSourceTypeChange when tagging a service", async () => {
    const onSourceTypeChange = vi.fn();
    render(<Harness overrides={{ onSourceTypeChange }} />);
    await userEvent.click(screen.getByLabelText("Deployed"));
    expect(onSourceTypeChange).toHaveBeenCalledWith("deployed");
  });

  it("expands the monitor settings accordion to reveal the interval slider", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: /Monitor settings/ }));
    expect(await screen.findByText("Monitor interval")).toBeInTheDocument();
    expect(screen.getByText("Request timeout")).toBeInTheDocument();
  });

  it("expands request configuration and toggling JSON reveals header fields", async () => {
    render(<Harness initialValues={{ requestConfiguration: { ...getMonitorFormDefaultValues().requestConfiguration, http_methods: "2" } }} />);
    await userEvent.click(
      screen.getByRole("button", { name: /Request Configuration/ }),
    );
    expect(await screen.findByText("HTTP method")).toBeInTheDocument();

    const switchEl = screen.getByRole("switch");
    await userEvent.click(switchEl);
    expect(await screen.findByText("X-Header-Name")).toBeInTheDocument();
    expect(screen.getByText("Request headers")).toBeInTheDocument();
  });

  it("disables Save while submitting", () => {
    render(<Harness overrides={{ isSubmitting: true }} />);
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("shows the grace-time slider for callback monitors", async () => {
    render(<Harness overrides={{ monitorType: "callback" }} />);
    await userEvent.click(screen.getByRole("button", { name: /Monitor settings/ }));
    expect(await screen.findByText("Grace Time")).toBeInTheDocument();
    // request-only config accordion is absent for callbacks
    expect(screen.queryByText("Request Configuration")).toBeNull();
  });
});

describe("FormActionsRow (via fields)", () => {
  it("renders Cancel and Save actions", () => {
    render(<Harness />);
    const save = screen.getByRole("button", { name: "Save" });
    const cancel = screen.getByRole("button", { name: "Cancel" });
    expect(within(save.closest("div")!).getByText("Cancel")).toBe(cancel);
  });
});
