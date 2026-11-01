import { beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();
const post = vi.fn();
const del = vi.fn();

vi.mock("@/lib/http-client", () => ({
  serviceInstances: {
    monitorService: {
      get: (...a: unknown[]) => get(...a),
      post: (...a: unknown[]) => post(...a),
      delete: (...a: unknown[]) => del(...a),
    },
  },
}));

import { alertRecipientsService } from "@/services/alert-recipients.service";

// Exact URLs and bodies: these are the client half of the server contract (#256 §6, Q3).
describe("alertRecipientsService", () => {
  beforeEach(() => {
    get.mockReset().mockResolvedValue({ isSuccess: true });
    post.mockReset().mockResolvedValue({ isSuccess: true });
    del.mockReset();
  });

  it("GETs the recipients with the encoded project key", async () => {
    await alertRecipientsService.getAlertRecipients("p 1/x");
    expect(get).toHaveBeenCalledWith("/api/Monitor/GetAlertRecipients?projectKey=p%201%2Fx");
  });

  it("GETs the member suggestions with the encoded project key", async () => {
    await alertRecipientsService.getAlertRecipientSuggestions("p1");
    expect(get).toHaveBeenCalledWith("/api/Monitor/GetAlertRecipientSuggestions?projectKey=p1");
  });

  it("POSTs a save with projectKey, email, allMonitors and monitorIds", async () => {
    const payload = {
      projectKey: "p1",
      email: "rina@x.com",
      allMonitors: false,
      monitorIds: ["m2"],
    };
    await alertRecipientsService.saveAlertRecipient(payload);
    expect(post).toHaveBeenCalledWith("/api/Monitor/SaveAlertRecipient", payload);
  });

  it("deletes with a POST that carries the email in the body, never the URL (Q3)", async () => {
    await alertRecipientsService.deleteAlertRecipient({ projectKey: "p1", email: "ops@x.com" });
    expect(post).toHaveBeenCalledWith("/api/Monitor/DeleteAlertRecipient", {
      projectKey: "p1",
      email: "ops@x.com",
    });
    expect(del).not.toHaveBeenCalled();
    expect(post.mock.calls[0][0]).not.toContain("ops@x.com");
  });
});
