// The screen designs as real screens: each screen is a self-contained HTML page (the brand colour, the app's header and
// menu, the content blocks laid out for a desktop at 1440 x 900 or a phone at 390 x 844) photographed by a headless
// Chromium (playwright-core, already in the repository) into a PNG. One browser per job, in a child process started from
// this release (../../isolated/browser.mjs; Playwright is never loaded into the engine worker); when Chromium cannot
// start, or one page fails, the screen is drawn by the pixel renderer of the seeded images (seed/core/draw.ts) instead,
// so the step never breaks. screenHtml() is pure; screenRenderer() does the I/O.
//
//   MF_ENGINE_SCREEN_RENDER=html|pixel|auto   auto (default) tries Chromium first; unit tests (VITEST) default to pixel
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { render as pixelRender, type ScreenBlock, type ScreenImage } from "../../../../../seed/core/draw.ts";
import { hashOf } from "../../text.ts";
import { startIsolated, type IsolatedChild } from "../../isolated/host.ts";

export type HtmlBlock =
  | Exclude<ScreenBlock, { k: "hero" }>
  /** `colour`: the banner's own colour (hex without "#") when the client asked for one; else it takes the brand's */
  | { k: "hero"; title: string; text?: string; colour?: string }
  | { k: "grid"; items: { title: string; price: string; creator: string; badge?: string; rating?: string }[] }
  | { k: "filters"; items: string[]; active: number; sort?: string }
  | { k: "summary"; title: string; lines: [string, string][]; total?: [string, string] }
  | { k: "upload"; title: string; text?: string }
  | { k: "preview"; title: string; text?: string; meta?: string[] }
  | { k: "form"; title?: string; fields: [string, string][] }
  | { k: "rows"; title?: string; items: { label: string; value: string; detail?: string }[] }
  | { k: "bars"; title?: string; values: number[]; labels: string[] };

export interface HtmlScreen {
  device: "mobile" | "desktop";
  /** hex without "#" */
  brand: string;
  app: string;
  title: string;
  subtitle?: string;
  nav?: string[];
  activeNav?: number;
  /** who is signed in (initials in the header); none on a sign-in screen */
  person?: string;
  /** the text in the header's search field; none hides the field on the phone */
  search?: string;
  blocks: HtmlBlock[];
}

export const SIZE = { desktop: { width: 1440, height: 900, scale: 1 }, mobile: { width: 390, height: 844, scale: 2 } } as const;

// ── colours ─────────────────────────────────────────────────────────────────────────────────────────────────────

