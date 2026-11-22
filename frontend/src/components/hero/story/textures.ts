/** Story scene artwork, drawn once into canvases (no font or image fetching): the brief's source material, the agent
 *  glyphs, the printed app and the micro-labels. The same artwork in both themes (every shape, width, size and
 *  position), only its ink differs: neon light on dark; on light the same neon in daylight: saturated blue strokes
 *  (dark's white-hot ones) with a blue glow of the same blur, mid-blue secondary detail, translucent white glass and
 *  ink text. */
import { CanvasTexture, SRGBColorSpace, type Texture } from "three";
import { t } from "@/i18n";

export interface Ink {
  light: boolean;
  line: string; // bright strokes
  soft: string; // text lines, secondary strokes
  faint: string; // tertiary detail
  fill: string; // soft panel fill
  glassTop: string;
  glassBottom: string;
  glow: string; // canvas shadow colour (the drawn bloom)
  blur: number;
  accent: string;
  accentFill: string;
  text: string;
  ok: string;
  warn: string;
  label: string; // small labels
}

export const DARK_INK: Ink = {
  light: false,
  line: "rgba(222,233,255,0.96)", soft: "rgba(157,184,255,0.62)", faint: "rgba(120,150,235,0.32)",
  fill: "rgba(46,104,255,0.20)", glassTop: "rgba(70,120,255,0.20)", glassBottom: "rgba(40,80,220,0.07)",
  glow: "rgba(46,104,255,0.95)", blur: 10, accent: "#9DB8FF", accentFill: "rgba(46,104,255,0.55)",
  text: "rgba(228,236,255,0.96)", ok: "#46D39A", warn: "#FFB547", label: "rgba(157,184,255,0.62)",
};

/** light: dark's ink translated: white-hot strokes as saturated blue, pale detail as mid blue, the blue glass as a
 *  translucent white tint, pass green and amber in dark's hues, deep enough to read on the light canvas */
export const LIGHT_INK: Ink = {
  light: true,
  line: "#1F5BFF", soft: "rgba(77,123,255,0.66)", faint: "rgba(77,123,255,0.34)",
  fill: "rgba(46,104,255,0.08)", glassTop: "rgba(240,245,255,0.62)", glassBottom: "rgba(240,245,255,0.42)",
  glow: "rgba(46,104,255,0.9)", blur: 10, accent: "#4D7BFF", accentFill: "rgba(46,104,255,0.28)",
  text: "#14244A", ok: "#29AD78", warn: "#FF9800", label: "#3559C7",
};

/** the glow behind text: light keeps it soft, so the words stay crisp */
const textGlow = (ink: Ink) => (ink.light ? "rgba(46,104,255,0.4)" : ink.glow);

const MONO = '"JetBrains Mono Variable", "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
const SANS = '"Outfit Variable", "Outfit", ui-sans-serif, system-ui, sans-serif';

function make(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  g.lineCap = "round";
  g.lineJoin = "round";
  return { c, g };
}

