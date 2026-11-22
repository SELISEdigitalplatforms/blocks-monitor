// The platform feedback bubble (internal beta): the client calls (workspace feedback.platform.presign → browser PUT →
// feedback.platform.submit), the attachment pre-check, the screenshot's name and scale, and the launcher itself
// (a "Send feedback" bubble, no assistant chat behind it).
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  FEEDBACK_DESCRIPTION_MAX, FEEDBACK_MAX_FILES, FEEDBACK_TITLE_MAX, PLATFORM_FEEDBACK_FN, PLATFORM_FEEDBACK_OPS,
  checkFeedbackAttachment, platformFeedbackErrorMessage, submitPlatformFeedback, uploadFeedbackAttachment,
  type PlatformFeedbackDeps,
} from "@/blocks/platformFeedback";
import { FunctionError } from "@/blocks/fn";
import { FunctionNotConfiguredError } from "@/blocks/functions";
import { opKind } from "@/blocks/fnKinds";
import { MAX_ATTACHMENT_BYTES } from "@/domain/feedback";
import { screenshotFileName, screenshotScale } from "@/components/assistant/pageScreenshot";
import { AssistantLauncher } from "@/components/assistant/AssistantLauncher";

function fakeDeps(answers: Record<string, unknown>) {
  const calls: { op: string; args: Record<string, unknown> }[] = [];
  const puts: { url: string; contentType: string; headers: Record<string, string>; size: number }[] = [];
  const deps: PlatformFeedbackDeps = {
    call: async <T,>(op: string, args: Record<string, unknown>) => {
      calls.push({ op, args });
      const a = answers[op];
      if (a instanceof Error) throw a;
      return a as T;
    },
    putBytes: async ({ url, body, contentType, headers }) => { puts.push({ url, contentType, headers, size: body.size }); },
    sha256Hex: async () => "a".repeat(64),
  };
  return { deps, calls, puts };
}

