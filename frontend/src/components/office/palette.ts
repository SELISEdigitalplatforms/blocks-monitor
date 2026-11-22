import { Color } from "three";
import type { Role } from "./model";

/** The office tokens live in office.css under .factory-office (not on <html>), so colours are read from a
 *  hidden probe element that carries that class. It inherits <html data-theme>, so it follows the theme. */
let probe: HTMLElement | null = null;
function tokenHost(): HTMLElement {
  if (probe?.isConnected) return probe;
  probe = document.createElement("div");
  probe.className = "factory-office";
  probe.setAttribute("aria-hidden", "true");
  probe.style.display = "none";
  document.body.appendChild(probe);
  return probe;
}

/** Read a "R G B" token from the current theme as a three.js colour. */
export function tokenColor(name: string, fallback = "#888888"): Color {
  const raw = getComputedStyle(tokenHost()).getPropertyValue(`--${name}`).trim();
  const m = raw.split(/\s+/).map(Number);
  if (m.length === 3 && m.every((n) => Number.isFinite(n))) return new Color(m[0] / 255, m[1] / 255, m[2] / 255);
  return new Color(fallback);
}

export function roleColor(role: Role): Color {
  return tokenColor(`role-${role}`);
}

const SKIN = ["#f2d3b8", "#e8b996", "#c98e66", "#a8714f", "#7d5034", "#f5dcc8", "#d9a47c"];
const HAIR = ["#2b211c", "#4a3326", "#7a5232", "#c9a063", "#1b1b22", "#8c3b2a", "#5d5d66"];

export function hashOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function looksFor(id: string) {
  const h = hashOf(id);
  return { skin: SKIN[h % SKIN.length], hair: HAIR[(h >>> 4) % HAIR.length], hairStyle: (h >>> 9) % 3 };
}
