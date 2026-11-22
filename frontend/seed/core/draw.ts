// Renders the seeded images: app screens (mobile at 2x, desktop at 1x), whiteboard photos from workshops, brand style
// sheets. Each spec is plain data so a project module can describe a screen in a few lines.
import { Canvas, hex, mix, type Rgb } from "./png";

export type ScreenBlock =
  | { k: "hero"; title: string; text?: string }
  | { k: "heading"; text: string }
  | { k: "card"; title: string; lines?: string[]; badge?: string; tone?: "ok" | "warn" | "info" }
  | { k: "list"; items: [string, string][] }
  | { k: "button"; text: string; secondary?: boolean }
  | { k: "field"; label: string; value?: string }
  | { k: "stats"; items: [string, string][] }
  | { k: "table"; head: string[]; rows: string[][] }
  | { k: "steps"; items: string[]; active: number }
  | { k: "map"; pins?: number }
  | { k: "chart"; values: number[] }
  | { k: "note"; text: string };

export interface ScreenImage {
  type: "screen";
  device: "mobile" | "desktop";
  brand: string;
  title: string;
  app: string;
  nav?: string[];
  activeNav?: number;
  blocks: ScreenBlock[];
  /** A red ring someone drew on a screenshot (fractions of width / height). */
  mark?: { x: number; y: number; r: number };
}

export interface WhiteboardImage {
  type: "whiteboard";
  title: string;
  boxes: { x: number; y: number; w: number; h: number; label: string; color?: "blue" | "black" | "red" | "green" }[];
  arrows: [number, number][];
  stickies?: { x: number; y: number; text: string }[];
}

export interface StyleSheetImage {
  type: "stylesheet";
  company: string;
  swatches: [string, string][];
  notes: string[];
}

export type ImageSpec = ScreenImage | WhiteboardImage | StyleSheetImage;

const INK: Rgb = hex("1f2933");
const MUTED: Rgb = hex("6b7785");
const LINE: Rgb = hex("e3e7ec");
const SURFACE: Rgb = hex("f5f7f9");
const WHITE: Rgb = [255, 255, 255];
const TONES = { ok: hex("1f9d63"), warn: hex("d97706"), info: hex("2563eb") } as const;

export function render(spec: ImageSpec): { canvas: Canvas; width: number; height: number } {
  if (spec.type === "screen") return spec.device === "mobile" ? mobile(spec) : desktop(spec);
  if (spec.type === "whiteboard") return { ...whiteboard(spec), width: 1600, height: 1200 };
  return { canvas: stylesheet(spec), width: 1200, height: 800 };
}

// ── screens ─────────────────────────────────────────────────────────────────────────────────────────────────────

interface Pen {
  c: Canvas;
  x: number;
  y: number;
  w: number;
  /** pixels per font cell for body text */
  s: number;
  brand: Rgb;
}

