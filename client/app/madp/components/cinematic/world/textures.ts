import { CanvasTexture, SRGBColorSpace, LinearFilter } from 'three';

/** Canvas-drawn textures (no font downloads, no network). Cached by key. */
const cache = new Map<string, CanvasTexture>();

/** The app's typeface (Outfit, variable 100–900), served from public/fonts so the scene never falls back to a
 *  default face: every canvas in the scene is drawn (again) once it is in. Titles 600 with slightly tight tracking,
 *  labels 500. */
export const FONT = '"MADP Outfit", "Outfit Variable", system-ui, sans-serif';
let fontP: Promise<unknown> | null = null;
export function sceneFont(): Promise<unknown> {
  if (!fontP) {
    try {
      const face = new FontFace("MADP Outfit", "url(/fonts/outfit-latin-wght-normal.woff2) format('woff2')", { weight: "100 900", display: "block" });
      document.fonts.add(face);
      fontP = face.load().catch(() => undefined);
    } catch {
      fontP = Promise.resolve();
    }
  }
  return fontP;
}
/** tracking for titles (Chrome/Edge/Safari support canvas letterSpacing; elsewhere it is a no-op) */
export function track(g: CanvasRenderingContext2D, px: number) {
  (g as unknown as { letterSpacing?: string }).letterSpacing = `${px}px`;
}
export const MONO = '"JetBrains Mono Variable", monospace';

export function canvasTexture(key: string, w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void) {
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  draw(g, w, h);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.minFilter = LinearFilter;
  t.generateMipmaps = false;
  t.anisotropy = 4;
  cache.set(key, t);
  // redraw once the scene font is in, so no canvas keeps a fallback face
  void sceneFont().then(() => {
    g.clearRect(0, 0, w, h);
    track(g, 0);
    draw(g, w, h);
    t.needsUpdate = true;
  });
  return t;
}

export function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

export function wrap(g: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (g.measureText(t).width > maxW && cur) {
      lines.push(cur);
      cur = w;
    } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}

/** A soft radial blob (for fake contact shadows and glows). */
export function radialTexture(key: string, inner: string, outer: string) {
  return canvasTexture(key, 128, 128, (g, w, h) => {
    const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    gr.addColorStop(0, inner);
    gr.addColorStop(1, outer);
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
  });
}
