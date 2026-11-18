/**
 * A living face, as pure functions of time (no three.js): blinks, speech mouth shapes from the spoken text, and the
 * small idle micro-expressions that keep a face from looking frozen.
 */

/* ── blinks ─────────────────────────────────────────────────────────────── */

/** seconds to the next blink from r in [0, 1): every 3–6 s, now and then a quick double */
export function nextBlink(r: number): number {
  return r < 0.13 ? 0.28 : 3 + ((r - 0.13) / 0.87) * 3;
}

export const BLINK_CLOSE = 0.065;
export const BLINK_HOLD = 0.03;
export const BLINK_OPEN = 0.15;
export const BLINK_TOTAL = BLINK_CLOSE + BLINK_HOLD + BLINK_OPEN;

/** eyelid closure (0..1) t seconds into a blink: a fast close, a short hold, a slower eased open */
export function blinkCurve(t: number): number {
  if (t < 0 || t >= BLINK_TOTAL) return 0;
  if (t < BLINK_CLOSE) { const u = t / BLINK_CLOSE; return u * u * (3 - 2 * u); }
  if (t < BLINK_CLOSE + BLINK_HOLD) return 1;
  const u = (t - BLINK_CLOSE - BLINK_HOLD) / BLINK_OPEN;
  return 1 - u * u * (3 - 2 * u);
}

/** seconds to the next micro-saccade: 1–3 s */
export function nextMicroSaccade(r: number): number {
  return 1 + r * 2;
}

/* ── speech ─────────────────────────────────────────────────────────────── */

export interface Viseme { aa: number; oh: number; ee: number; pp: number; jawOpen: number }

const REST: Viseme = { aa: 0, oh: 0, ee: 0, pp: 0, jawOpen: 0 };

/** seconds per character of text at a calm speaking pace (~14 characters a second) */
export const CHAR_SECONDS = 0.07;

/** how long a line takes to say */
export function speechSeconds(text: string): number {
  return Math.max(1.2, text.length * CHAR_SECONDS + 0.3);
}

function shapeOf(ch: string): Viseme | null {
  switch (ch) {
    case "a": return { aa: 0.75, oh: 0.05, ee: 0, pp: 0, jawOpen: 0.3 };
    case "e": case "i": case "y": return { aa: 0.15, oh: 0, ee: 0.6, pp: 0, jawOpen: 0.14 };
    case "o": return { aa: 0.15, oh: 0.7, ee: 0, pp: 0, jawOpen: 0.22 };
    case "u": case "w": case "q": return { aa: 0, oh: 0.75, ee: 0, pp: 0, jawOpen: 0.1 };
    case "m": case "b": case "p": return { aa: 0, oh: 0, ee: 0, pp: 0.85, jawOpen: 0 };
    case "f": case "v": return { aa: 0, oh: 0, ee: 0.25, pp: 0.35, jawOpen: 0.04 };
    case " ": return { aa: 0.05, oh: 0, ee: 0.05, pp: 0.12, jawOpen: 0.03 };
    case ",": case ".": case "!": case "?": case ";": case ":": case "—": case "-": return REST;
    default: return /[a-z0-9]/.test(ch) ? { aa: 0.25, oh: 0, ee: 0.2, pp: 0, jawOpen: 0.12 } : null;
  }
}

/**
 * The mouth `t` seconds into saying `text`: each letter's shape, blended smoothly into the next (no snapping), with
 * closures on m/b/p, little rests between words and real pauses at punctuation. Silent after the line.
 */
export function visemeAt(text: string, t: number, out: Viseme): Viseme {
  const s = text.toLowerCase();
  const pos = t / CHAR_SECONDS;
  if (t < 0 || pos >= s.length + 1) return Object.assign(out, REST);
  const i = Math.floor(pos), f = pos - i;
  const a = shapeOf(s[i] ?? " ") ?? REST, b = shapeOf(s[i + 1] ?? ".") ?? REST;
  const k = f * f * (3 - 2 * f);
  // a gentle pace variation so it never reads as metronomic
  const lively = 0.85 + 0.15 * Math.sin(t * 2.3 + i * 0.7);
  out.aa = (a.aa + (b.aa - a.aa) * k) * lively;
  out.oh = (a.oh + (b.oh - a.oh) * k) * lively;
  out.ee = (a.ee + (b.ee - a.ee) * k) * lively;
  out.pp = a.pp + (b.pp - a.pp) * k;
  out.jawOpen = (a.jawOpen + (b.jawOpen - a.jawOpen) * k) * lively;
  return out;
}

/* ── micro-expressions ─────────────────────────────────────────────────── */

/** smooth noise in about [-1, 1]: three slow incommensurate sines (period 4–15 s), phased by seed and channel */
export function drift(t: number, seed: number, channel: number): number {
  const p = seed * 1.7 + channel * 2.39;
  return (Math.sin(t * 0.41 + p) * 0.5 + Math.sin(t * 0.83 + p * 1.9) * 0.3 + Math.sin(t * 1.57 + p * 0.6) * 0.2);
}