type Rgb = [number, number, number];
const rgbOf = (h: string): Rgb => {
  const v = /^[0-9a-f]{6}$/i.test(h) ? h : "1f5fae";
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
};
const hexOf = (c: Rgb): string => c.map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, "0")).join("");
const mixRgb = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const luminance = (c: Rgb): number => {
  const ch = c.map((x) => {
    const s = x / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
};

/** A brand colour white text reads well on (a light colour is darkened until it does). */
export function readableBrand(h: string): string {
  let c = rgbOf(h.replace("#", "").toLowerCase());
  for (let i = 0; i < 12 && luminance(c) > 0.22; i++) c = mixRgb(c, [0, 0, 0], 0.12);
  return hexOf(c);
}

/** A colour's tint (mixed with white by `t`) and its deep end (the second stop of a gradient), as CSS colours. */
const tintOf = (hex: string, t: number): string => `#${hexOf(mixRgb(rgbOf(hex), [255, 255, 255], t))}`;
const deepOf = (hex: string): string => `#${hexOf(mixRgb(rgbOf(hex), [0, 0, 0], 0.28))}`;

/** A hero's own colour as the brand variables of that banner (white text stays readable); "" without a valid colour. */
export function heroStyle(colour: string | undefined): string {
  if (!colour || !/^[0-9a-f]{6}$/i.test(colour)) return "";
  const c = readableBrand(colour);
  return ` style="--b:#${c};--b40:${tintOf(c, 0.6)};--bd:${deepOf(c)}"`;
}

// ── text ────────────────────────────────────────────────────────────────────────────────────────────────────────

const esc = (s: unknown): string =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function initials(name: string): string {
  const parts = name.replace(/[^\p{L}\s'-]/gu, " ").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  return ((parts[0]![0] ?? "") + (parts.length > 1 ? parts[parts.length - 1]![0] ?? "" : "")).toUpperCase();
}

const STATUS_TONE: [RegExp, string][] = [
  [/^(paid|approved|live|active|done|completed?|published|delivered|accepted|verified|on sale|in stock|sent|ready)$/i, "ok"],
  [/^(in review|pending|waiting|processing|scheduled|on hold|draft|due|open|new|queued|in progress|awaiting.*)$/i, "warn"],
  [/^(rejected|refunded|failed|declined|blocked|cancelled|canceled|overdue|disputed|expired|removed|flagged)$/i, "bad"],
];
const toneOf = (s: string): string | null => STATUS_TONE.find(([re]) => re.test(s.trim()))?.[1] ?? null;

// ── icons (stroke, 24 x 24) ─────────────────────────────────────────────────────────────────────────────────────

const ICON: Record<string, string> = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  cart: '<circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/>',
  home: '<path d="m3 10 9-7 9 7v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
  chart: '<path d="M3 3v18h18"/><path d="M7 16v-5"/><path d="M12 16V7"/><path d="M17 16v-8"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/><path d="m9 12 2 2 4-4"/>',
  star: '<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
  file: '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5z"/><path d="M14 2v6h6"/>',
  wallet: '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
};
const icon = (name: string, size = 20, cls = ""): string =>
  `<svg class="ic ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name] ?? ICON.grid}</svg>`;

/** The menu icon of a label. */
export function navIcon(label: string): string {
  const t = label.toLowerCase();
  if (/home|start|discover|today/.test(t)) return "home";
  if (/search|browse|explore|shop|catalog|market|find/.test(t)) return "search";
  if (/cart|basket|checkout|bag|buy|order/.test(t)) return "cart";
  if (/upload|sell|new|add|create|publish/.test(t)) return "upload";
  if (/sale|payout|earning|report|stat|insight|dashboard|analytics|revenue/.test(t)) return "chart";
  if (/wallet|pay|billing|invoice/.test(t)) return "wallet";
  if (/review|admin|moderat|approv|trust|safety|queue/.test(t)) return "shield";
  if (/download|library|purchase|my files|files|licen/.test(t)) return "file";
  if (/message|inbox|support|ticket/.test(t)) return "inbox";
  if (/favou?rite|saved|wish/.test(t)) return "heart";
  if (/setting/.test(t)) return "settings";
  if (/account|profile|me\b|you/.test(t)) return "user";
  return "grid";
}

// ── asset artwork: a believable thumbnail for an asset's kind, in colours of its own ────────────────────────────

export function art(title: string, w: number, h: number): string {
  const n = hashOf(`art:${title}`);
  const hue = n % 360;
  const hue2 = (hue + 40 + (n >> 4) % 80) % 360;
  const a = `hsl(${hue} 70% 62%)`;
  const b = `hsl(${hue2} 72% 46%)`;
  const soft = `hsl(${hue} 60% 94%)`;
  const id = `g${n % 100000}`;
  const t = title.toLowerCase();
  const defs = `<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>`;
  let body: string;
  if (/icon|emoji|glyph|pictogram/.test(t)) {
    const cells: string[] = [];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) {
      const x = w * (0.14 + c * 0.2);
      const y = h * (0.16 + r * 0.26);
      const s = Math.min(w * 0.13, h * 0.19);
      const k = (n >> (r * 4 + c)) % 3;
      cells.push(k === 0 ? `<circle cx="${x + s / 2}" cy="${y + s / 2}" r="${s / 2.4}" fill="none" stroke="url(#${id})" stroke-width="${s / 7}"/>`
        : k === 1 ? `<rect x="${x + s * 0.12}" y="${y + s * 0.12}" width="${s * 0.76}" height="${s * 0.76}" rx="${s * 0.2}" fill="none" stroke="url(#${id})" stroke-width="${s / 7}"/>`
          : `<path d="M${x + s * 0.15} ${y + s * 0.8} L${x + s / 2} ${y + s * 0.15} L${x + s * 0.85} ${y + s * 0.8} Z" fill="none" stroke="url(#${id})" stroke-width="${s / 7}" stroke-linejoin="round"/>`);
    }
    body = `<rect width="${w}" height="${h}" fill="${soft}"/>${cells.join("")}`;
  } else if (/font|type|typeface|lettering|serif|sans/.test(t)) {
    body = `<rect width="${w}" height="${h}" fill="url(#${id})"/><text x="${w * 0.1}" y="${h * 0.72}" font-size="${h * 0.62}" font-weight="700" fill="#fff" font-family="Outfit, sans-serif">Aa</text><text x="${w * 0.66}" y="${h * 0.86}" font-size="${h * 0.12}" fill="rgba(255,255,255,.85)" font-family="Outfit, sans-serif">${esc(title.split(/\s+/)[0] ?? "")}</text>`;
  } else if (/template|kit|\bui\b|dashboard|website|theme|landing|deck|presentation|slide|wireframe|figma|notion/.test(t)) {
    const pad = w * 0.1;
    body = `<rect width="${w}" height="${h}" fill="url(#${id})"/><rect x="${pad}" y="${h * 0.16}" width="${w - 2 * pad}" height="${h * 0.84}" rx="${h * 0.05}" fill="#fff"/><rect x="${pad}" y="${h * 0.16}" width="${w - 2 * pad}" height="${h * 0.1}" rx="${h * 0.05}" fill="${soft}"/>` +
      `<circle cx="${pad + h * 0.05}" cy="${h * 0.21}" r="${h * 0.017}" fill="${a}"/><circle cx="${pad + h * 0.1}" cy="${h * 0.21}" r="${h * 0.017}" fill="${b}"/>` +
      `<rect x="${pad + w * 0.05}" y="${h * 0.34}" width="${w * 0.36}" height="${h * 0.06}" rx="${h * 0.02}" fill="${b}"/><rect x="${pad + w * 0.05}" y="${h * 0.45}" width="${w * 0.28}" height="${h * 0.035}" rx="${h * 0.017}" fill="#d9dde3"/>` +
      `<rect x="${pad + w * 0.05}" y="${h * 0.55}" width="${w * 0.2}" height="${h * 0.08}" rx="${h * 0.03}" fill="${a}"/><rect x="${w * 0.56}" y="${h * 0.33}" width="${w * 0.24}" height="${h * 0.4}" rx="${h * 0.03}" fill="${soft}"/>`;
  } else if (/photo|image|picture|texture|landscape|wallpaper|background|stock/.test(t)) {
    body = `<rect width="${w}" height="${h}" fill="url(#${id})"/><circle cx="${w * 0.74}" cy="${h * 0.3}" r="${h * 0.12}" fill="rgba(255,255,255,.85)"/>` +
      `<path d="M0 ${h} L${w * 0.32} ${h * 0.45} L${w * 0.55} ${h * 0.78} L${w * 0.7} ${h * 0.6} L${w} ${h} Z" fill="rgba(15,23,42,.38)"/><path d="M0 ${h} L${w * 0.2} ${h * 0.72} L${w * 0.45} ${h} Z" fill="rgba(15,23,42,.25)"/>`;
  } else if (/3d|model|render|object|scene|sculpt/.test(t)) {
    body = `<defs><radialGradient id="${id}r" cx="0.35" cy="0.3" r="0.75"><stop offset="0" stop-color="#fff"/><stop offset="0.35" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></radialGradient></defs><rect width="${w}" height="${h}" fill="${soft}"/>` +
      `<ellipse cx="${w / 2}" cy="${h * 0.84}" rx="${h * 0.3}" ry="${h * 0.05}" fill="rgba(15,23,42,.14)"/><circle cx="${w / 2}" cy="${h * 0.48}" r="${h * 0.31}" fill="url(#${id}r)"/>`;
  } else if (/audio|sound|music|loop|beat|sfx|podcast|voice/.test(t)) {
    const bars: string[] = [];
    for (let i = 0; i < 24; i++) {
      const bh = h * (0.12 + (((n >> (i % 16)) + i * 7) % 10) / 16);
      bars.push(`<rect x="${w * 0.08 + i * (w * 0.84) / 24}" y="${(h - bh) / 2}" width="${(w * 0.84) / 24 * 0.55}" height="${bh}" rx="2" fill="#fff" opacity="${0.6 + (i % 3) * 0.13}"/>`);
    }
    body = `<rect width="${w}" height="${h}" fill="url(#${id})"/>${bars.join("")}`;
  } else if (/video|motion|animation|footage|\blut\b|clip|film/.test(t)) {
    body = `<rect width="${w}" height="${h}" fill="url(#${id})"/><circle cx="${w / 2}" cy="${h / 2}" r="${h * 0.17}" fill="rgba(255,255,255,.92)"/><path d="M${w / 2 - h * 0.05} ${h / 2 - h * 0.08} L${w / 2 + h * 0.09} ${h / 2} L${w / 2 - h * 0.05} ${h / 2 + h * 0.08} Z" fill="${b}"/>`;
  } else {
    body = `<rect width="${w}" height="${h}" fill="url(#${id})"/><circle cx="${w * 0.28}" cy="${h * 0.36}" r="${h * 0.3}" fill="rgba(255,255,255,.22)"/><circle cx="${w * 0.72}" cy="${h * 0.7}" r="${h * 0.38}" fill="rgba(255,255,255,.16)"/><rect x="${w * 0.42}" y="${h * 0.18}" width="${h * 0.34}" height="${h * 0.34}" rx="${h * 0.08}" fill="rgba(255,255,255,.35)" transform="rotate(18 ${w * 0.5} ${h * 0.35})"/>`;
  }
  return `<svg class="art" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid slice" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">${defs}${body}</svg>`;
}

// ── blocks ──────────────────────────────────────────────────────────────────────────────────────────────────────

const pill = (text: string, tone?: string | null): string => `<span class="pill ${tone ?? "neutral"}">${esc(text)}</span>`;
const cell = (v: string): string => {
  const tone = toneOf(v);
  return tone ? pill(v, tone) : esc(v);
};

function buttons(list: { text: string; secondary?: boolean }[], mobile: boolean): string {
  return `<div class="actions${mobile ? " stack" : ""}">${list.map((b) => `<span class="btn${b.secondary ? " secondary" : ""}">${esc(b.text)}</span>`).join("")}</div>`;
}

const SPAN: Record<string, number> = {
  hero: 12, heading: 12, filters: 12, grid: 12, stats: 12, table: 12, steps: 12, note: 12, buttons: 12,
  list: 6, rows: 6, chart: 6, bars: 6, map: 6, card: 4, form: 7, upload: 7, preview: 7, summary: 5, field: 6,
};

function blockHtml(b: HtmlBlock, mobile: boolean, tail: string): string {
  switch (b.k) {
    case "hero":
      return `<section class="hero"${heroStyle(b.colour)}><h2>${esc(b.title)}</h2>${b.text ? `<p>${esc(b.text)}</p>` : ""}${tail}</section>`;
    case "heading":
      return `<h2 class="heading">${esc(b.text)}</h2>`;
    case "filters":
      return `<div class="filters"><div class="chips">${b.items.map((c, i) => `<span class="chip${i === b.active ? " on" : ""}">${esc(c)}</span>`).join("")}</div>${b.sort && !mobile ? `<span class="sort">${esc(b.sort)} <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg></span>` : ""}</div>`;
    case "grid": {
      const items = b.items.slice(0, mobile ? 4 : b.items.length > 4 ? 8 : 4);
      const tw = mobile ? 170 : 300;
      const th = mobile ? 118 : 170;
      return `<div class="assets cols-${mobile ? 2 : Math.min(4, Math.max(3, items.length))}">${items.map((it) => `<article class="asset"><div class="thumb">${art(it.title, tw, th)}${it.badge ? `<span class="tag">${esc(it.badge)}</span>` : ""}<span class="fav">${icon("heart", 15)}</span></div><div class="meta"><div class="t">${esc(it.title)}</div><div class="c">${esc(it.creator)}</div><div class="pr"><b>${esc(it.price)}</b>${it.rating ? `<span class="rt">${icon("star", 13, "star")}${esc(it.rating)}</span>` : ""}</div></div></article>`).join("")}</div>`;
    }
    case "list":
      return `<section class="panel list">${b.items.map(([t, m]) => `<div class="li"><span class="dot">${esc(initials(t).slice(0, 1) || "•")}</span><span class="lt">${esc(t)}</span><span class="lm">${cell(m)}</span></div>`).join("")}${tail}</section>`;
    case "rows":
      return `<section class="panel list">${b.title ? `<h3>${esc(b.title)}</h3>` : ""}${b.items.map((r) => `<div class="li"><span class="dot">${esc(initials(r.label).slice(0, 1) || "•")}</span><span class="lt">${esc(r.label)}${r.detail ? `<small>${esc(r.detail)}</small>` : ""}</span><span class="lm">${cell(r.value)}</span></div>`).join("")}${tail}</section>`;
    case "card": {
      const tone = b.badge ? (b.tone === "ok" ? "ok" : b.tone === "warn" ? "warn" : toneOf(b.badge) ?? "info") : null;
      return `<section class="panel card"><div class="ch"><h3>${esc(b.title)}</h3>${b.badge ? pill(b.badge, tone) : ""}</div>${(b.lines ?? []).map((l) => `<p>${esc(l)}</p>`).join("")}${tail}</section>`;
    }
    case "stats":
      return `<div class="stats n${Math.min(4, b.items.length)}">${b.items.map(([l, v], i) => {
        const [value, delta] = v.split(/\s*\|\s*/);
        return `<section class="panel stat"><span class="sl">${esc(l)}</span><span class="sv">${esc(value)}</span>${delta ? `<span class="sd${/^[-−▼]/.test(delta) ? " down" : ""}">${esc(delta)}</span>` : i === 0 ? "" : ""}</section>`;
      }).join("")}</div>`;
    case "table": {
      if (mobile) {
        const rows = b.rows.slice(0, 5);
        return `<section class="panel list">${rows.map((r) => `<div class="li"><span class="dot">${esc(initials(r[1] ?? r[0] ?? "").slice(0, 1) || "•")}</span><span class="lt">${esc(r[1] ?? r[0] ?? "")}<small>${esc([r[0], ...r.slice(2, -1)].filter(Boolean).slice(0, 2).join(" · "))}</small></span><span class="lm">${cell(r[r.length - 1] ?? "")}</span></div>`).join("")}${tail}</section>`;
      }
      return `<section class="panel tbl"><table><thead><tr>${b.head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${b.rows.slice(0, 7).map((r) => `<tr>${r.map((v, i) => `<td${i === 0 ? ' class="first"' : ""}>${cell(v)}</td>`).join("")}</tr>`).join("")}</tbody></table>${tail}</section>`;
    }
    case "steps":
      return `<section class="panel steps">${b.items.map((s, i) => `<div class="st${i < b.active ? " done" : i === b.active ? " now" : ""}"><span class="sn">${i < b.active ? icon("check", 14) : i + 1}</span><span class="sl">${esc(s)}</span></div>`).join('<span class="bar"></span>')}</section>`;
    case "field":
      return `<label class="field"><span>${esc(b.label)}</span><span class="input">${esc(b.value ?? "")}</span></label>`;
    case "form":
      return `<section class="panel form">${b.title ? `<h3>${esc(b.title)}</h3>` : ""}<div class="fields">${b.fields.map(([l, v]) => `<label class="field${v.length > 46 || mobile ? " wide" : ""}"><span>${esc(l)}</span><span class="input${v.length > 70 ? " area" : ""}">${esc(v)}</span></label>`).join("")}</div>${tail}</section>`;
    case "upload":
      return `<section class="panel upload"><span class="uicon">${icon("upload", 26)}</span><h3>${esc(b.title)}</h3>${b.text ? `<p>${esc(b.text)}</p>` : ""}${tail || `<div class="actions"><span class="btn secondary">Choose files</span></div>`}</section>`;
    case "preview":
      return `<section class="panel preview"><div class="big">${art(b.title, mobile ? 360 : 760, mobile ? 230 : 380)}</div><div class="pm"><h3>${esc(b.title)}</h3>${b.text ? `<p>${esc(b.text)}</p>` : ""}${b.meta?.length ? `<div class="chips small">${b.meta.map((m) => `<span class="chip">${esc(m)}</span>`).join("")}</div>` : ""}</div>${tail}</section>`;
    case "summary":
      return `<section class="panel summary"><h3>${esc(b.title)}</h3>${b.lines.map(([l, v]) => `<div class="sr"><span>${esc(l)}</span><span>${esc(v)}</span></div>`).join("")}${b.total ? `<div class="sr total"><span>${esc(b.total[0])}</span><span>${esc(b.total[1])}</span></div>` : ""}${tail}</section>`;
    case "chart": {
      const max = Math.max(1, ...b.values);
      return `<section class="panel chart"><div class="bars">${b.values.map((v, i) => `<span class="cb${i === b.values.length - 1 ? " last" : ""}" style="height:${Math.max(4, Math.round((v / max) * 100))}%"></span>`).join("")}</div>${tail}</section>`;
    }
    case "bars": {
      const max = Math.max(1, ...b.values);
      return `<section class="panel chart labelled">${b.title ? `<h3>${esc(b.title)}</h3>` : ""}<div class="bars">${b.values.map((v, i) => `<span class="col"><span class="cb${i === b.values.length - 1 ? " last" : ""}" style="height:${Math.max(4, Math.round((v / max) * 100))}%"></span><small>${esc(b.labels[i] ?? "")}</small></span>`).join("")}</div>${tail}</section>`;
    }
    case "map":
      return `<section class="panel map"><svg viewBox="0 0 400 220" width="100%" height="100%" preserveAspectRatio="xMidYMid slice"><rect width="400" height="220" fill="#e8efe6"/><path d="M0 60 L400 120 M0 170 L400 90 M90 0 L160 220 M280 0 L240 220" stroke="#fff" stroke-width="10"/>${Array.from({ length: b.pins ?? 3 }, (_, i) => `<circle cx="${60 + ((i * 97) % 300)}" cy="${50 + ((i * 61) % 130)}" r="9" fill="var(--b)" stroke="#fff" stroke-width="3"/>`).join("")}</svg></section>`;
    case "note":
      return `<p class="note">${icon("info", 16)}<span>${esc(b.text)}</span></p>`;
    case "button":
      return buttons([b], mobile);
  }
}

/** Blocks in order, a run of buttons as one row, buttons right after a panel inside that panel. */
function layout(list: readonly HtmlBlock[], mobile: boolean): { html: string; span: number }[] {
  const out: { html: string; span: number }[] = [];
  const holds = new Set(["hero", "card", "form", "upload", "summary", "preview", "list", "rows", "table"]);
  for (let i = 0; i < list.length; i++) {
    const b = list[i]!;
    if (b.k === "button") {
      const run: { text: string; secondary?: boolean }[] = [];
      while (i < list.length && list[i]!.k === "button") run.push(list[i++] as { text: string; secondary?: boolean });
      i -= 1;
      out.push({ html: buttons(run, mobile), span: SPAN.buttons! });
      continue;
    }
    if (b.k === "field") {
      const fields: [string, string][] = [];
      while (i < list.length && list[i]!.k === "field") {
        const f = list[i++] as { label: string; value?: string };
        fields.push([f.label, f.value ?? ""]);
      }
      i -= 1;
      const next = list[i + 1];
      let tail = "";
      if (next?.k === "button") {
        const run: { text: string; secondary?: boolean }[] = [];
        while (list[i + 1]?.k === "button") run.push(list[++i] as { text: string; secondary?: boolean });
        tail = buttons(run, true);
      }
      out.push({ html: blockHtml({ k: "form", fields }, mobile, tail), span: SPAN.form! });
      continue;
    }
    let tail = "";
    if (holds.has(b.k) && list[i + 1]?.k === "button") {
      const run: { text: string; secondary?: boolean }[] = [];
      while (list[i + 1]?.k === "button") run.push(list[++i] as { text: string; secondary?: boolean });
      tail = buttons(run, mobile || b.k === "summary" || b.k === "form");
    }
    out.push({ html: blockHtml(b, mobile, tail), span: SPAN[b.k] ?? 12 });
  }
  return arrange(out);
}

/** Spans that fill the rows of the 12-column page: a wide block with its side panel (7 + 5), two halves, a run of
 *  cards in equal columns; a block without a partner takes the whole row. */
function arrange(list: { html: string; span: number }[]): { html: string; span: number }[] {
  const out = list.map((x) => ({ ...x }));
  for (let i = 0; i < out.length; i++) {
    const x = out[i]!;
    const next = out[i + 1];
    if (x.span === 12) continue;
    if (x.span === 4) {
      let n = 1;
      while (out[i + n]?.span === 4) n += 1;
      const w = n === 1 ? (next && next.span !== 12 ? 5 : 6) : n === 2 ? 6 : n === 4 ? 3 : 4;
      for (let k = 0; k < n; k++) out[i + k]!.span = w;
      if (n === 1 && next && next.span !== 12) next.span = 7;
      i += n === 1 && next && next.span !== 12 ? 1 : n - 1;
      continue;
    }
    if (!next || next.span === 12) {
      x.span = x.span === 5 ? 6 : 12;
      continue;
    }
    if (x.span === 7) next.span = 5;
    else if (x.span === 5) next.span = 7;
    else if (next.span === 6) x.span = 6;
    else if (next.span === 7) x.span = 5;
    else {
      x.span = 7;
      next.span = 5;
    }
    i += 1;
  }
  return out;
}

// ── the page ────────────────────────────────────────────────────────────────────────────────────────────────────

let fontCache: string | null | undefined;
/** The Outfit font of the app as a data URL (from node_modules), or null (system sans). */
function fontUrl(): string | null {
  if (fontCache !== undefined) return fontCache;
  fontCache = null;
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const file = path.join(here, "..", "..", "..", "..", "..", "node_modules", "@fontsource-variable", "outfit", "files", "outfit-latin-wght-normal.woff2");
    fontCache = `data:font/woff2;base64,${fs.readFileSync(file).toString("base64")}`;
  } catch {
    /* system sans */
  }
  return fontCache;
}

function css(brand: string, mobile: boolean, font: string | null): string {
  const tint = (t: number) => tintOf(brand, t);
  const deep = deepOf(brand);
  return `
${font ? `@font-face{font-family:'Outfit';src:url(${font}) format('woff2');font-weight:100 900;font-display:block}` : ""}
:root{--b:#${brand};--b5:${tint(0.95)};--b10:${tint(0.9)};--b20:${tint(0.8)};--b40:${tint(0.6)};--bd:${deep};--ink:#16181d;--ink2:#4b5260;--ink3:#7a8190;--line:#e6e8ec;--bg:#f6f7f9}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${mobile ? 390 : 1440}px;height:${mobile ? 844 : 900}px;overflow:hidden}
body{font-family:'Outfit',ui-sans-serif,system-ui,'Noto Sans','DejaVu Sans',sans-serif;color:var(--ink);background:var(--bg);font-size:14px;line-height:1.4;-webkit-font-smoothing:antialiased;position:relative}
.ic{flex:none;display:inline-block;vertical-align:middle}
h1{font-size:${mobile ? 23 : 28}px;font-weight:650;letter-spacing:-.015em;line-height:1.15}
h2,h3{font-weight:600;letter-spacing:-.01em}
.sub{color:var(--ink3);font-size:${mobile ? 13.5 : 15}px;margin-top:4px}
.mark{width:${mobile ? 28 : 32}px;height:${mobile ? 28 : 32}px;border-radius:9px;background:linear-gradient(135deg,var(--b),var(--bd));color:#fff;display:grid;place-items:center;font-weight:700;font-size:${mobile ? 14 : 16}px;flex:none}
.logo{display:flex;align-items:center;gap:10px;font-weight:650;font-size:${mobile ? 16.5 : 17.5}px;letter-spacing:-.01em;white-space:nowrap}
.avatar{width:${mobile ? 32 : 36}px;height:${mobile ? 32 : 36}px;border-radius:50%;background:var(--b20);color:var(--bd);display:grid;place-items:center;font-weight:600;font-size:13px;flex:none}
.top{height:68px;background:#fff;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:34px;padding:0 40px}
.top nav{display:flex;gap:26px;height:100%}
.top nav span{display:flex;align-items:center;color:var(--ink2);font-size:14.5px;position:relative;white-space:nowrap}
.top nav span.on{color:var(--ink);font-weight:600}
.top nav span.on:after{content:"";position:absolute;left:0;right:0;bottom:-1px;height:2.5px;border-radius:2px;background:var(--b)}
.search{flex:1;max-width:440px;height:42px;border-radius:11px;background:#f1f2f5;display:flex;align-items:center;gap:10px;padding:0 14px;color:var(--ink3);font-size:14px;margin-left:auto;white-space:nowrap;overflow:hidden}
.search b{font-weight:400;color:var(--ink)}
.tools{display:flex;align-items:center;gap:18px;color:var(--ink2)}
.who{display:flex;align-items:center;gap:10px;font-size:13.5px;color:var(--ink2);white-space:nowrap}
.page{padding:30px 40px 0;max-width:1440px}
.head{display:flex;align-items:flex-end;justify-content:space-between;margin-bottom:22px}
.g12{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:20px;grid-auto-flow:row dense;align-items:start}
.panel{background:#fff;border:1px solid var(--line);border-radius:16px;padding:${mobile ? 16 : 20}px;box-shadow:0 1px 2px rgba(16,24,40,.04)}
.panel h3{font-size:${mobile ? 15.5 : 16.5}px;margin-bottom:10px}
.hero{border-radius:18px;padding:${mobile ? "20px 18px" : "34px 36px"};color:#fff;background:radial-gradient(120% 140% at 100% 0%,var(--b40) 0%,transparent 55%),linear-gradient(135deg,var(--b),var(--bd))}
.hero h2{font-size:${mobile ? 21 : 30}px;font-weight:650;letter-spacing:-.02em;max-width:720px}
.hero p{opacity:.9;font-size:${mobile ? 13.5 : 16}px;margin-top:8px;max-width:640px}
.hero .btn{background:#fff;color:var(--bd)}.hero .btn.secondary{background:transparent;color:#fff;border-color:rgba(255,255,255,.6)}
.heading{font-size:${mobile ? 16.5 : 19}px;margin-top:2px}
.filters{display:flex;align-items:center;justify-content:space-between;gap:12px;overflow:hidden}
.chips{display:flex;gap:8px;flex-wrap:${mobile ? "nowrap" : "wrap"};overflow:hidden}
.chip{padding:${mobile ? "7px 13px" : "8px 15px"};border-radius:999px;background:#fff;border:1px solid var(--line);font-size:${mobile ? 13 : 13.5}px;color:var(--ink2);white-space:nowrap}
.chip.on{background:var(--ink);border-color:var(--ink);color:#fff}
.chips.small .chip{padding:5px 11px;font-size:12.5px;background:var(--b5);border-color:var(--b10);color:var(--bd)}
.sort{font-size:13.5px;color:var(--ink2);display:flex;align-items:center;gap:6px;white-space:nowrap}
.assets{display:grid;gap:${mobile ? 12 : 18}px}
.assets.cols-2{grid-template-columns:repeat(2,minmax(0,1fr))}.assets.cols-3{grid-template-columns:repeat(3,minmax(0,1fr))}.assets.cols-4{grid-template-columns:repeat(4,minmax(0,1fr))}
.asset{background:#fff;border:1px solid var(--line);border-radius:14px;overflow:hidden}
.thumb{height:${mobile ? 112 : 168}px;position:relative;overflow:hidden;background:var(--b10)}
.thumb .art{display:block}
.tag{position:absolute;left:10px;top:10px;background:rgba(255,255,255,.94);color:var(--ink);font-size:11.5px;font-weight:600;padding:3px 9px;border-radius:999px}
.fav{position:absolute;right:10px;top:9px;width:28px;height:28px;border-radius:50%;background:rgba(255,255,255,.9);display:grid;place-items:center;color:var(--ink2)}
.meta{padding:${mobile ? "9px 11px 11px" : "12px 14px 14px"}}
.meta .t{font-weight:600;font-size:${mobile ? 13.5 : 14.5}px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.meta .c{color:var(--ink3);font-size:${mobile ? 12 : 13}px;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pr{display:flex;align-items:center;justify-content:space-between;margin-top:${mobile ? 6 : 9}px}
.pr b{font-size:${mobile ? 14 : 15}px;font-weight:650}
.rt{display:flex;align-items:center;gap:3px;font-size:12.5px;color:var(--ink2)}
.star{color:#f5a524;fill:#f5a524}
.list{padding-top:${mobile ? 6 : 8}px;padding-bottom:${mobile ? 6 : 8}px}
.list h3{margin:8px 0 4px}
.li{display:flex;align-items:center;gap:12px;padding:${mobile ? 10 : 11}px 0;border-bottom:1px solid var(--line)}
.li:last-of-type{border-bottom:0}
.dot{width:34px;height:34px;border-radius:10px;background:var(--b10);color:var(--bd);display:grid;place-items:center;font-weight:600;font-size:13px;flex:none}
.lt{flex:1;min-width:0;font-weight:500;font-size:${mobile ? 13.5 : 14}px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lt small{display:block;color:var(--ink3);font-weight:400;font-size:12.5px;margin-top:1px;overflow:hidden;text-overflow:ellipsis}
.lm{font-size:13.5px;font-weight:550;color:var(--ink);white-space:nowrap}
.pill{display:inline-block;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:600;white-space:nowrap}
.pill.ok{background:#e6f6ee;color:#13784a}.pill.warn{background:#fdf3e1;color:#a15c07}.pill.bad{background:#fde8e8;color:#b42318}.pill.info{background:var(--b10);color:var(--bd)}.pill.neutral{background:#f0f1f4;color:var(--ink2)}
.card .ch{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}
.card p{color:var(--ink2);font-size:13.5px;margin-top:4px;line-height:1.5}
.stats{display:grid;gap:${mobile ? 10 : 20}px;grid-template-columns:repeat(${mobile ? 2 : "var(--n,4)"},minmax(0,1fr))}
.stats.n1{--n:1}.stats.n2{--n:2}.stats.n3{--n:3}.stats.n4{--n:4}
.stat{display:flex;flex-direction:column;gap:2px}
.stat .sl{color:var(--ink3);font-size:${mobile ? 12.5 : 13.5}px}
.stat .sv{font-size:${mobile ? 21 : 27}px;font-weight:650;letter-spacing:-.02em}
.stat .sd{font-size:12.5px;color:#13784a;font-weight:550}.stat .sd.down{color:#b42318}
.tbl{padding:0;overflow:hidden}
.tbl table{width:100%;border-collapse:collapse}
.tbl th{text-align:left;font-weight:500;font-size:12.5px;color:var(--ink3);background:#fafbfc;padding:11px 20px;border-bottom:1px solid var(--line)}
.tbl td{padding:12px 20px;border-bottom:1px solid var(--line);font-size:13.5px;color:var(--ink2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:300px}
.tbl td.first{color:var(--ink);font-weight:500}
.tbl tr:last-child td{border-bottom:0}
.steps{display:flex;align-items:center;gap:10px}
.st{display:flex;align-items:center;gap:8px;color:var(--ink3);font-size:${mobile ? 12 : 13.5}px;white-space:nowrap}
.st .sn{width:${mobile ? 24 : 28}px;height:${mobile ? 24 : 28}px;border-radius:50%;border:1.5px solid var(--line);display:grid;place-items:center;font-size:12.5px;font-weight:600;flex:none;background:#fff}
.st.done .sn{background:var(--b);border-color:var(--b);color:#fff}.st.now .sn{border-color:var(--b);color:var(--b)}.st.now,.st.done{color:var(--ink)}
.st.now .sl{font-weight:600}
${mobile ? ".st:not(.now) .sl{display:none}" : ""}
.bar{flex:1;height:2px;background:var(--line);border-radius:2px;min-width:12px}
.fields{display:grid;grid-template-columns:${mobile ? "1fr" : "1fr 1fr"};gap:14px}
.field{display:flex;flex-direction:column;gap:6px;font-size:13px;color:var(--ink2);font-weight:500}
.field.wide{grid-column:1/-1}
.input{height:${mobile ? 44 : 44}px;border:1px solid #dfe2e7;border-radius:11px;background:#fff;padding:0 13px;display:flex;align-items:center;color:var(--ink);font-weight:400;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.input.area{height:auto;min-height:76px;align-items:flex-start;padding:11px 13px;white-space:normal;line-height:1.45}
.upload{border:2px dashed var(--b40);background:var(--b5);text-align:center;display:flex;flex-direction:column;align-items:center;padding:${mobile ? "24px 16px" : "40px 28px"}}
.uicon{width:56px;height:56px;border-radius:16px;background:#fff;color:var(--b);display:grid;place-items:center;box-shadow:0 1px 3px rgba(16,24,40,.08);margin-bottom:12px}
.upload h3{margin-bottom:4px}.upload p{color:var(--ink2);font-size:13.5px;max-width:420px}
.upload .actions{justify-content:center}
.preview{padding:0;overflow:hidden}
.preview .big{height:${mobile ? 220 : 360}px;overflow:hidden}
.preview .big .art{display:block}
.pm{padding:${mobile ? "14px 16px 16px" : "18px 22px 20px"}}
.pm p{color:var(--ink2);font-size:13.5px;margin:-4px 0 10px}
.preview .actions{padding:0 ${mobile ? 16 : 22}px ${mobile ? 16 : 20}px}
.summary .sr{display:flex;justify-content:space-between;gap:12px;padding:7px 0;font-size:14px;color:var(--ink2)}
.summary .sr span:last-child{color:var(--ink);font-weight:500;white-space:nowrap}
.summary .total{border-top:1px solid var(--line);margin-top:6px;padding-top:12px;font-size:16px;color:var(--ink);font-weight:650}
.summary .total span:last-child{font-weight:700}
.chart{height:${mobile ? 150 : 220}px}
.bars{display:flex;align-items:flex-end;gap:${mobile ? 6 : 10}px;height:100%}
.cb{flex:1;border-radius:6px 6px 2px 2px;background:var(--b20)}.cb.last{background:var(--b)}
.labelled{display:flex;flex-direction:column}.labelled .bars{flex:1;min-height:0}
.col{flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:stretch;height:100%;gap:6px}
.col .cb{flex:none}.col small{text-align:center;color:var(--ink3);font-size:11.5px;white-space:nowrap}
.map{padding:0;overflow:hidden;height:${mobile ? 170 : 240}px}
.note{display:flex;gap:9px;align-items:flex-start;color:var(--ink2);font-size:13px;background:var(--b5);border:1px solid var(--b10);border-radius:12px;padding:11px 13px;line-height:1.5}
.note .ic{color:var(--b);margin-top:1px}
.actions{display:flex;gap:10px;margin-top:16px;flex-wrap:wrap}
.g12>.actions,.mstack>.actions{margin-top:0}
.actions.stack{flex-direction:column}
.actions.stack .btn{width:100%}
.btn{height:${mobile ? 46 : 44}px;padding:0 20px;border-radius:12px;background:var(--b);color:#fff;font-weight:600;font-size:14.5px;display:inline-flex;align-items:center;justify-content:center;border:1px solid transparent;white-space:nowrap}
.btn.secondary{background:#fff;color:var(--ink);border-color:#d9dce2}
/* phone */
.sbar{height:47px;display:flex;align-items:center;justify-content:space-between;padding:0 26px 0 30px;font-weight:600;font-size:15px;background:#fff}
.sicons{display:flex;gap:6px;align-items:center}
.mtop{height:54px;background:#fff;display:flex;align-items:center;justify-content:space-between;padding:0 16px;border-bottom:1px solid var(--line)}
.mtop .r{display:flex;align-items:center;gap:14px;color:var(--ink2)}
.msearch{margin:12px 16px 0;height:42px;border-radius:12px;background:#fff;border:1px solid var(--line);display:flex;align-items:center;gap:9px;padding:0 13px;color:var(--ink3);font-size:14px;white-space:nowrap;overflow:hidden}
.msearch b{font-weight:400;color:var(--ink)}
.mpage{padding:16px 16px 100px}
.mhead{margin-bottom:14px}
.mstack{display:flex;flex-direction:column;gap:14px}
.tabs{position:absolute;left:0;right:0;bottom:0;height:84px;background:#fff;border-top:1px solid var(--line);display:flex;padding:8px 6px 0}
.tab{flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;color:var(--ink3);font-size:11px;font-weight:500;white-space:nowrap;overflow:hidden}
.tab.on{color:var(--b)}
.home{position:absolute;bottom:8px;left:50%;transform:translateX(-50%);width:134px;height:5px;border-radius:3px;background:#16181d}
/* sign-in */
.auth{height:100%;display:grid;${mobile ? "align-content:start;padding:28px 22px" : "grid-template-columns:1fr 1fr"}}
.auth .side{background:radial-gradient(120% 120% at 0% 0%,var(--b40) 0%,transparent 60%),linear-gradient(150deg,var(--b),var(--bd));color:#fff;padding:56px;display:flex;flex-direction:column;justify-content:space-between}
.auth .side .logo{color:#fff}.auth .side .mark{background:rgba(255,255,255,.18)}
.auth .side h2{font-size:38px;font-weight:650;letter-spacing:-.02em;max-width:480px;line-height:1.15}
.auth .side p{opacity:.9;font-size:16px;margin-top:14px;max-width:440px}
.auth .formcol{display:flex;align-items:center;justify-content:center;background:#fff}
.auth .box{width:${mobile ? "100%" : "400px"}}
.auth .box h1{margin:${mobile ? "26px 0 6px" : "0 0 6px"}}
.auth .box .mstack{margin-top:22px}
.auth .hero{display:none}
`;
}

const statusIcons = `<span class="sicons"><svg width="18" height="12" viewBox="0 0 18 12"><rect x="0" y="8" width="3" height="4" rx="1" fill="#16181d"/><rect x="5" y="5.5" width="3" height="6.5" rx="1" fill="#16181d"/><rect x="10" y="3" width="3" height="9" rx="1" fill="#16181d"/><rect x="15" y="0" width="3" height="12" rx="1" fill="#16181d"/></svg><svg width="16" height="12" viewBox="0 0 16 12"><path d="M8 11.5 5.6 8.9a3.4 3.4 0 0 1 4.8 0z M3.3 6.6a6.6 6.6 0 0 1 9.4 0l-1.2 1.2a4.9 4.9 0 0 0-7 0z M1 4.3a9.9 9.9 0 0 1 14 0l-1.2 1.2a8.2 8.2 0 0 0-11.6 0z" fill="#16181d"/></svg><svg width="26" height="12" viewBox="0 0 26 12"><rect x=".5" y=".5" width="22" height="11" rx="3.5" fill="none" stroke="#16181d" opacity=".4"/><rect x="2" y="2" width="17" height="8" rx="2" fill="#16181d"/><rect x="23.5" y="4" width="1.8" height="4" rx=".9" fill="#16181d" opacity=".4"/></svg></span>`;

/** The page of a screen (pure). */
export function screenHtml(spec: HtmlScreen, o: { font?: string | null } = {}): string {
  const mobile = spec.device === "mobile";
  const brand = readableBrand(spec.brand);
  const font = o.font === undefined ? fontUrl() : o.font;
  const mark = `<span class="mark">${esc((spec.app.trim()[0] ?? "A").toUpperCase())}</span>`;
  const signIn = !spec.nav?.length && spec.blocks.some((b) => b.k === "field") && !spec.person;
  const head = `<h1>${esc(spec.title)}</h1>${spec.subtitle ? `<p class="sub">${esc(spec.subtitle)}</p>` : ""}`;
  let body: string;
  if (signIn) {
    const hero = spec.blocks.find((b): b is Extract<HtmlBlock, { k: "hero" }> => b.k === "hero");
    const rest = layout(spec.blocks.filter((b) => b.k !== "hero"), true).map((x) => x.html).join("");
    const box = `<div class="box">${mobile ? `<div class="logo">${mark}${esc(spec.app)}</div>` : ""}<h1>${esc(hero?.title ?? spec.title)}</h1><p class="sub">${esc(hero?.text ?? spec.subtitle ?? "")}</p><div class="mstack">${rest}</div></div>`;
    body = mobile
      ? `<div class="sbar"><span>9:41</span>${statusIcons}</div><div class="auth">${box}</div><span class="home"></span>`
      : `<div class="auth"><div class="side"><div class="logo">${mark}${esc(spec.app)}</div><div><h2>${esc(spec.subtitle || hero?.text || spec.app)}</h2></div><p>© ${esc(spec.app)}</p></div><div class="formcol">${box}</div></div>`;
  } else if (mobile) {
    const tabs = (spec.nav ?? []).slice(0, 5);
    const blocks = layout(spec.blocks, true).map((x) => x.html).join("");
    body = `<div class="sbar"><span>9:41</span>${statusIcons}</div>` +
      `<header class="mtop"><div class="logo">${mark}${esc(spec.app)}</div><div class="r">${icon("bell", 21)}${spec.person ? `<span class="avatar">${esc(initials(spec.person))}</span>` : ""}</div></header>` +
      (spec.search !== undefined ? `<div class="msearch">${icon("search", 18)}${spec.search ? `<b>${esc(spec.search)}</b>` : "Search"}</div>` : "") +
      `<main class="mpage"><div class="mhead">${head}</div><div class="mstack">${blocks}</div></main>` +
      (tabs.length ? `<nav class="tabs">${tabs.map((t, i) => `<span class="tab${i === (spec.activeNav ?? 0) ? " on" : ""}">${icon(navIcon(t), 23)}${esc(t)}</span>`).join("")}</nav>` : "") +
      `<span class="home"></span>`;
  } else {
    const nav = (spec.nav ?? []).slice(0, 6);
    const blocks = layout(spec.blocks, false).map((x) => `<div style="grid-column:span ${x.span}">${x.html}</div>`).join("");
    body = `<header class="top"><div class="logo">${mark}${esc(spec.app)}</div>` +
      (nav.length ? `<nav>${nav.map((t, i) => `<span class="${i === (spec.activeNav ?? 0) ? "on" : ""}">${esc(t)}</span>`).join("")}</nav>` : "") +
      `<div class="search">${icon("search", 18)}${spec.search ? `<b>${esc(spec.search)}</b>` : "Search"}</div>` +
      `<div class="tools">${icon("bell", 21)}${icon("cart", 21)}</div>` +
      (spec.person ? `<div class="who"><span class="avatar">${esc(initials(spec.person))}</span>${esc(spec.person)}</div>` : "") +
      `</header><main class="page"><div class="head"><div>${head}</div></div><div class="g12">${blocks}</div></main>`;
  }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(spec.title)}</title><style>${css(brand, mobile, font)}</style></head><body>${body}</body></html>`;
}

// ── the pixel fallback: the same screen in the seeded images' blocks ────────────────────────────────────────────

export function pixelSpec(spec: HtmlScreen): ScreenImage {
  const blocks: ScreenBlock[] = [];
  for (const b of spec.blocks) {
    switch (b.k) {
      case "grid": blocks.push({ k: "list", items: b.items.slice(0, 5).map((i): [string, string] => [i.title, i.price]) }); break;
      case "filters": blocks.push({ k: "note", text: b.items.join("  ·  ") }); break;
      case "summary": blocks.push({ k: "list", items: [...b.lines, ...(b.total ? [b.total] : [])] }); break;
      case "upload": blocks.push({ k: "card", title: b.title, lines: b.text ? [b.text] : [] }); break;
      case "preview": blocks.push({ k: "hero", title: b.title, text: b.text }); break;
      case "form": for (const [label, value] of b.fields) blocks.push({ k: "field", label, value }); break;
      case "rows": blocks.push({ k: "list", items: b.items.map((r): [string, string] => [r.label, r.value]) }); break;
      case "bars": blocks.push({ k: "chart", values: b.values }); break;
      default: blocks.push(b);
    }
  }
  return { type: "screen", device: spec.device, brand: readableBrand(spec.brand), app: spec.app, title: spec.title, nav: spec.nav, activeNav: spec.activeNav, blocks };
}

// ── the renderer ────────────────────────────────────────────────────────────────────────────────────────────────

export interface RenderedScreen {
  png: Uint8Array;
  /** CSS pixels (a phone screen is stored at 2x) */
  width: number;
  height: number;
  via: "html" | "pixel";
}

export interface ScreenRenderer {
  render(spec: HtmlScreen): Promise<RenderedScreen>;
  close(): Promise<void>;
}

export function renderMode(env: NodeJS.ProcessEnv = process.env): "html" | "pixel" | "auto" {
  const v = String(env.MF_ENGINE_SCREEN_RENDER ?? "").trim().toLowerCase();
  if (v === "html" || v === "pixel" || v === "auto") return v;
  return env.VITEST ? "pixel" : "auto";
}

function pixel(spec: HtmlScreen): RenderedScreen {
  const { canvas, width, height } = pixelRender(pixelSpec(spec));
  return { png: canvas.png(), width, height, via: "pixel" };
}

/** Past these the browser helper is stopped (its own steps time out before: Chromium start 20 s; page 16 s, fonts 5 s,
 *  screenshot 16 s). */
const LAUNCH_LIMIT_MS = 60_000;
const SHOT_LIMIT_MS = 60_000;

/** One renderer per job: Chromium is started on the first screen and closed with close(). */
export function screenRenderer(o: { mode?: "html" | "pixel" | "auto"; log?: (line: string) => void } = {}): ScreenRenderer {
  const mode = o.mode ?? renderMode();
  let browser: IsolatedChild | null = null;
  let starting: Promise<IsolatedChild | null> | null = null;
  let broken = mode === "pixel";
  let failures = 0;

  const start = (): Promise<IsolatedChild | null> => {
    starting ??= (async () => {
      let child: IsolatedChild | null = null;
      try {
        child = startIsolated("browser");
        await child.call("launch", { args: ["--disable-gpu", "--font-render-hinting=none"] }, { timeoutMs: LAUNCH_LIMIT_MS });
        browser = child;
        return child;
      } catch (e) {
        broken = true;
        await child?.close();
        o.log?.(`screens: Chromium unavailable (${(e as Error).message.split("\n")[0]?.slice(0, 120)}), drawing them with the pixel renderer`);
        return null;
      }
    })();
    return starting;
  };

  return {
    async render(spec) {
      if (broken) return pixel(spec);
      try {
        const b = await start();
        if (!b) throw new Error("no browser");
        const size = SIZE[spec.device];
        const png = await b.call<Uint8Array>("shot", { device: spec.device, width: size.width, height: size.height, scale: size.scale, html: screenHtml(spec) }, { timeoutMs: SHOT_LIMIT_MS });
        return { png: new Uint8Array(png), width: size.width, height: size.height, via: "html" };
      } catch (e) {
        failures += 1;
        if (!broken) o.log?.(`screens: ${spec.title} drawn with the pixel renderer (${(e as Error).message.split("\n")[0]?.slice(0, 120)})`);
        // a helper that ended has no browser for the next screens either
        if (failures >= 2 || (browser && !browser.alive)) broken = true;
        return pixel(spec);
      }
    },
    async close() {
      const b = browser ?? (starting ? await starting.catch(() => null) : null);
      browser = null;
      if (b) await b.close().catch(() => undefined);
    },
  };
}
