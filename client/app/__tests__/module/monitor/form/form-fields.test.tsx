import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Dialog } from "@/components/core";
import { MonitorFormFields } from "@/components/module/monitor/form/monitor-form-fields";
import { MonitorModal } from "@/components/module/monitor/modal/monitor-modal";
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
    render(<Harness overrides={{ mode: "edit", isEditMode: true }} />);
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

  // Was: clicked "Monitor settings" first. In add mode the accordion now starts open,
  // so that click would collapse it and Radix would unmount the content.
  it("shows the interval and timeout sliders in the monitor settings accordion", () => {
    render(<Harness />);
    expect(screen.getByText("Monitor interval")).toBeInTheDocument();
    expect(screen.getByText("Request timeout")).toBeInTheDocument();
  });

  it("expands request configuration and toggling JSON reveals header fields", async () => {
    render(
      <Harness
        initialValues={{
          requestConfiguration: {
            ...getMonitorFormDefaultValues().requestConfiguration,
            http_methods: "2",
          },
        }}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /Request Configuration/ }));
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

  // Was: clicked "Monitor settings" first — same inversion as above.
  it("shows the grace-time slider for callback monitors", () => {
    render(<Harness overrides={{ monitorType: "callback" }} />);
    expect(screen.getByText("Grace Time")).toBeInTheDocument();
    // request-only config accordion is absent for callbacks
    expect(screen.queryByText("Request Configuration")).toBeNull();
  });
});

describe("MonitorFormFields monitor settings defaults", () => {
  const settingsTrigger = () => screen.getByRole("button", { name: /Monitor settings/ });

  /**
   * The slider renders every tick label ("30s", "1min", ...) unconditionally and shows
   * no current-value text, so asserting on "30s" would pass whatever the default is.
   * The value lives on the Radix thumb's aria-valuenow; scope by label because both
   * sliders in the accordion expose role="slider".
   */
  const sliderFor = (label: string) =>
    within(screen.getByText(label).closest("div")!).getByRole("slider");

  it("opens the accordion in add mode without any interaction (H1)", () => {
    render(<Harness />);
    expect(settingsTrigger()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Monitor interval")).toBeInTheDocument();
  });

  it("defaults the request timeout to 30s for request monitors (H2, C3)", () => {
    render(<Harness />);
    expect(sliderFor("Request timeout")).toHaveAttribute("aria-valuenow", "1");
    expect(screen.queryByText("Grace Time")).toBeNull();
  });

  it("defaults the grace time to 30s for callback monitors (H3, C4)", () => {
    render(<Harness overrides={{ monitorType: "callback" }} />);
    expect(sliderFor("Grace Time")).toHaveAttribute("aria-valuenow", "1");
    expect(screen.queryByText("Request timeout")).toBeNull();
  });

  it("leaves the monitor interval at 1min (H4)", () => {
    render(<Harness />);
    expect(sliderFor("Monitor interval")).toHaveAttribute("aria-valuenow", "2");
  });

  it("keeps the accordion collapsed in edit mode but still toggleable (C1)", async () => {
    render(<Harness overrides={{ mode: "edit", isEditMode: true }} />);

    expect(settingsTrigger()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Monitor interval")).toBeNull();

    // The second half of C1: collapsed by default, but the user can still open it.
    // Without this, an edit trigger that ignored clicks would satisfy every other
    // assertion here, since C5 only exercises add mode where it starts open.
    await userEvent.click(settingsTrigger());
    expect(await screen.findByText("Monitor interval")).toBeInTheDocument();
  });

  it("shows the monitor's saved timeout in edit mode, not the add default (C2)", async () => {
    render(
      <Harness
        overrides={{ mode: "edit", isEditMode: true }}
        initialValues={{
          monitorSettings: {
            ...getMonitorFormDefaultValues().monitorSettings,
            // step 2 = 60s: neither the add default (1) nor the edit fallback (3)
            request_timeout: 2,
          },
        }}
      />,
    );

    await userEvent.click(settingsTrigger());
    expect(await screen.findByText("Request timeout")).toBeInTheDocument();
    expect(sliderFor("Request timeout")).toHaveAttribute("aria-valuenow", "2");
  });

  it("lets the user collapse the accordion again in add mode (C5)", async () => {
    render(<Harness />);
    expect(settingsTrigger()).toHaveAttribute("aria-expanded", "true");

    await userEvent.click(settingsTrigger());

    expect(settingsTrigger()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Monitor interval")).toBeNull();
  });
});

/**
 * Section 4 example 5: reopening "Add monitor" after fiddling with the settings shows
 * the defaults again. Driven through the real MonitorModal rather than a bare RTL
 * unmount, because what makes this work is that DialogContent unmounts its children
 * when closed — a forceMount or lifted-state change would break the behaviour while a
 * hand-rolled unmount test carried on passing.
 */
describe("reopening the add-monitor modal", () => {
  function ModalHarness({ open }: { open: boolean }) {
    return (
      <MonitorModal open={open} onOpenChange={() => {}} itemId={null}>
        <Harness />
      </MonitorModal>
    );
  }

  it("restores the open accordion and the 30s default", async () => {
    const trigger = () => screen.getByRole("button", { name: /Monitor settings/ });
    const timeoutSlider = () =>
      within(screen.getByText("Request timeout").closest("div")!).getByRole("slider");

    const view = render(<ModalHarness open />);

    // Dirty both pieces of state first. Asserting the default without moving it off
    // the default would prove nothing at all.
    await userEvent.click(timeoutSlider());
    await userEvent.keyboard("{ArrowRight}");
    expect(timeoutSlider()).toHaveAttribute("aria-valuenow", "2");

    await userEvent.click(trigger());
    expect(trigger()).toHaveAttribute("aria-expanded", "false");

    view.rerender(<ModalHarness open={false} />);
    expect(screen.queryByRole("button", { name: /Monitor settings/ })).toBeNull();

    view.rerender(<ModalHarness open />);

    expect(trigger()).toHaveAttribute("aria-expanded", "true");
    expect(timeoutSlider()).toHaveAttribute("aria-valuenow", "1");
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
