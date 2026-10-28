import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import type { IAlertRecipientsData } from "@/models/alert-recipients.model";
import { MONITORS, recipient } from "../../module/alert-recipients/fixtures";

type QueryState = {
  data: IAlertRecipientsData | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  isFetching: boolean;
  refetch: ReturnType<typeof vi.fn>;
};

const h = vi.hoisted(() => ({
  query: {} as QueryState,
  queryProjectKeys: [] as string[],
  deleteAsync: vi.fn(),
  saveAsync: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@/hooks/use-alert-recipients", () => ({
  useGetAlertRecipients: (projectKey: string) => {
    h.queryProjectKeys.push(projectKey);
    return h.query;
  },
  useGetAlertRecipientSuggestions: () => ({ isSuccess: false }),
  useDeleteAlertRecipient: () => ({ mutateAsync: h.deleteAsync, isPending: false }),
  useSaveAlertRecipient: () => ({ mutateAsync: h.saveAsync, isPending: false }),
}));
vi.mock("@/hooks/use-toast", () => ({
  showSuccessToast: (o: unknown) => h.success(o),
  showErrorToast: (o: unknown) => h.error(o),
}));
vi.mock("@seliseblocks/genesis-os/hooks", () => ({
  useScopedPath: () => (p: string) => `/scoped/${p}`,
}));
vi.mock("@seliseblocks/genesis-os/store", () => ({
  useProjectStore: () => ({ selectedProject: { tenantId: "p1", name: "Test Construct" } }),
}));

import AlertRecipientsPage from "@/pages/alert-recipients";

/** The spec's E1 result: ali on api, ops on api and web, worker without anyone. */
const E1: IAlertRecipientsData = {
  maxEmailsPerMonitor: 10,
  monitors: MONITORS,
  recipients: [
    recipient("ops@x.com", ["m1", "m2"], { allMonitorsChoice: true }),
    recipient("ali@x.com", ["m1"]),
  ],
  monitorsWithoutRecipients: ["h1"],
};

const setData = (data: IAlertRecipientsData | undefined) => {
  h.query = {
    data,
    isLoading: false,
    isError: false,
    error: null,
    isFetching: false,
    refetch: vi.fn(),
  };
};

const renderPage = () =>
  render(
    <MemoryRouter>
      <AlertRecipientsPage />
    </MemoryRouter>,
  );

const rowEmails = () =>
  screen
    .getAllByRole("row")
    .slice(1)
    .map((row) => within(row).getAllByRole("cell")[0].textContent?.slice(1));

