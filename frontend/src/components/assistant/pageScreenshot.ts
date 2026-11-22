/** A PNG of the page the person is on, for the feedback window; the window and its launcher are left out of it. */
import { MAX_ATTACHMENT_BYTES } from "@/domain/feedback";

const pad = (n: number) => String(n).padStart(2, "0");

/** screenshot-2026-11-17-0712.png (local time). */
export function screenshotFileName(d: Date): string {
  return `screenshot-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.png`;
}

/** The render scale: sharp on high-density screens, but small enough that a long page stays a reasonable PNG. */
export function screenshotScale(width: number, height: number, dpr: number, maxPixels = 12_000_000): number {
  const fit = Math.sqrt(maxPixels / Math.max(1, width * height));
  return Math.max(0.25, Math.min(dpr || 1, 2, fit));
}

const frames = (n: number) => new Promise<void>((done) => { const step = (k: number) => (k <= 0 ? done() : requestAnimationFrame(() => step(k - 1))); step(n); });
const pause = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

/** A real picture of this browser tab through the browser's own screen capture: the person confirms "Share this tab"
 *  (the browser's own prompt), the elements whose ids are given are hidden for a moment, one frame is taken and the
 *  capture stops. Works under the hosted Content Security Policy, which blocks the inline styles a DOM re-render needs.
 *  Resolves null when this browser cannot capture a tab; rejects when the person declines. */
export async function captureTabScreenshot(excludeIds: readonly string[], now: Date = new Date()): Promise<File | null> {
  const md = navigator.mediaDevices as (MediaDevices & { getDisplayMedia?: MediaDevices["getDisplayMedia"] }) | undefined;
  if (!md?.getDisplayMedia) return null;
  // Chrome's hints: offer this tab first and only tabs; other browsers ignore what they do not know
  const options = {
    video: { displaySurface: "browser", frameRate: 5 }, audio: false,
    preferCurrentTab: true, selfBrowserSurface: "include", surfaceSwitching: "exclude", monitorTypeSurfaces: "exclude",
  } as DisplayMediaStreamOptions;
  const stream = await md.getDisplayMedia(options);
  const hidden = excludeIds.map((id) => document.getElementById(id)).filter((el): el is HTMLElement => el !== null);
  const before = hidden.map((el) => el.style.visibility);
  try {
    hidden.forEach((el) => { el.style.visibility = "hidden"; });
    await frames(2);
    await pause(350);
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await video.play();
    for (let i = 0; i < 40 && (video.videoWidth === 0 || video.videoHeight === 0); i++) await pause(50);
    await pause(250);
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx || canvas.width === 0) throw new Error("no frame");
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    video.srcObject = null;
    const png = await new Promise<Blob | null>((done) => canvas.toBlob(done, "image/png"));
    if (png && png.size > 0 && png.size <= MAX_ATTACHMENT_BYTES) return new File([png], screenshotFileName(now), { type: "image/png" });
    const jpg = await new Promise<Blob | null>((done) => canvas.toBlob(done, "image/jpeg", 0.85));
    if (jpg && jpg.size > 0 && jpg.size <= MAX_ATTACHMENT_BYTES) return new File([jpg], screenshotFileName(now).replace(/\.png$/, ".jpg"), { type: "image/jpeg" });
    throw new Error("screenshot too large");
  } finally {
    stream.getTracks().forEach((track) => track.stop());
    hidden.forEach((el, i) => { el.style.visibility = before[i] ?? ""; });
  }
}

/** The page as a picture: the browser's tab capture first (true pixels, works under the hosted CSP), else a render of
 *  the page (document.body) without the elements whose ids are given. Resolves with a PNG (or JPEG) file. */
export async function capturePageScreenshot(excludeIds: readonly string[], now: Date = new Date()): Promise<File> {
  const tab = await captureTabScreenshot(excludeIds, now);
  if (tab) return tab;
  return renderPageScreenshot(excludeIds, now);
}

/** Render the whole page (document.body) without the elements whose ids are given; resolves with a PNG file. */
export async function renderPageScreenshot(excludeIds: readonly string[], now: Date = new Date()): Promise<File> {
  const { domToBlob } = await import("modern-screenshot");
  const body = document.body;
  const width = Math.max(body.scrollWidth, document.documentElement.clientWidth);
  const height = Math.max(body.scrollHeight, document.documentElement.clientHeight);
  const skip = new Set(excludeIds);
  const background = getComputedStyle(body).backgroundColor || getComputedStyle(document.documentElement).backgroundColor || null;
  let scale = screenshotScale(width, height, window.devicePixelRatio);
  for (let attempt = 0; attempt < 3; attempt++) {
    const blob = await domToBlob(body, {
      type: "image/png",
      scale,
      width,
      height,
      backgroundColor: background,
      timeout: 8000,
      filter: (node) => !(node instanceof Element && skip.has(node.id)),
    });
    if (blob.size > 0 && blob.size <= MAX_ATTACHMENT_BYTES) return new File([blob], screenshotFileName(now), { type: "image/png" });
    scale = scale / 2;
  }
  throw new Error("screenshot too large");
}
