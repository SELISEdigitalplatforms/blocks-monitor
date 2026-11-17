// A tiny RGB canvas and PNG encoder (node:zlib only) for the seeded images: screen designs, whiteboard photos, style
// sheets and annotated screenshots. Text uses a 5x7 pixel font (capitals), scaled.
import { deflateSync } from "node:zlib";

export type Rgb = readonly [number, number, number];

export function hex(c: string): Rgb {
  const v = c.replace("#", "");
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}

export function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t)];
}

// 5x7 glyphs, rows top to bottom separated by '|' ('#' = ink).
const G: Record<string, string> = {
  A: ".###.|#...#|#...#|#####|#...#|#...#|#...#", B: "####.|#...#|#...#|####.|#...#|#...#|####.", C: ".###.|#...#|#....|#....|#....|#...#|.###.",
  D: "####.|#...#|#...#|#...#|#...#|#...#|####.", E: "#####|#....|#....|####.|#....|#....|#####", F: "#####|#....|#....|####.|#....|#....|#....",
  G: ".###.|#...#|#....|#.###|#...#|#...#|.####", H: "#...#|#...#|#...#|#####|#...#|#...#|#...#", I: ".###.|..#..|..#..|..#..|..#..|..#..|.###.",
  J: "..###|...#.|...#.|...#.|...#.|#..#.|.##..", K: "#...#|#..#.|#.#..|##...|#.#..|#..#.|#...#", L: "#....|#....|#....|#....|#....|#....|#####",
  M: "#...#|##.##|#.#.#|#.#.#|#...#|#...#|#...#", N: "#...#|#...#|##..#|#.#.#|#..##|#...#|#...#", O: ".###.|#...#|#...#|#...#|#...#|#...#|.###.",
  P: "####.|#...#|#...#|####.|#....|#....|#....", Q: ".###.|#...#|#...#|#...#|#.#.#|#..#.|.##.#", R: "####.|#...#|#...#|####.|#.#..|#..#.|#...#",
  S: ".####|#....|#....|.###.|....#|....#|####.", T: "#####|..#..|..#..|..#..|..#..|..#..|..#..", U: "#...#|#...#|#...#|#...#|#...#|#...#|.###.",
  V: "#...#|#...#|#...#|#...#|#...#|.#.#.|..#..", W: "#...#|#...#|#...#|#.#.#|#.#.#|#.#.#|.#.#.", X: "#...#|#...#|.#.#.|..#..|.#.#.|#...#|#...#",
  Y: "#...#|#...#|.#.#.|..#..|..#..|..#..|..#..", Z: "#####|....#|...#.|..#..|.#...|#....|#####", "0": ".###.|#...#|#..##|#.#.#|##..#|#...#|.###.",
  "1": "..#..|.##..|..#..|..#..|..#..|..#..|.###.", "2": ".###.|#...#|....#|...#.|..#..|.#...|#####", "3": "#####|...#.|..#..|...#.|....#|#...#|.###.",
  "4": "...#.|..##.|.#.#.|#..#.|#####|...#.|...#.", "5": "#####|#....|####.|....#|....#|#...#|.###.", "6": "..##.|.#...|#....|####.|#...#|#...#|.###.",
  "7": "#####|....#|...#.|..#..|.#...|.#...|.#...", "8": ".###.|#...#|#...#|.###.|#...#|#...#|.###.", "9": ".###.|#...#|#...#|.####|....#|...#.|.##..",
  " ": ".....|.....|.....|.....|.....|.....|.....", ".": ".....|.....|.....|.....|.....|.##..|.##..", ",": ".....|.....|.....|.....|.##..|..#..|.#...",
  ":": ".....|.##..|.##..|.....|.##..|.##..|.....", "-": ".....|.....|.....|#####|.....|.....|.....", "/": ".....|....#|...#.|..#..|.#...|#....|.....",
  "!": "..#..|..#..|..#..|..#..|..#..|.....|..#..", "?": ".###.|#...#|....#|...#.|..#..|.....|..#..", "&": ".##..|#..#.|#.#..|.#...|#.#.#|#..#.|.##.#",
  "%": "##...|##..#|...#.|..#..|.#...|#..##|...##", "+": ".....|..#..|..#..|#####|..#..|..#..|.....", "(": "...#.|..#..|.#...|.#...|.#...|..#..|...#.",
  ")": ".#...|..#..|...#.|...#.|...#.|..#..|.#...", "#": ".#.#.|.#.#.|#####|.#.#.|#####|.#.#.|.#.#.", "'": "..#..|..#..|.#...|.....|.....|.....|.....",
  "*": ".....|..#..|#.#.#|.###.|#.#.#|..#..|.....", ">": ".#...|..#..|...#.|....#|...#.|..#..|.#...", "<": "...#.|..#..|.#...|#....|.#...|..#..|...#.",
  "=": ".....|.....|#####|.....|#####|.....|.....", "_": ".....|.....|.....|.....|.....|.....|#####", "@": ".###.|#...#|#.###|#.#.#|#.###|#....|.###.",
};
const GLYPHS: Record<string, string> = Object.fromEntries(Object.entries(G).map(([k, v]) => [k, v.replace(/\|/g, "")]));