function blocks(p: Pen, list: readonly ScreenBlock[], maxY: number): void {
  const gap = 8 * p.s;
  const chars = (scale: number, width = p.w - 2 * p.s * 6) => Math.max(8, Math.floor(width / (6 * scale)));
  for (const b of list) {
    if (p.y > maxY) return;
    const { c, s } = p;
    switch (b.k) {
      case "hero": {
        const lines = b.text ? Canvas.wrap(b.text, chars(s)) : [];
        const h = 18 * s + 10 * s * lines.length + 8 * s;
        c.round(p.x, p.y, p.w, h, 6 * s, mix(p.brand, WHITE, 0.88));
        c.text(p.x + 6 * s, p.y + 6 * s, b.title, p.brand, s + 1);
        lines.forEach((l, i) => c.text(p.x + 6 * s, p.y + 18 * s + i * 10 * s, l, INK, s));
        p.y += h + gap;
        break;
      }
      case "heading":
        c.text(p.x, p.y, b.text, INK, s + 1);
        p.y += 12 * s + gap;
        break;
      case "card": {
        const lines = (b.lines ?? []).flatMap((l) => Canvas.wrap(l, chars(s, p.w - 20 * s)));
        const h = 16 * s + 10 * s * lines.length + 4 * s;
        c.round(p.x, p.y, p.w, h, 5 * s, WHITE);
        c.box(p.x, p.y, p.w, h, LINE, Math.max(1, s / 2));
        c.text(p.x + 6 * s, p.y + 6 * s, b.title, INK, s);
        lines.forEach((l, i) => c.text(p.x + 6 * s, p.y + 16 * s + i * 10 * s, l, MUTED, s));
        if (b.badge) {
          const tone = TONES[b.tone ?? "info"];
          const bw = Canvas.textWidth(b.badge, s) + 8 * s;
          c.round(p.x + p.w - bw - 6 * s, p.y + 4 * s, bw, 11 * s, 5 * s, mix(tone, WHITE, 0.85));
          c.text(p.x + p.w - bw - 2 * s, p.y + 6 * s, b.badge, tone, s);
        }
        p.y += h + gap;
        break;
      }
      case "list": {
        for (const [title, meta] of b.items) {
          c.fill(p.x, p.y, p.w, 18 * s, WHITE);
          c.fill(p.x, p.y + 18 * s, p.w, Math.max(1, s / 2), LINE);
          c.disc(p.x + 8 * s, p.y + 9 * s, 4 * s, mix(p.brand, WHITE, 0.6));
          c.text(p.x + 18 * s, p.y + 6 * s, title.slice(0, chars(s) - 12), INK, s);
          c.text(p.x + p.w - Canvas.textWidth(meta, s) - 4 * s, p.y + 6 * s, meta, MUTED, s);
          p.y += 19 * s;
        }
        p.y += gap;
        break;
      }
      case "button": {
        const h = 18 * s;
        if (b.secondary) {
          c.round(p.x, p.y, p.w, h, 5 * s, WHITE);
          c.box(p.x, p.y, p.w, h, p.brand, Math.max(1, s / 2));
        } else c.round(p.x, p.y, p.w, h, 5 * s, p.brand);
        c.text(p.x + (p.w - Canvas.textWidth(b.text, s)) / 2, p.y + 6 * s, b.text, b.secondary ? p.brand : WHITE, s);
        p.y += h + gap;
        break;
      }
      case "field": {
        c.text(p.x, p.y, b.label, MUTED, s);
        c.round(p.x, p.y + 9 * s, p.w, 16 * s, 4 * s, WHITE);
        c.box(p.x, p.y + 9 * s, p.w, 16 * s, LINE, Math.max(1, s / 2));
        if (b.value) c.text(p.x + 5 * s, p.y + 14 * s, b.value, INK, s);
        p.y += 26 * s + gap;
        break;
      }
      case "stats": {
        const n = b.items.length;
        const cw = (p.w - (n - 1) * 4 * s) / n;
        b.items.forEach(([label, value], i) => {
          const x = p.x + i * (cw + 4 * s);
          c.round(x, p.y, cw, 28 * s, 5 * s, WHITE);
          c.box(x, p.y, cw, 28 * s, LINE, Math.max(1, s / 2));
          c.text(x + 5 * s, p.y + 5 * s, label, MUTED, s);
          c.text(x + 5 * s, p.y + 14 * s, value, INK, s + 1);
        });
        p.y += 28 * s + gap;
        break;
      }
      case "table": {
        const cols = b.head.length;
        const cw = p.w / cols;
        c.fill(p.x, p.y, p.w, 14 * s, SURFACE);
        b.head.forEach((h, i) => c.text(p.x + i * cw + 4 * s, p.y + 4 * s, h, MUTED, s));
        p.y += 14 * s;
        for (const row of b.rows) {
          c.fill(p.x, p.y, p.w, 14 * s, WHITE);
          c.fill(p.x, p.y + 14 * s, p.w, Math.max(1, s / 2), LINE);
          row.forEach((v, i) => c.text(p.x + i * cw + 4 * s, p.y + 4 * s, v.slice(0, Math.floor(cw / (6 * s)) - 1), INK, s));
          p.y += 15 * s;
        }
        p.y += gap;
        break;
      }
      case "steps": {
        const n = b.items.length;
        const step = p.w / n;
        b.items.forEach((label, i) => {
          const cx = p.x + step * i + step / 2;
          const done = i <= b.active;
          if (i > 0) c.line(cx - step + 7 * s, p.y + 7 * s, cx - 7 * s, p.y + 7 * s, done ? p.brand : LINE, Math.max(2, s));
          c.disc(cx, p.y + 7 * s, 6 * s, done ? p.brand : LINE);
          const short = label.slice(0, Math.floor(step / (6 * s)));
          c.text(cx - Canvas.textWidth(short, s) / 2, p.y + 17 * s, short, done ? INK : MUTED, s);
        });
        p.y += 28 * s + gap;
        break;
      }
      case "map": {
        const h = 90 * s;
        c.round(p.x, p.y, p.w, h, 5 * s, hex("e8efe6"));
        for (let i = 0; i < 6; i++) c.line(p.x, p.y + (i * h) / 6 + 6 * s, p.x + p.w, p.y + ((i + 2) * h) / 7, WHITE, 3 * s);
        for (let i = 0; i < 4; i++) c.line(p.x + (i * p.w) / 4 + 10 * s, p.y, p.x + ((i + 1) * p.w) / 5, p.y + h, WHITE, 2 * s);
        for (let i = 0; i < (b.pins ?? 4); i++) {
          const px = p.x + ((i * 37 + 19) % 90) * (p.w / 100) + 6 * s;
          const py = p.y + ((i * 53 + 23) % 80) * (h / 100) + 6 * s;
          c.disc(px, py, 5 * s, i === 0 ? p.brand : hex("e11d48"));
          c.disc(px, py, 2 * s, WHITE);
        }
        p.y += h + gap;
        break;
      }
      case "chart": {
        const h = 60 * s;
        c.round(p.x, p.y, p.w, h, 5 * s, WHITE);
        c.box(p.x, p.y, p.w, h, LINE, Math.max(1, s / 2));
        const max = Math.max(...b.values, 1);
        const bw = (p.w - 12 * s) / b.values.length;
        b.values.forEach((v, i) => {
          const bh = ((h - 14 * s) * v) / max;
          c.fill(p.x + 6 * s + i * bw + bw * 0.15, p.y + h - 6 * s - bh, bw * 0.7, bh, i === b.values.length - 1 ? p.brand : mix(p.brand, WHITE, 0.55));
        });
        p.y += h + gap;
        break;
      }
      case "note": {
        const lines = Canvas.wrap(b.text, chars(s));
        lines.forEach((l, i) => c.text(p.x, p.y + i * 10 * s, l, MUTED, s));
        p.y += lines.length * 10 * s + gap;
        break;
      }
    }
  }
}