describe("platform feedback client", () => {
  it("names the workspace ops, both writes", () => {
    expect(PLATFORM_FEEDBACK_FN).toBe("workspace");
    expect(PLATFORM_FEEDBACK_OPS).toEqual({ presign: "feedback.platform.presign", submit: "feedback.platform.submit" });
    expect(opKind("workspace", PLATFORM_FEEDBACK_OPS.presign)).toBe("write");
    expect(opKind("workspace", PLATFORM_FEEDBACK_OPS.submit)).toBe("write");
    expect([FEEDBACK_TITLE_MAX, FEEDBACK_DESCRIPTION_MAX, FEEDBACK_MAX_FILES]).toEqual([120, 5000, 5]);
  });

  it("presigns a file, then PUTs its bytes to the presigned URL with the upload's headers", async () => {
    const { deps, calls, puts } = fakeDeps({
      [PLATFORM_FEEDBACK_OPS.presign]: {
        fileId: "file-1",
        upload: { fileId: "file-1", uploadUrl: "https://storage.test/put/1", storedName: "s.png", displayName: "s.png", directoryId: "d", requiredHeaders: { "x-ms-blob-type": "BlockBlob" } },
      },
    });
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "screenshot-2026-11-17-0712.png", { type: "image/png" });
    const uploaded = await uploadFeedbackAttachment(file, deps);
    expect(calls).toEqual([{ op: "feedback.platform.presign", args: { fileName: "screenshot-2026-11-17-0712.png", mime: "image/png", sizeBytes: 4, sha256: "a".repeat(64) } }]);
    expect(puts).toEqual([{ url: "https://storage.test/put/1", contentType: "image/png", headers: { "x-ms-blob-type": "BlockBlob" }, size: 4 }]);
    expect(uploaded).toEqual({ fileId: "file-1", fileName: "screenshot-2026-11-17-0712.png", mime: "image/png", sizeBytes: 4 });
  });

  it("sends the stored type of a file (a .jpg named image/jpg goes as image/jpeg)", async () => {
    const { deps, calls, puts } = fakeDeps({ [PLATFORM_FEEDBACK_OPS.presign]: { fileId: "f", upload: { fileId: "f", uploadUrl: "https://u" } } });
    await uploadFeedbackAttachment(new File(["x"], "photo.jpg", { type: "image/jpg" }), deps);
    expect(calls[0].args.mime).toBe("image/jpeg");
    expect(puts[0]).toMatchObject({ contentType: "image/jpeg", headers: {} });
  });

  it("submits the form once with its request id, page, client and uploaded files", async () => {
    const { deps, calls } = fakeDeps({ [PLATFORM_FEEDBACK_OPS.submit]: { jobId: "job-9" } });
    const input = {
      requestId: "7f1c2a9e-0000-4000-8000-000000000001", title: "Board is slow", description: "Opening the board takes 10 s.",
      page: { path: "/p/abc/board", title: "Board" }, client: { userAgent: "UA", viewport: "1440x900", language: "de-CH" },
      files: [{ fileId: "file-1", fileName: "screenshot-2026-11-17-0712.png", mime: "image/png", sizeBytes: 4 }],
    };
    expect(await submitPlatformFeedback(input, deps)).toEqual({ jobId: "job-9" });
    expect(calls).toEqual([{ op: "feedback.platform.submit", args: input }]);
  });

  it("a failed presign never PUTs and throws for the form to keep what was typed", async () => {
    const { deps, puts } = fakeDeps({ [PLATFORM_FEEDBACK_OPS.presign]: new FunctionError("rate_limited", "", "r") });
    await expect(uploadFeedbackAttachment(new File(["x"], "a.txt", { type: "text/plain" }), deps)).rejects.toBeInstanceOf(FunctionError);
    expect(puts).toEqual([]);
  });

  it("pre-checks type, size and empty files with plain messages", () => {
    expect(checkFeedbackAttachment({ name: "notes.txt", type: "text/plain", size: 10 })).toBeNull();
    expect(checkFeedbackAttachment({ name: "tool.exe", type: "application/octet-stream", size: 10 })).toMatch(/tool\.exe can't be attached/);
    expect(checkFeedbackAttachment({ name: "big.png", type: "image/png", size: MAX_ATTACHMENT_BYTES + 1 })).toMatch(/larger than 10 MB/);
    expect(checkFeedbackAttachment({ name: "e.png", type: "image/png", size: 0 })).toMatch(/empty/);
  });

  it("errors read calm and plain, never server text", () => {
    expect(platformFeedbackErrorMessage(new FunctionNotConfiguredError("workspace"))).toMatch(/can't be sent right now/);
    expect(platformFeedbackErrorMessage(new FunctionError("rate_limited", "server text", "r"))).toBe("Too many requests right now. Try again in a moment.");
    expect(platformFeedbackErrorMessage(new TypeError("Failed to fetch"))).toMatch(/didn't reach us/);
  });
});

describe("page screenshot", () => {
  it("is named screenshot-YYYY-MM-DD-HHMM.png in local time", () => {
    expect(screenshotFileName(new Date(2026, 10, 17, 7, 12, 59))).toBe("screenshot-2026-11-17-0712.png");
    expect(screenshotFileName(new Date(2026, 0, 3, 23, 5))).toBe("screenshot-2026-01-03-2305.png");
  });

  it("renders sharp on dense screens but keeps a long page to a bounded size", () => {
    expect(screenshotScale(1440, 900, 2)).toBe(2);
    expect(screenshotScale(1440, 900, 3)).toBe(2);
    expect(screenshotScale(1440, 900, 0)).toBe(1);
    const long = screenshotScale(1440, 20_000, 2);
    expect(long).toBeLessThan(1);
    expect(1440 * 20_000 * long * long).toBeLessThanOrEqual(12_000_001);
  });
});

describe("feedback launcher", () => {
  it("is a 'Send feedback' bubble that opens a dialog, without the assistant chat", () => {
    const html = renderToStaticMarkup(<AssistantLauncher />);
    expect(html).toContain('aria-label="Send feedback"');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).not.toContain("Ask the MADP assistant");
    expect(html).toContain("lucide-message-square-plus");
  });
});