describe("AlertRecipientsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.queryProjectKeys = [];
    setData(E1);
    h.deleteAsync.mockResolvedValue({
      isSuccess: true,
      message: "Removed from 2 monitors.",
      data: { email: "ops@x.com", removed: 2, conflicted: [], denied: [] },
    });
    h.saveAsync.mockResolvedValue({ isSuccess: true, message: "Added to 2 monitors." });
  });

  it("shows the title, subtitle, Add recipient and one row per person sorted by email (H2)", () => {
    renderPage();
    expect(screen.getByRole("heading", { level: 1, name: "Alert recipients" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "People who get an email when a monitor in Test Construct goes down or comes back up.",
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Add recipient" })[0]).toBeEnabled();
    expect(rowEmails()).toEqual(["ali@x.com", "ops@x.com"]);
    expect(
      screen.getByText(
        "Alerts are sent to the emails saved on each monitor. A monitor can have up to 10.",
      ),
    ).toBeInTheDocument();
    expect(h.queryProjectKeys[0]).toBe("p1");
  });

  it("shows the warning coverage badge when a monitor emails no one (H13)", () => {
    renderPage();
    expect(screen.getByTestId("coverage-badge")).toHaveTextContent("1 of 3 monitors emails no one");
  });

  it("shows the OK coverage badge when every monitor emails someone (H13)", () => {
    setData({ ...E1, monitorsWithoutRecipients: [] });
    renderPage();
    expect(screen.getByTestId("coverage-badge")).toHaveTextContent("All 3 monitors email someone");
  });

  it("shows 5 skeleton rows while loading", () => {
    setData(undefined);
    h.query.isLoading = true;
    renderPage();
    const loading = screen.getByTestId("recipients-loading");
    expect(loading.children).toHaveLength(5);
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("shows an error with Retry and no stale list when loading fails (C17)", async () => {
    h.query.isError = true;
    h.query.error = new Error("Project not found.");
    renderPage();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Alert recipients could not be loaded.");
    expect(alert).toHaveTextContent("Project not found.");
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByTestId("coverage-badge")).toBeNull();
    expect(screen.getByRole("button", { name: "Add recipient" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(h.query.refetch).toHaveBeenCalled();
  });

  it("asks for a monitor first and disables Add when there are no editable monitors (C16)", () => {
    setData({
      maxEmailsPerMonitor: 10,
      monitors: [],
      recipients: [],
      monitorsWithoutRecipients: [],
    });
    renderPage();
    expect(screen.getByText("Add a monitor first.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to Monitor" })).toHaveAttribute(
      "href",
      "/scoped/monitor",
    );
    expect(screen.getByRole("button", { name: "Add recipient" })).toBeDisabled();
  });

  it("invites the first recipient when nobody gets alerts yet (C16)", async () => {
    setData({ ...E1, recipients: [], monitorsWithoutRecipients: ["m1", "m2", "h1"] });
    renderPage();
    expect(screen.getByText("No one gets alert emails yet.")).toBeInTheDocument();
    const buttons = screen.getAllByRole("button", { name: "Add recipient" });
    expect(buttons).toHaveLength(2);
    await userEvent.click(buttons[1]);
    expect(screen.getByRole("dialog", { name: "Add recipient" })).toBeInTheDocument();
  });

  it("filters rows by email or monitor name on the client (H15)", async () => {
    renderPage();
    const search = screen.getByRole("searchbox", { name: "Search people or monitors" });
    await userEvent.type(search, "WEB");
    expect(rowEmails()).toEqual(["ops@x.com"]);
    await userEvent.clear(search);
    await userEvent.type(search, "ali");
    expect(rowEmails()).toEqual(["ali@x.com"]);
    await userEvent.type(search, "zzz");
    expect(screen.getByText("No people or monitors match.")).toBeInTheDocument();
    // No server request: the query is never refetched, and only ever asked for the project.
    expect(h.query.refetch).not.toHaveBeenCalled();
    expect(new Set(h.queryProjectKeys)).toEqual(new Set(["p1"]));
  });

  it("opens the Edit dialog for the row's person", async () => {
    renderPage();
    await userEvent.click(screen.getByRole("button", { name: "Edit ali@x.com" }));
    const dialog = screen.getByRole("dialog", { name: "Edit recipient" });
    expect(within(dialog).getByLabelText("Email")).toHaveValue("ali@x.com");
  });

  it("removes a person and announces it with Undo (H7, C21)", async () => {
    renderPage();
    await userEvent.click(
      screen.getByRole("button", { name: "Remove ops@x.com from all monitors" }),
    );
    expect(h.deleteAsync).toHaveBeenCalledWith({ projectKey: "p1", email: "ops@x.com" });
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(
      "ops@x.com removed from 2 monitors. They no longer get alert emails.",
    );
    expect(within(status).getByRole("button", { name: "Undo" })).toBeInTheDocument();
  });

  it("Undo restores the stored All choice (H8, Q4)", async () => {
    renderPage();
    await userEvent.click(
      screen.getByRole("button", { name: "Remove ops@x.com from all monitors" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(h.saveAsync).toHaveBeenCalledWith({
      projectKey: "p1",
      email: "ops@x.com",
      allMonitors: true,
      monitorIds: [],
    });
    expect(h.success).toHaveBeenCalledWith({ description: "Added to 2 monitors." });
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("Undo restores the previous selected monitors (H8)", async () => {
    h.deleteAsync.mockResolvedValue({
      isSuccess: true,
      data: { email: "ali@x.com", removed: 1, conflicted: [], denied: [] },
    });
    renderPage();
    await userEvent.click(
      screen.getByRole("button", { name: "Remove ali@x.com from all monitors" }),
    );
    expect(screen.getByRole("status")).toHaveTextContent("ali@x.com removed from 1 monitor.");
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(h.saveAsync).toHaveBeenCalledWith({
      projectKey: "p1",
      email: "ali@x.com",
      allMonitors: false,
      monitorIds: ["m1"],
    });
  });

  it("keeps the notice when Undo is refused and shows the API message", async () => {
    h.saveAsync.mockResolvedValue({ isSuccess: false, message: "Monitor not found: m1" });
    renderPage();
    await userEvent.click(
      screen.getByRole("button", { name: "Remove ali@x.com from all monitors" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(h.error).toHaveBeenCalledWith({ errors: "Monitor not found: m1" });
    expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
  });

  it("keeps the list and shows the API message when Remove is refused (C17)", async () => {
    h.deleteAsync.mockResolvedValue({ isSuccess: false, message: "Project not found." });
    renderPage();
    await userEvent.click(
      screen.getByRole("button", { name: "Remove ali@x.com from all monitors" }),
    );
    expect(h.error).toHaveBeenCalledWith({ errors: "Project not found." });
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(rowEmails()).toEqual(["ali@x.com", "ops@x.com"]);
  });

  it("shows an error toast when Remove throws", async () => {
    h.deleteAsync.mockRejectedValue(new Error("Network down"));
    renderPage();
    await userEvent.click(
      screen.getByRole("button", { name: "Remove ali@x.com from all monitors" }),
    );
    expect(h.error).toHaveBeenCalled();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("renders 200 recipients without pagination (H17)", () => {
    const recipients = Array.from({ length: 200 }, (_, i) =>
      recipient(`user${String(i).padStart(3, "0")}@x.com`, ["m1"]),
    );
    setData({ ...E1, recipients });
    renderPage();
    expect(screen.getAllByRole("row")).toHaveLength(201);
  });
});