function glyphOf(ch: string): string {
  const base = ch.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
  if (GLYPHS[base]) return GLYPHS[base]!;
  if (ch === "–" || ch === "—") return GLYPHS["-"]!;
  if (ch === "·" || ch === "•") return GLYPHS["."]!;
  if (ch === "’" || ch === "‘") return GLYPHS["'"]!;
  return GLYPHS["?"]!;
}

export class Canvas {
  readonly data: Uint8Array;
  constructor(readonly w: number, readonly h: number, bg: Rgb = [255, 255, 255]) {
    this.data = new Uint8Array(w * h * 3);
    this.fill(0, 0, w, h, bg);
  }

  px(x: number, y: number, c: Rgb): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 3;
    this.data[i] = c[0];
    this.data[i + 1] = c[1];
    this.data[i + 2] = c[2];
  }

  fill(x: number, y: number, w: number, h: number, c: Rgb): void {
    const x0 = Math.max(0, Math.round(x));
    const y0 = Math.max(0, Math.round(y));
    const x1 = Math.min(this.w, Math.round(x + w));
    const y1 = Math.min(this.h, Math.round(y + h));
    for (let yy = y0; yy < y1; yy++) {
      let i = (yy * this.w + x0) * 3;
      for (let xx = x0; xx < x1; xx++) {
        this.data[i++] = c[0];
        this.data[i++] = c[1];
        this.data[i++] = c[2];
      }
    }
  }

  /** A filled rectangle with rounded corners. */
  round(x: number, y: number, w: number, h: number, r: number, c: Rgb): void {
    r = Math.min(r, w / 2, h / 2);
    this.fill(x + r, y, w - 2 * r, h, c);
    this.fill(x, y + r, r, h - 2 * r, c);
    this.fill(x + w - r, y + r, r, h - 2 * r, c);
    for (const [cx, cy] of [[x + r, y + r], [x + w - r, y + r], [x + r, y + h - r], [x + w - r, y + h - r]] as const) {
      this.disc(cx, cy, r, c, true);
    }
  }

  /** Outline of a rectangle, `t` pixels thick. */
  box(x: number, y: number, w: number, h: number, c: Rgb, t = 2): void {
    this.fill(x, y, w, t, c);
    this.fill(x, y + h - t, w, t, c);
    this.fill(x, y, t, h, c);
    this.fill(x + w - t, y, t, h, c);
  }

  disc(cx: number, cy: number, r: number, c: Rgb, quarter = false): void {
    const r2 = r * r;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy <= r2 + (quarter ? 0 : r * 0.5)) this.px(Math.round(cx + dx), Math.round(cy + dy), c);
      }
    }
  }

  ring(cx: number, cy: number, r: number, c: Rgb, t = 3): void {
    const outer = r * r;
    const inner = (r - t) * (r - t);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const d = dx * dx + dy * dy;
        if (d <= outer && d >= inner) this.px(Math.round(cx + dx), Math.round(cy + dy), c);
      }
    }
  }

  /** A straight stroke `t` pixels wide. */
  line(x0: number, y0: number, x1: number, y1: number, c: Rgb, t = 2): void {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= steps; i++) {
      const x = x0 + ((x1 - x0) * i) / steps;
      const y = y0 + ((y1 - y0) * i) / steps;
      this.fill(x - t / 2, y - t / 2, t, t, c);
    }
  }

  /** Text in the 5x7 font; answers the width drawn. */
  text(x: number, y: number, s: string, c: Rgb, scale = 2): number {
    let cx = Math.round(x);
    for (const ch of s) {
      const g = glyphOf(ch);
      for (let i = 0; i < 35; i++) {
        if (g[i] === "#") this.fill(cx + (i % 5) * scale, y + Math.floor(i / 5) * scale, scale, scale, c);
      }
      cx += 6 * scale;
    }
    return cx - x;
  }

  static textWidth(s: string, scale = 2): number {
    return [...s].length * 6 * scale;
  }

  /** Wraps words into lines of at most `max` characters. */
  static wrap(s: string, max: number): string[] {
    const out: string[] = [];
    let line = "";
    for (const word of s.split(/\s+/).filter(Boolean)) {
      if (line && (line + " " + word).length > max) {
        out.push(line);
        line = word;
      } else line = line ? `${line} ${word}` : word;
    }
    if (line) out.push(line);
    return out;
  }

  png(): Uint8Array {
    const stride = this.w * 3 + 1;
    const raw = Buffer.alloc(stride * this.h);
    for (let y = 0; y < this.h; y++) {
      raw[y * stride] = 0;
      Buffer.from(this.data.buffer, this.data.byteOffset + y * this.w * 3, this.w * 3).copy(raw, y * stride + 1);
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(this.w, 0);
    ihdr.writeUInt32BE(this.h, 4);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 2; // RGB
    const chunks = [chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))];
    return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ...chunks]));
  }
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
