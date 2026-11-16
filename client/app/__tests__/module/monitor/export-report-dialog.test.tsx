import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const h = vi.hoisted(() => ({
  exportUptimeReport: vi.fn(),
  toast: vi.fn(),
  saveFile: vi.fn(),
}));

vi.mock("@/services/alerts.service", () => ({
  alertsService: { exportUptimeReport: (...a: unknown[]) => h.exportUptimeReport(...a) },
}));
vi.mock("@/hooks/use-toast", () => ({ toast: (...a: unknown[]) => h.toast(...a) }));
vi.mock("@/utils/uptime-report.util", async (o) => {
  const actual = await o<typeof import("@/utils/uptime-report.util")>();
  return { ...actual, saveFile: (...a: unknown[]) => h.saveFile(...a) };
});

import { ExportReportDialog } from "@/components/module/monitor/export/export-report-dialog";

describe("ExportReportDialog", () => {
  const onOpenChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    h.exportUptimeReport.mockResolvedValue(new Blob(["%PDF"], { type: "application/pdf" }));
  });

  it("exports one monitor as PDF for the last 30 days by default", async () => {
    render(
      <ExportReportDialog
        open
        onOpenChange={onOpenChange}
        scope={{ kind: "monitor", monitorId: "m1", name: "Payments API" }}
      />,
    );

    await userEvent.click(screen.getByTestId("export-report-submit"));

    await waitFor(() => expect(h.exportUptimeReport).toHaveBeenCalledOnce());
    const payload = h.exportUptimeReport.mock.calls[0][0];
    expect(payload).toMatchObject({ format: "pdf", monitorId: "m1" });
    expect(payload.projectKey).toBeUndefined();
    const spanDays = (Date.parse(payload.to) - Date.parse(payload.from)) / 86_400_000;
    expect(spanDays).toBeCloseTo(30, 3);

    expect(h.saveFile).toHaveBeenCalledWith(
      expect.any(Blob),
      expect.stringMatching(/^uptime-report_payments-api_\d{8}-\d{8}\.pdf$/),
      "application/pdf",
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("exports the whole tab as Excel", async () => {
    h.exportUptimeReport.mockResolvedValue(new Blob(["x"], { type: "application/octet-stream" }));
    render(
      <ExportReportDialog
        open
        onOpenChange={onOpenChange}
        scope={{ kind: "project", projectKey: "p1", monitorSourceType: "2", name: "Blocks services" }}
      />,
    );

    await userEvent.click(screen.getByLabelText(/Excel/));
    await userEvent.click(screen.getByTestId("export-report-submit"));

    await waitFor(() =>
      expect(h.exportUptimeReport).toHaveBeenCalledWith(
        expect.objectContaining({ format: "xlsx", projectKey: "p1", monitorSourceType: "2" }),
      ),
    );
    expect(h.saveFile.mock.calls[0][1]).toMatch(/\.xlsx$/);
  });

  it("shows the server's reason and stays open when the export fails", async () => {
    h.exportUptimeReport.mockRejectedValue({ errors: { message: "Monitor not found." } });
    render(
      <ExportReportDialog
        open
        onOpenChange={onOpenChange}
        scope={{ kind: "monitor", monitorId: "m1", name: "x" }}
      />,
    );

    await userEvent.click(screen.getByTestId("export-report-submit"));

    await waitFor(() =>
      expect(h.toast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "destructive", description: "Monitor not found." }),
      ),
    );
    expect(h.saveFile).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