function mobile(spec: ScreenImage): { canvas: Canvas; width: number; height: number } {
  const S = 2; // drawn at 2x
  const W = 390 * S;
  const H = 844 * S;
  const brand = hex(spec.brand);
  const c = new Canvas(W, H, SURFACE);
  // status bar and app bar
  c.fill(0, 0, W, 44 * S, mix(brand, INK, 0.25));
  c.text(16 * S, 16 * S, "9:41", WHITE, S + 1);
  c.fill(W - 70 * S, 18 * S, 40 * S, 10 * S, WHITE);
  c.fill(0, 44 * S, W, 64 * S, brand);
  c.text(16 * S, 60 * S, spec.app, mix(brand, WHITE, 0.7), S);
  c.text(16 * S, 76 * S, spec.title, WHITE, S + 2);
  const navH = spec.nav?.length ? 72 * S : 0;
  blocks({ c, x: 16 * S, y: 124 * S, w: W - 32 * S, s: S + 1, brand }, spec.blocks, H - navH - 40 * S);
  if (spec.nav?.length) {
    c.fill(0, H - navH, W, navH, WHITE);
    c.fill(0, H - navH, W, S, LINE);
    const step = W / spec.nav.length;
    spec.nav.forEach((label, i) => {
      const on = i === (spec.activeNav ?? 0);
      const cx = step * i + step / 2;
      c.round(cx - 12 * S, H - navH + 12 * S, 24 * S, 24 * S, 6 * S, on ? brand : LINE);
      const short = label.slice(0, 9);
      c.text(cx - Canvas.textWidth(short, S) / 2, H - navH + 44 * S, short, on ? brand : MUTED, S);
    });
  }
  if (spec.mark) c.ring(spec.mark.x * W, spec.mark.y * H, spec.mark.r * W, hex("e11d48"), 5 * S);
  return { canvas: c, width: 390, height: 844 };
}

function desktop(spec: ScreenImage): { canvas: Canvas; width: number; height: number } {
  const W = 1440;
  const H = 900;
  const brand = hex(spec.brand);
  const c = new Canvas(W, H, SURFACE);
  const side = 248;
  c.fill(0, 0, side, H, mix(brand, INK, 0.55));
  c.round(24, 24, 40, 40, 10, brand);
  c.text(76, 36, spec.app.slice(0, 14), WHITE, spec.app.length > 13 ? 1 : 2);
  (spec.nav ?? []).forEach((label, i) => {
    const on = i === (spec.activeNav ?? 0);
    if (on) c.round(16, 96 + i * 48, side - 32, 38, 8, mix(brand, WHITE, 0.15));
    c.text(32, 108 + i * 48, label.slice(0, 17), on ? WHITE : mix(WHITE, brand, 0.45), 2);
  });
  c.fill(side, 0, W - side, 72, WHITE);
  c.fill(side, 72, W - side, 1, LINE);
  c.text(side + 32, 26, spec.title, INK, 3);
  c.disc(W - 48, 36, 18, mix(brand, WHITE, 0.6));
  blocks({ c, x: side + 32, y: 100, w: Math.min(W - side - 64, 1000), s: 2, brand }, spec.blocks, H - 40);
  if (spec.mark) c.ring(spec.mark.x * W, spec.mark.y * H, spec.mark.r * W, hex("e11d48"), 6);
  return { canvas: c, width: W, height: H };
}

// ── whiteboard photo ────────────────────────────────────────────────────────────────────────────────────────────

const MARKERS = { blue: hex("1d4ed8"), black: hex("222222"), red: hex("c81e1e"), green: hex("15803d") } as const;