function done(c: HTMLCanvasElement): Texture {
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function rr(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

function glowStroke(g: CanvasRenderingContext2D, ink: Ink, color: string, width: number, blur = ink.blur) {
  g.strokeStyle = color;
  g.lineWidth = width;
  g.shadowColor = ink.glow;
  g.shadowBlur = blur;
  g.stroke();
  // light: the glow laid twice, so it reads on the light canvas (dark's additive glow gets the display curve's lift)
  if (ink.light && blur > 0) g.stroke();
  g.shadowBlur = 0;
}

function bar(g: CanvasRenderingContext2D, x: number, y: number, len: number, color: string, width: number) {
  g.beginPath();
  g.moveTo(x, y);
  g.lineTo(x + len, y);
  g.strokeStyle = color;
  g.lineWidth = width;
  g.stroke();
}

/** a soft round light, for sprites */
export function glowTexture(): Texture {
  const s = 128;
  const { c, g } = make(s, s);
  const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.1, "rgba(255,255,255,0.75)");
  grd.addColorStop(0.3, "rgba(255,255,255,0.24)");
  grd.addColorStop(0.6, "rgba(255,255,255,0.05)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, s, s);
  const t = new CanvasTexture(c);
  return t;
}

/* ── the brief's source material ───────────────────────────────────────────── */

export type CardKind = "email" | "pdf" | "notes" | "board" | "shot";

/** a glass card: frosted panel, thin neon edge, its content in light lines (light theme: translucent white glass, a
 *  saturated blue neon edge with its glow, its content in blue) */
export function cardTexture(kind: CardKind, wu: number, hu: number, ink: Ink): Texture {
  const PX = 330;
  const w = Math.round(wu * PX);
  const h = Math.round(hu * PX);
  const { c, g } = make(w, h);
  const m = 10;
  const iw = w - m * 2;
  const ih = h - m * 2;
  const grd = g.createLinearGradient(0, m, 0, h - m);
  grd.addColorStop(0, ink.glassTop);
  grd.addColorStop(1, ink.glassBottom);
  rr(g, m, m, iw, ih, 16);
  g.fillStyle = grd;
  g.fill();
  rr(g, m, m, iw, ih, 16);
  glowStroke(g, ink, ink.line, 2.2);
  // a sheen across the top edge
  rr(g, m + 14, m + 1, iw * 0.45, 1.5, 1);
  g.fillStyle = ink.line;
  g.fill();

  const x0 = m + 22;
  const y0 = m + 24;
  const right = w - m - 22;
  const span = right - x0;

  if (kind === "email") {
    // envelope
    rr(g, x0, y0, 46, 32, 4);
    glowStroke(g, ink, ink.line, 2.4);
    g.beginPath();
    g.moveTo(x0 + 2, y0 + 3);
    g.lineTo(x0 + 23, y0 + 19);
    g.lineTo(x0 + 44, y0 + 3);
    glowStroke(g, ink, ink.line, 2.2);
    bar(g, x0 + 62, y0 + 8, span * 0.38, ink.line, 5);
    bar(g, x0 + 62, y0 + 24, span * 0.24, ink.soft, 3.5);
    bar(g, x0, y0 + 58, span * 0.72, ink.line, 6);
    g.fillStyle = ink.faint;
    g.fillRect(x0, y0 + 76, span, 1.5);
    const lines = [0.96, 0.88, 0.93, 0.62, 0.9, 0.78, 0.45];
    lines.forEach((f, i) => { if (y0 + 98 + i * 20 < h - m - 16) bar(g, x0, y0 + 98 + i * 20, span * f, ink.soft, 4); });
  } else if (kind === "pdf") {
    rr(g, m + 1, m + 1, iw - 2, 54, 15);
    g.fillStyle = ink.fill;
    g.fill();
    rr(g, x0, y0 - 6, 52, 26, 6);
    g.fillStyle = ink.accentFill;
    g.fill();
    g.font = `700 16px ${MONO}`;
    g.fillStyle = ink.text;
    g.textBaseline = "middle";
    g.fillText("PDF", x0 + 9, y0 + 7);
    bar(g, x0 + 66, y0 + 7, span * 0.4, ink.soft, 4);
    bar(g, x0, y0 + 64, span * 0.8, ink.line, 7);
    bar(g, x0, y0 + 84, span * 0.5, ink.soft, 4);
    let y = y0 + 112;
    for (let p = 0; p < 3 && y < h - m - 20; p++) {
      const n = p === 1 ? 2 : 3;
      for (let i = 0; i < n && y < h - m - 20; i++) {
        bar(g, x0, y, span * (i === n - 1 ? 0.55 : 0.95), ink.soft, 4);
        y += 17;
      }
      if (p === 0 && y + 70 < h - m - 20) {
        rr(g, x0, y + 4, span * 0.55, 62, 6);
        glowStroke(g, ink, ink.soft, 2, 4);
        g.beginPath();
        g.moveTo(x0 + 8, y + 58);
        g.lineTo(x0 + 34, y + 30);
        g.lineTo(x0 + 54, y + 46);
        g.lineTo(x0 + 78, y + 20);
        g.lineTo(x0 + span * 0.55 - 8, y + 50);
        glowStroke(g, ink, ink.line, 2, 4);
        y += 84;
      }
      y += 10;
    }
  } else if (kind === "notes") {
    g.font = `600 19px ${SANS}`;
    g.fillStyle = ink.text;
    g.textBaseline = "middle";
    g.fillText(t("landing.scene.meetingNotes", "Meeting notes"), x0, y0 + 6);
    g.font = `500 13px ${MONO}`;
    g.fillStyle = ink.light ? ink.label : ink.soft;
    g.fillText("10:30", right - 44, y0 + 7);
    g.fillStyle = ink.faint;
    g.fillRect(x0, y0 + 26, span, 1.5);
    const rows = [0.8, 0.62, 0.9, 0.5, 0.74, 0.66, 0.84];
    rows.forEach((f, i) => {
      const y = y0 + 52 + i * 27;
      if (y > h - m - 14) return;
      g.beginPath();
      g.arc(x0 + 4, y, 3.6, 0, Math.PI * 2);
      g.fillStyle = ink.line;
      g.shadowColor = ink.glow;
      g.shadowBlur = ink.blur * 0.6;
      g.fill();
      g.shadowBlur = 0;
      bar(g, x0 + 18, y, (span - 18) * f, i === 2 ? ink.line : ink.soft, 4);
    });
  } else if (kind === "board") {
    // a whiteboard photo: hand-drawn boxes, arrows and sticky notes
    const jit = (v: number, k: number) => v + Math.sin(k * 12.9898) * 1.6;
    const box = (x: number, y: number, bw: number, bh: number, k: number) => {
      g.beginPath();
      g.moveTo(jit(x, k), jit(y, k + 1));
      g.lineTo(jit(x + bw, k + 2), jit(y, k + 3));
      g.lineTo(jit(x + bw, k + 4), jit(y + bh, k + 5));
      g.lineTo(jit(x, k + 6), jit(y + bh, k + 7));
      g.closePath();
      glowStroke(g, ink, ink.line, 2.6, ink.blur * 0.7);
    };
    const arrow = (x1: number, y1: number, x2: number, y2: number) => {
      g.beginPath();
      g.moveTo(x1, y1);
      g.quadraticCurveTo((x1 + x2) / 2, Math.min(y1, y2) - 14, x2, y2);
      glowStroke(g, ink, ink.soft, 2.4, 4);
      const a = Math.atan2(y2 - (Math.min(y1, y2) - 14), x2 - (x1 + x2) / 2);
      g.beginPath();
      g.moveTo(x2, y2);
      g.lineTo(x2 - 11 * Math.cos(a - 0.45), y2 - 11 * Math.sin(a - 0.45));
      g.moveTo(x2, y2);
      g.lineTo(x2 - 11 * Math.cos(a + 0.45), y2 - 11 * Math.sin(a + 0.45));
      glowStroke(g, ink, ink.soft, 2.4, 4);
    };
    const bw = span * 0.26;
    box(x0, y0 + 30, bw, 48, 1);
    box(x0 + span * 0.37, y0 + 8, bw, 48, 9);
    box(x0 + span * 0.74, y0 + 34, bw, 48, 17);
    box(x0 + span * 0.37, y0 + 104, bw * 1.1, 44, 25);
    arrow(x0 + bw, y0 + 46, x0 + span * 0.37 - 4, y0 + 36);
    arrow(x0 + span * 0.37 + bw, y0 + 30, x0 + span * 0.74 - 4, y0 + 52);
    arrow(x0 + span * 0.5, y0 + 60, x0 + span * 0.5, y0 + 100);
    [[x0 + 6, y0 + 112], [x0 + span * 0.78, y0 + 108]].forEach(([sx, sy], i) => {
      rr(g, sx, sy, 38, 36, 3);
      g.fillStyle = i === 0 ? ink.accentFill : ink.fill;
      g.fill();
      bar(g, sx + 7, sy + 13, 22, ink.line, 2.5);
      bar(g, sx + 7, sy + 23, 15, ink.line, 2.5);
    });
    [0.18, 0.12, 0.2].forEach((f, i) => bar(g, x0 + span * (0.04 + i * 0.37), y0 + 92 - (i === 1 ? 26 : 0), span * f, ink.soft, 3));
  } else {
    // a screenshot: window chrome and a table
    [0, 1, 2].forEach((i) => {
      g.beginPath();
      g.arc(x0 + 6 + i * 16, y0 + 2, 4.4, 0, Math.PI * 2);
      g.fillStyle = i === 0 ? ink.line : ink.soft;
      g.fill();
    });
    rr(g, x0 + 62, y0 - 7, span - 62, 18, 9);
    g.fillStyle = ink.fill;
    g.fill();
    const top = y0 + 26;
    const rows = 5;
    const rh = Math.min(26, (h - m - 16 - top) / rows);
    const cols = [0, 0.3, 0.58, 0.8, 1];
    rr(g, x0, top, span, rh, 4);
    g.fillStyle = ink.accentFill;
    g.fill();
    for (let r = 0; r <= rows; r++) {
      g.fillStyle = r === 0 || r === rows ? ink.soft : ink.faint;
      g.fillRect(x0, top + r * rh, span, 1.5);
    }
    cols.forEach((f) => { g.fillStyle = ink.faint; g.fillRect(x0 + span * f, top, 1.5, rh * rows); });
    for (let r = 0; r < rows; r++) {
      for (let k = 0; k < 4; k++) {
        const cw = span * (cols[k + 1] - cols[k]);
        bar(g, x0 + span * cols[k] + 8, top + r * rh + rh / 2, cw * (r === 0 ? 0.5 : 0.35 + ((r * 3 + k * 5) % 5) * 0.09), r === 0 ? ink.line : ink.soft, r === 0 ? 4 : 3.2);
      }
    }
  }
  return done(c);
}

/* ── the agents' glyphs ────────────────────────────────────────────────────── */

/** glyph texture size; sprites keep this aspect */
export const GLYPH_ASPECT = 160 / 200;

/** 01 plan grid, 02 code, 03 review check, 04 test pulse, 05 shield, 06 doc page, 07 release flag, deploy cloud-up
 *  (light theme: saturated blue neon strokes, blue numbers) */
export function glyphTextures(ink: Ink): Texture[] {
  const cw = 160;
  const ch = 200;
  const labels = ["01", "02", "03", "04", "05", "06", "07", "BLOCKS"];
  const out: Texture[] = [];
  for (let k = 0; k < 8; k++) {
    const { c, g } = make(cw, ch);
    const cx = cw / 2;
    const cy = 78;
    g.beginPath();
    switch (k) {
      case 0: // plan grid
        for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) g.roundRect(cx - 36 + i * 40, cy - 36 + j * 40, 32, 32, 6);
        break;
      case 1: // </>
        g.moveTo(cx - 20, cy - 26); g.lineTo(cx - 44, cy); g.lineTo(cx - 20, cy + 26);
        g.moveTo(cx + 20, cy - 26); g.lineTo(cx + 44, cy); g.lineTo(cx + 20, cy + 26);
        g.moveTo(cx + 9, cy - 32); g.lineTo(cx - 9, cy + 32);
        break;
      case 2: // review check
        g.arc(cx, cy, 38, 0, Math.PI * 2);
        g.moveTo(cx - 18, cy + 1); g.lineTo(cx - 5, cy + 15); g.lineTo(cx + 20, cy - 13);
        break;
      case 3: // test pulse
        g.moveTo(cx - 48, cy); g.lineTo(cx - 24, cy); g.lineTo(cx - 13, cy - 28); g.lineTo(cx + 2, cy + 30);
        g.lineTo(cx + 14, cy - 10); g.lineTo(cx + 22, cy); g.lineTo(cx + 48, cy);
        break;
      case 4: // shield
        g.moveTo(cx, cy - 40); g.lineTo(cx + 34, cy - 28); g.lineTo(cx + 32, cy + 4);
        g.quadraticCurveTo(cx + 26, cy + 30, cx, cy + 42); g.quadraticCurveTo(cx - 26, cy + 30, cx - 32, cy + 4);
        g.lineTo(cx - 34, cy - 28); g.closePath();
        g.moveTo(cx - 13, cy + 1); g.lineTo(cx - 3, cy + 12); g.lineTo(cx + 15, cy - 9);
        break;
      case 5: // doc page
        g.moveTo(cx - 28, cy - 40); g.lineTo(cx + 12, cy - 40); g.lineTo(cx + 30, cy - 22); g.lineTo(cx + 30, cy + 40);
        g.lineTo(cx - 28, cy + 40); g.closePath();
        g.moveTo(cx + 12, cy - 40); g.lineTo(cx + 12, cy - 22); g.lineTo(cx + 30, cy - 22);
        g.moveTo(cx - 16, cy - 6); g.lineTo(cx + 18, cy - 6);
        g.moveTo(cx - 16, cy + 8); g.lineTo(cx + 18, cy + 8);
        g.moveTo(cx - 16, cy + 22); g.lineTo(cx + 6, cy + 22);
        break;
      case 6: // release flag on a gate post
        g.moveTo(cx - 26, cy + 42); g.lineTo(cx - 26, cy - 40);
        g.moveTo(cx - 26, cy - 36); g.lineTo(cx + 30, cy - 36); g.lineTo(cx + 18, cy - 20); g.lineTo(cx + 30, cy - 4); g.lineTo(cx - 26, cy - 4);
        g.moveTo(cx - 40, cy + 42); g.lineTo(cx + 40, cy + 42);
        break;
      default: // cloud with an up arrow
        g.moveTo(cx - 30, cy + 26);
        g.bezierCurveTo(cx - 54, cy + 26, cx - 54, cy - 6, cx - 30, cy - 6);
        g.bezierCurveTo(cx - 28, cy - 36, cx + 18, cy - 42, cx + 26, cy - 12);
        g.bezierCurveTo(cx + 54, cy - 14, cx + 54, cy + 26, cx + 30, cy + 26);
        g.moveTo(cx, cy + 34); g.lineTo(cx, cy - 6);
        g.moveTo(cx - 13, cy + 7); g.lineTo(cx, cy - 6); g.lineTo(cx + 13, cy + 7);
    }
    glowStroke(g, ink, ink.line, 6.5, ink.blur * 1.2);
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = `600 ${k === 7 ? 22 : 26}px ${MONO}`;
    g.fillStyle = ink.light ? ink.label : ink.soft;
    g.fillText(labels[k], cx, 168);
    out.push(done(c));
  }
  return out;
}

/* ── the printed app ───────────────────────────────────────────────────────── */

export function dashboardTexture(ink: Ink): Texture {
  const W = 720;
  const H = 450;
  const { c, g } = make(W, H);
  rr(g, 4, 4, W - 8, H - 8, 22);
  const grd = g.createLinearGradient(0, 0, 0, H);
  grd.addColorStop(0, ink.glassTop);
  grd.addColorStop(1, ink.glassBottom);
  g.fillStyle = grd;
  g.fill();
  // title bar
  [0, 1, 2].forEach((i) => { g.beginPath(); g.arc(30 + i * 20, 30, 5.5, 0, Math.PI * 2); g.fillStyle = i === 0 ? ink.line : ink.soft; g.fill(); });
  rr(g, 260, 18, 200, 24, 12);
  g.fillStyle = ink.fill;
  g.fill();
  g.fillStyle = ink.faint;
  g.fillRect(4, 56, W - 8, 1.5);
  // sidebar
  rr(g, 22, 76, 120, H - 98, 12);
  g.fillStyle = ink.fill;
  g.fill();
  [0.8, 0.6, 0.7, 0.5, 0.65].forEach((f, i) => {
    if (i === 1) { rr(g, 32, 92 + i * 34, 100, 26, 8); g.fillStyle = ink.accentFill; g.fill(); }
    bar(g, 44, 105 + i * 34, 76 * f, i === 1 ? ink.line : ink.soft, 4.5);
  });
  // KPI cards
  const kx = 162;
  const kw = (W - kx - 22 - 2 * 14) / 3;
  ["2,481", "98.6%", "1.2s"].forEach((v, i) => {
    const x = kx + i * (kw + 14);
    rr(g, x, 76, kw, 84, 12);
    g.fillStyle = ink.fill;
    g.fill();
    rr(g, x, 76, kw, 84, 12);
    glowStroke(g, ink, ink.faint, 1.5, 0);
    bar(g, x + 16, 98, kw * 0.4, ink.soft, 4);
    g.font = `600 30px ${SANS}`;
    g.fillStyle = ink.text;
    g.textBaseline = "middle";
    g.shadowColor = textGlow(ink);
    g.shadowBlur = ink.blur * 0.8;
    g.fillText(v, x + 16, 134);
    g.shadowBlur = 0;
  });
  // chart panel
  const cy0 = 178;
  const ch = H - cy0 - 22;
  const cw = (W - kx - 22) * 0.64;
  rr(g, kx, cy0, cw, ch, 12);
  g.fillStyle = ink.fill;
  g.fill();
  bar(g, kx + 16, cy0 + 22, 110, ink.soft, 4);
  const bars = [0.42, 0.58, 0.5, 0.72, 0.64, 0.86, 0.78, 0.95];
  const bw = (cw - 40) / bars.length;
  bars.forEach((f, i) => {
    const bh = (ch - 70) * f;
    rr(g, kx + 20 + i * bw + bw * 0.2, cy0 + ch - 18 - bh, bw * 0.6, bh, 4);
    g.fillStyle = i === bars.length - 1 ? ink.line : ink.accentFill;
    g.shadowColor = ink.glow;
    g.shadowBlur = i === bars.length - 1 ? ink.blur : 0;
    g.fill();
    g.shadowBlur = 0;
  });
  g.beginPath();
  bars.forEach((f, i) => {
    const x = kx + 20 + i * bw + bw / 2;
    const y = cy0 + ch - 18 - (ch - 70) * f - 16;
    if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
  });
  glowStroke(g, ink, ink.line, 2.5, ink.blur * 0.8);
  // side panel: list and a button
  const sx = kx + cw + 14;
  const sw = W - 22 - sx;
  rr(g, sx, cy0, sw, ch, 12);
  g.fillStyle = ink.fill;
  g.fill();
  [0.7, 0.5, 0.62, 0.44].forEach((f, i) => {
    g.beginPath();
    g.arc(sx + 22, cy0 + 30 + i * 34, 7, 0, Math.PI * 2);
    g.fillStyle = i === 0 ? ink.ok : ink.soft;
    g.fill();
    bar(g, sx + 38, cy0 + 30 + i * 34, (sw - 56) * f, ink.soft, 4);
  });
  rr(g, sx + 14, cy0 + ch - 50, sw - 28, 34, 17);
  g.fillStyle = ink.accent;
  g.shadowColor = ink.glow;
  g.shadowBlur = ink.blur * 1.4;
  g.fill();
  g.shadowBlur = 0;
  g.font = `600 15px ${SANS}`;
  g.textAlign = "center";
  g.fillStyle = ink.light ? "#FFFFFF" : "#0B1330";
  g.fillText(t("landing.scene.submitOrder", "Submit order"), sx + sw / 2, cy0 + ch - 33);
  return done(c);
}

export function phoneTexture(ink: Ink): Texture {
  const W = 200;
  const H = 386;
  const { c, g } = make(W, H);
  rr(g, 4, 4, W - 8, H - 8, 26);
  const grd = g.createLinearGradient(0, 0, 0, H);
  grd.addColorStop(0, ink.glassTop);
  grd.addColorStop(1, ink.glassBottom);
  g.fillStyle = grd;
  g.fill();
  rr(g, W / 2 - 26, 14, 52, 12, 6);
  g.fillStyle = ink.soft;
  g.fill();
  bar(g, 22, 52, 84, ink.line, 6);
  g.beginPath();
  g.arc(W - 30, 52, 10, 0, Math.PI * 2);
  g.fillStyle = ink.accentFill;
  g.fill();
  rr(g, 18, 76, W - 36, 92, 14);
  g.fillStyle = ink.fill;
  g.fill();
  g.font = `600 26px ${SANS}`;
  g.fillStyle = ink.text;
  g.textBaseline = "middle";
  g.shadowColor = textGlow(ink);
  g.shadowBlur = ink.blur * 0.8;
  g.fillText("$12.4k", 32, 112);
  g.shadowBlur = 0;
  g.beginPath();
  [0, 1, 2, 3, 4, 5, 6].forEach((i) => { const x = 32 + i * 20; const y = 150 - [4, 10, 7, 14, 12, 20, 24][i]; if (i === 0) g.moveTo(x, y); else g.lineTo(x, y); });
  glowStroke(g, ink, ink.line, 2.4, ink.blur * 0.6);
  [0, 1, 2].forEach((i) => {
    const y = 188 + i * 48;
    rr(g, 18, y, W - 36, 38, 10);
    g.fillStyle = ink.fill;
    g.fill();
    g.beginPath();
    g.arc(38, y + 19, 8, 0, Math.PI * 2);
    g.fillStyle = i === 0 ? ink.ok : ink.soft;
    g.fill();
    bar(g, 56, y + 19, 70 - i * 12, ink.soft, 4);
  });
  rr(g, 18, H - 66, W - 36, 38, 19);
  g.fillStyle = ink.accent;
  g.shadowColor = ink.glow;
  g.shadowBlur = ink.blur * 1.4;
  g.fill();
  g.shadowBlur = 0;
  return done(c);
}

/** "● LIVE" pill: a green neon edge and dot (light theme: dark's green, deeper, with its glow; deep green type) */
export function liveTexture(ink: Ink): Texture {
  const { c, g } = make(176, 64);
  rr(g, 6, 6, 164, 52, 26);
  g.fillStyle = ink.light ? "rgba(41,173,120,0.14)" : "rgba(70,211,154,0.14)";
  g.fill();
  rr(g, 6, 6, 164, 52, 26);
  g.strokeStyle = ink.ok;
  g.lineWidth = 2;
  g.shadowColor = ink.ok;
  g.shadowBlur = ink.blur;
  g.stroke();
  if (ink.light) g.stroke(); // its glow laid twice, as glowStroke does
  g.beginPath();
  g.arc(38, 32, 8, 0, Math.PI * 2);
  g.fillStyle = ink.ok;
  g.fill();
  g.shadowBlur = 0;
  g.font = `700 24px ${MONO}`;
  g.fillStyle = ink.light ? "#1D7C55" : "rgba(220,255,238,0.96)";
  g.textBaseline = "middle";
  g.fillText(t("landing.scene.live", "LIVE"), 60, 33);
  return done(c);
}

/** the label canvas (the sprite keeps its aspect; see LABEL_SIZE in the scene) */
export const LABEL_PX = [420, 96] as const;

/** "SELISE Blocks" micro-label (light theme: an ink title, a blue line) */
export function labelTexture(ink: Ink, text: string, sub: string): Texture {
  const [w, h] = LABEL_PX;
  const { c, g } = make(w, h);
  g.font = `600 30px ${SANS}`;
  g.fillStyle = ink.text;
  g.textBaseline = "middle";
  g.shadowColor = textGlow(ink);
  g.shadowBlur = ink.blur * 0.7;
  g.fillText(text, 8, 34);
  g.shadowBlur = 0;
  g.font = `500 19px ${MONO}`;
  g.fillStyle = ink.light ? ink.label : ink.soft;
  g.fillText(sub, 8, 72);
  return done(c);
}
