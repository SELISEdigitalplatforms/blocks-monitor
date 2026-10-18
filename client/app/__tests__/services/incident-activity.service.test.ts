import { beforeEach, describe, expect, it, vi } from "vitest";
import { alertsService } from "@/services/alerts.service";
import {
  activityStart,
  getMonitorIncidentActivity,
  incidentTimestamp,
} from "@/services/incident-activity.service";

vi.mock("@/services/alerts.service", () => ({
  alertsService: { getAllMonitorIncidentList: vi.fn() },
}));
const getList = vi.mocked(alertsService.getAllMonitorIncidentList);

const END = "2026-10-11";
const NOW = Date.parse("2026-10-11T12:00:00Z");
const incident = (
  itemId: string,
  startTime = "2026-10-11T08:00:00Z",
  overrides: Record<string, unknown> = {},
) => ({
  itemId,
  startTime,
  endTime: "0001-01-01T00:00:00",
  isResolved: true,
  downtimeDurationSeconds: 300,
  ...overrides,
});
const page = (data: ReturnType<typeof incident>[], totalCount?: number) =>
  ({ isSuccess: true, data, totalCount }) as never;
const load = (signal?: AbortSignal) => getMonitorIncidentActivity("m1", END, { signal, now: NOW });

describe("monitor incident activity", () => {
  beforeEach(() => getList.mockReset());

  it("pages newest-first until the total is read and sums each day's downtime in minutes", async () => {
    getList.mockResolvedValueOnce(
      page(
        Array.from({ length: 100 }, (_, i) => incident(`a${i}`, "2026-10-11T08:00:00Z")),
        101,
      ),
    );
    getList.mockResolvedValueOnce(
      page([incident("b", "2026-10-10T09:00:00Z", { downtimeDurationSeconds: 61 })], 101),
    );
    const result = await load();
    expect(getList).toHaveBeenCalledTimes(2);
    expect(getList).toHaveBeenNthCalledWith(2, {
      monitorId: "m1",
      pageNumber: 2,
      pageSize: 100,
      sortProperty: "started_time",
      sortIsDescending: true,
    });
    expect(result.unit).toBe("minute");
    // 61 seconds rounds up to 2 minutes; 100 five-minute incidents are 500.
    expect(result.days).toEqual([
      { date: "2026-10-10", count: 2 },
      { date: "2026-10-11", count: 500 },
    ]);
    expect(result.incidents).toHaveLength(101);
    expect(result.isPartial).toBeUndefined();
  });

  it("rounds any incident up to at least one minute, including a zero-length one", async () => {
    getList.mockResolvedValue(
      page([
        incident("short", "2026-10-09T10:00:00Z", { downtimeDurationSeconds: 5 }),
        incident("zero", "2026-10-08T10:00:00Z", {
          downtimeDurationSeconds: 0,
          endTime: "2026-10-08T10:00:00Z",
        }),
      ]),
    );
    expect((await load()).days).toEqual([
      { date: "2026-10-08", count: 1 },
      { date: "2026-10-09", count: 1 },
    ]);
  });

  it("deduplicates incidents and clips them to the 53-week calendar", async () => {
    getList.mockResolvedValue(
      page([
        incident("a"),
        incident("a"),
        incident("offset", "2026-10-11T01:00:00+02:00"),
        incident("future", "2026-10-12T00:00:00Z"),
        incident("old", "2024-01-01T00:00:00Z"),
        incident("invalid", "garbage"),
      ]),
    );
    const result = await load();
    expect(result.incidents.map((i) => i.itemId)).toEqual(["a", "offset"]);
    expect(result.incidents[1].startTime).toBe("2026-10-10T23:00:00.000Z");
    expect(result.days).toEqual([
      { date: "2026-10-10", count: 5 },
      { date: "2026-10-11", count: 5 },
    ]);
  });

  it("counts an unresolved incident up to now", async () => {
    getList.mockResolvedValue(
      page([
        incident("open", "2026-10-11T10:00:00Z", {
          isResolved: false,
          downtimeDurationSeconds: 0,
        }),
      ]),
    );
    const result = await load();
    expect(result.days).toEqual([{ date: "2026-10-11", count: 120 }]);
    expect(result.incidents[0]).toMatchObject({ isResolved: false, durationMs: 2 * 3_600_000 });
  });

  it("splits an incident that spans midnight UTC across the days it covers", async () => {
    getList.mockResolvedValue(
      page([
        incident("night", "2026-10-09T23:30:00Z", {
          downtimeDurationSeconds: 0,
          endTime: "2026-10-10T00:45:00Z",
        }),
      ]),
    );
    const result = await load();
    expect(result.days).toEqual([
      { date: "2026-10-09", count: 30 },
      { date: "2026-10-10", count: 45 },
    ]);
    expect(result.incidents[0].days).toEqual(["2026-10-09", "2026-10-10"]);
    expect(result.incidents[0].durationMs).toBe(75 * 60_000);
  });

  it("keeps the part of an incident that started before the calendar", async () => {
    const first = new Date(activityStart(END)).toISOString();
    expect(first).toBe("2025-10-12T00:00:00.000Z");
    getList.mockResolvedValue(
      page([incident("edge", "2025-10-11T23:00:00Z", { downtimeDurationSeconds: 7200 })]),
    );
    expect((await load()).days).toEqual([{ date: "2025-10-12", count: 60 }]);
  });

  it("falls back to incidents per start day when a duration can't be derived", async () => {
    getList.mockResolvedValue(
      page([
        incident("a", "2026-10-11T08:00:00Z"),
        incident("b", "2026-10-11T09:00:00Z"),
        incident("unknown", "2026-10-10T23:30:00Z", { downtimeDurationSeconds: 0 }),
      ]),
    );
    const result = await load();
    expect(result.unit).toBe("incident");
    expect(result.days).toEqual([
      { date: "2026-10-10", count: 1 },
      { date: "2026-10-11", count: 2 },
    ]);
    expect(result.incidents.find((i) => i.itemId === "unknown")?.durationMs).toBeNull();
  });

  it("stops at the calendar boundary instead of reading older years", async () => {
    getList.mockResolvedValueOnce(page([incident("recent")], 300));
    getList.mockResolvedValueOnce(page([incident("old", "2024-01-01T00:00:00Z")], 300));
    const result = await load();
    expect(getList).toHaveBeenCalledTimes(2);
    expect(result.days).toEqual([{ date: "2026-10-11", count: 5 }]);
    expect(result.isPartial).toBeUndefined();
  });

  it("marks the history partial when paging stalls or runs out early", async () => {
    getList.mockResolvedValue(page([incident("same")], 200));
    const repeated = await load();
    expect(repeated.isPartial).toBe(true);
    expect(repeated.days).toEqual([{ date: "2026-10-11", count: 5 }]);
    expect(getList).toHaveBeenCalledTimes(2);

    getList.mockReset();
    getList.mockResolvedValueOnce(page([incident("a")], 5));
    getList.mockResolvedValueOnce(page([], 5));
    expect((await load()).isPartial).toBe(true);
  });

  it("returns an empty calendar for empty history and rejects a failed response", async () => {
    getList.mockResolvedValue(page([], 0));
    expect(await load()).toEqual({ days: [], incidents: [], unit: "minute" });
    getList.mockResolvedValue({ isSuccess: false } as never);
    await expect(load()).rejects.toThrow("could not be loaded");
  });

  it("stops reading when the query is cancelled", async () => {
    const controller = new AbortController();
    getList.mockImplementation(async () => {
      controller.abort();
      return page([incident("a")], 200);
    });
    await expect(load(controller.signal)).rejects.toThrow();
    expect(getList).toHaveBeenCalledTimes(1);
  });

  it("reads offset-less monitor timestamps as UTC", () => {
    expect(incidentTimestamp("2026-10-11T12:00:00")).toBe(Date.parse("2026-10-11T12:00:00Z"));
    expect(incidentTimestamp("")).toBeNaN();
  });
});