function whiteboard(spec: WhiteboardImage): { canvas: Canvas } {
  const W = 1600;
  const H = 1200;
  const c = new Canvas(W, H, hex("8a8f94"));
  // the board, slightly lit from the top left
  for (let y = 40; y < H - 40; y += 4) {
    for (let x = 40; x < W - 40; x += 4) {
      const t = ((x - 40) / (W - 80)) * 0.5 + ((y - 40) / (H - 80)) * 0.5;
      c.fill(x, y, 4, 4, mix(hex("fbfbf8"), hex("dcdcd6"), t * 0.8));
    }
  }
  c.box(40, 40, W - 80, H - 80, hex("b8bcc0"), 10);
  c.text(110, 90, spec.title, MARKERS.black, 6);
  c.line(110, 150, 110 + Canvas.textWidth(spec.title, 6), 154, MARKERS.black, 4);
  const centre = (i: number) => {
    const b = spec.boxes[i]!;
    return [b.x + b.w / 2, b.y + b.h / 2] as const;
  };
  for (const [a, b] of spec.arrows) {
    const [x0, y0] = centre(a);
    const [x1, y1] = centre(b);
    c.line(x0, y0, x1, y1, MARKERS.black, 4);
    const ang = Math.atan2(y1 - y0, x1 - x0);
    const bx = spec.boxes[b]!;
    const cos = Math.abs(Math.cos(ang)) || 1e-6;
    const sin = Math.abs(Math.sin(ang)) || 1e-6;
    const back = Math.min(bx.w / 2 / cos, bx.h / 2 / sin) + 6;
    const tx = x1 - Math.cos(ang) * back;
    const ty = y1 - Math.sin(ang) * back;
    c.line(tx, ty, tx - Math.cos(ang - 0.45) * 30, ty - Math.sin(ang - 0.45) * 30, MARKERS.black, 4);
    c.line(tx, ty, tx - Math.cos(ang + 0.45) * 30, ty - Math.sin(ang + 0.45) * 30, MARKERS.black, 4);
  }
  for (const b of spec.boxes) {
    const ink = MARKERS[b.color ?? "blue"];
    c.fill(b.x, b.y, b.w, b.h, hex("fbfbf8"));
    c.box(b.x, b.y, b.w, b.h, ink, 5);
    const lines = Canvas.wrap(b.label, Math.max(6, Math.floor((b.w - 30) / 24)));
    lines.forEach((l, i) => c.text(b.x + 16, b.y + 18 + i * 34, l, ink, 4));
  }
  for (const s of spec.stickies ?? []) {
    c.fill(s.x + 6, s.y + 6, 220, 180, hex("c9c08a"));
    c.fill(s.x, s.y, 220, 180, hex("fde68a"));
    Canvas.wrap(s.text, 11).forEach((l, i) => c.text(s.x + 14, s.y + 18 + i * 28, l, MARKERS.black, 3));
  }
  return { canvas: c };
}

// ── brand style sheet ───────────────────────────────────────────────────────────────────────────────────────────

function stylesheet(spec: StyleSheetImage): Canvas {
  const c = new Canvas(1200, 800, WHITE);
  const first = hex(spec.swatches[0]?.[1] ?? "334155");
  c.fill(0, 0, 1200, 110, first);
  c.disc(90, 55, 32, WHITE);
  const initials = spec.company.split(/\s+/).map((w) => w[0]).join("").slice(0, 2);
  c.text(90 - Canvas.textWidth(initials, 4) / 2, 41, initials, first, 4);
  c.text(150, 30, spec.company, WHITE, 4);
  c.text(150, 72, "BRAND AND UI STYLE SHEET", mix(WHITE, first, 0.35), 2);
  spec.swatches.forEach(([name, color], i) => {
    const x = 60 + i * 180;
    c.round(x, 150, 150, 150, 14, hex(color));
    c.text(x, 316, name, INK, 2);
    c.text(x, 340, `#${color.toUpperCase()}`, MUTED, 2);
  });
  c.text(60, 400, "TYPE", MUTED, 2);
  c.text(60, 430, "HEADLINE 32", INK, 5);
  c.text(60, 490, "BODY TEXT 16 - CALM, CLEAR, FRIENDLY", INK, 2);
  c.round(60, 540, 220, 56, 12, first);
  c.text(60 + (220 - Canvas.textWidth("PRIMARY", 3)) / 2, 558, "PRIMARY", WHITE, 3);
  c.round(300, 540, 220, 56, 12, WHITE);
  c.box(300, 540, 220, 56, first, 3);
  c.text(300 + (220 - Canvas.textWidth("SECONDARY", 3)) / 2, 558, "SECONDARY", first, 3);
  spec.notes.forEach((n, i) => c.text(620, 410 + i * 34, `- ${n}`.slice(0, 46), INK, 2));
  return c;
}
