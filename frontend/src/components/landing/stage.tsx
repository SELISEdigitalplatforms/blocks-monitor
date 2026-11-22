/** Shared helpers of the cinematic dark stages (the landing hero and the sign-in page): WebGL detection, film grain,
 *  the canvas token the 3D scene melts into, the scene error boundary and the no-WebGL line. No three.js here. */
import { Component, useEffect, useState, type ReactNode } from "react";

let webgl: boolean | undefined;
export function webglAvailable(): boolean {
  if (webgl !== undefined) return webgl;
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2") || c.getContext("webgl");
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
    webgl = Boolean(gl);
  } catch {
    webgl = false;
  }
  return webgl;
}

/** film grain, drawn once in code */
let grainUrl: string | undefined;
export function grain(): string {
  if (grainUrl !== undefined) return grainUrl;
  grainUrl = "";
  try {
    const s = 180;
    const c = document.createElement("canvas");
    c.width = c.height = s;
    const g = c.getContext("2d");
    if (g) {
      // signed grain: light and dark specks with their own alpha, so a plain (cheap) blend adds texture, not haze
      const img = g.createImageData(s, s);
      for (let i = 0; i < img.data.length; i += 4) {
        const v = Math.random() * 2 - 1;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v > 0 ? 255 : 0;
        img.data[i + 3] = Math.round(Math.abs(v) * 22);
      }
      g.putImageData(img, 0, 0);
      grainUrl = c.toDataURL("image/png");
    }
  } catch { /* no canvas: no grain */ }
  return grainUrl;
}

const DARK_CANVAS_FALLBACK = "14 15 19";
let darkToken: string | undefined;
/** the dark --c-canvas token ("r g b"), read through a hidden probe under data-theme="dark" (cached once found) */
function darkCanvas(): string {
  if (darkToken) return darkToken;
  let v = "";
  try {
    const probe = document.createElement("div");
    probe.dataset.theme = "dark";
    probe.hidden = true;
    document.documentElement.appendChild(probe);
    v = getComputedStyle(probe).getPropertyValue("--c-canvas").trim();
    probe.remove();
  } catch { /* no DOM access: the fallback */ }
  if (v) darkToken = v;
  return v || DARK_CANVAS_FALLBACK;
}

/** the page canvas token ("r g b") and the theme on <html>, following the theme switch in the bar, so the 3D scene
 *  melts into the page. With 'dark' the value is fixed (the dark canvas, light=false) and never observed: a theme
 *  switch cannot re-render, re-colour or re-create the scene. */
export function useCanvasTheme(forced?: "dark"): { canvas: string; light: boolean } {
  const read = () => {
    if (forced === "dark") return { canvas: darkCanvas(), light: false };
    const html = document.documentElement;
    return { canvas: getComputedStyle(html).getPropertyValue("--c-canvas").trim() || DARK_CANVAS_FALLBACK, light: html.dataset.theme !== "dark" };
  };
  const [v, setV] = useState(read);
  useEffect(() => {
    if (forced === "dark") return;
    const update = () => setV((prev) => {
      const next = read();
      return next.canvas === prev.canvas && next.light === prev.light ? prev : next;
    });
    update();
    const mo = new MutationObserver(update);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });
    return () => mo.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forced]);
  return v;
}

export class SceneBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

/** without WebGL: the same line, drawn flat */
export function FlatLine() {
  return (
    <svg aria-hidden className="absolute inset-0 h-full w-full" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice">
      <defs>
        <filter id="lp-flat-glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="6" /></filter>
      </defs>
      <path d="M980 900 C 1180 760, 1080 640, 1010 600 S 1230 500, 1190 470" fill="none" className="stroke-accent" strokeWidth="8" opacity="0.5" filter="url(#lp-flat-glow)" />
      <path d="M980 900 C 1180 760, 1080 640, 1010 600 S 1230 500, 1190 470" fill="none" className="stroke-accent" strokeWidth="2" />
      <rect x="1186" y="140" width="8" height="330" rx="4" className="fill-accent" opacity="0.35" filter="url(#lp-flat-glow)" />
    </svg>
  );
}
