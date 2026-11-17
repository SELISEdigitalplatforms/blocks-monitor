/** The live screens of the visit, drawn on canvases (no fonts or images downloaded; redrawn only when the state they
 *  show changes): the meeting room's wall screen that captures notes and cards as you talk, the engineer's monitor with
 *  where the code lives, and the build floor's board. */
import { useEffect, useMemo, useRef } from "react";
import { CanvasTexture, LinearFilter, MeshBasicMaterial, SRGBColorSpace } from "three";
import { useJourney, type JourneyState } from "../journey/store";
import { FONT, MONO, roundRect, sceneFont, track, wrap } from "./textures";
import { repoSlug } from "@/domain/projectType";
import { STEP_LABEL } from "@/domain/journey";
import { t, useCulture } from "@/i18n";


function useLiveCanvas(w: number, h: number, draw: (g: CanvasRenderingContext2D, s: JourneyState) => void, deps: (s: JourneyState) => unknown[], scale = 1) {
  const { tex, g, mat } = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = Math.round(w * scale);
    c.height = Math.round(h * scale);
    const texture = new CanvasTexture(c);
    texture.colorSpace = SRGBColorSpace;
    texture.minFilter = LinearFilter;
    texture.generateMipmaps = false;
    texture.anisotropy = 4;
    // a CPU-backed 2D canvas: handing it to WebGL is a plain upload, with no GPU read-back stall mid-frame
    return { tex: texture, g: c.getContext("2d", { willReadFrequently: true })!, mat: new MeshBasicMaterial({ map: texture, toneMapped: false }) };
  }, [w, h]);
  // a change of language redraws the screen with the same state
  const culture = useCulture();
  const repaint = useRef<() => void>(() => undefined);
  useEffect(() => {
    let last: unknown[] = [];
    let queued = 0;
    let alive = true;
    let bitmap: ImageBitmap | null = null;
    // A change is drawn on the next animation frame (never inside the state update), then handed to the GPU as an
    // ImageBitmap prepared off the main thread (already flipped), so the upload is a plain copy: no stall mid-frame.
    const redraw = () => {
      queued = 0;
      if (!alive) return;
      const s = useJourney.getState();
      g.setTransform(scale, 0, 0, scale, 0, 0);
      g.clearRect(0, 0, w, h);
      track(g, 0);
      draw(g, s);
      if (typeof createImageBitmap !== "function") { tex.needsUpdate = true; return; }
      void createImageBitmap(g.canvas, { imageOrientation: "flipY", premultiplyAlpha: "none" }).then((bmp) => {
        if (!alive) { bmp.close(); return; }
        bitmap?.close();
        bitmap = bmp;
        tex.image = bmp;
        tex.flipY = false;
        tex.needsUpdate = true;
        window.dispatchEvent(new Event("cine:busy"));
      }, () => { tex.needsUpdate = true; });
    };
    const paint = (s: JourneyState) => {
      const d = deps(s);
      if (d.length === last.length && d.every((v, i) => v === last[i])) return;
      last = d;
      if (!queued) queued = requestAnimationFrame(redraw);
    };
    paint(useJourney.getState());
    repaint.current = () => { last = []; paint(useJourney.getState()); };
    const unsub = useJourney.subscribe(paint);
    void sceneFont().then(() => { last = []; paint(useJourney.getState()); });
    return () => { alive = false; cancelAnimationFrame(queued); unsub(); bitmap?.close(); tex.dispose(); mat.dispose(); };
    // draw/deps are stable module-level functions
  }, [g, tex, mat, w, h, scale]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { repaint.current(); }, [culture]);
  return mat;
}

function bg(g: CanvasRenderingContext2D, w: number, h: number, accent: string) {
  const gr = g.createLinearGradient(0, 0, w, h);
  gr.addColorStop(0, "#0f1219");
  gr.addColorStop(1, "#161b28");
  g.fillStyle = gr;
  g.fillRect(0, 0, w, h);
  const glow = g.createRadialGradient(w * 0.9, 0, 0, w * 0.9, 0, w * 0.7);
  glow.addColorStop(0, accent);
  glow.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = glow;
  g.fillRect(0, 0, w, h);
}

function chip(g: CanvasRenderingContext2D, x: number, y: number, text: string, fill: string, ink = "#ffffff", size = 22) {
  g.font = `500 ${size}px ${FONT}`;
  const w = g.measureText(text).width + 28;
  g.fillStyle = fill;
  roundRect(g, x, y, w, size + 18, (size + 18) / 2);
  g.fill();
  g.fillStyle = ink;
  g.fillText(text, x + 14, y + size + 3);
  return w;
}

/** text cut to the width with an ellipsis (in the current font) */
function fit(g: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (g.measureText(text).width <= maxW) return text;
  let cut = text;
  while (cut.length > 1 && g.measureText(`${cut}…`).width > maxW) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

/** wrapped lines, at most `max`; a longer text ends its last line with an ellipsis */
function lines(g: CanvasRenderingContext2D, text: string, w: number, max: number): string[] {
  const all = wrap(g, text, w);
  if (all.length <= max) return all;
  const out = all.slice(0, max);
  out[max - 1] = fit(g, `${out[max - 1]} ${all[max]}`, w - 2);
  return out;
}

function block(g: CanvasRenderingContext2D, x: number, y: number, w: number, label: string, text: string, maxLines: number, empty = "…") {
  g.fillStyle = "rgba(255,255,255,0.45)";
  g.font = `600 16px ${FONT}`;
  track(g, 1.6);
  g.fillText(label.toUpperCase(), x, y);
  track(g, 0);
  g.fillStyle = text ? "#ffffff" : "rgba(255,255,255,0.28)";
  g.font = `400 25px ${FONT}`;
  const ls = lines(g, text || empty, w, maxLines);
  ls.forEach((l, i) => g.fillText(l, x, y + 36 + i * 33));
  return y + 36 + ls.length * 33;
}

/* ── the meeting room's wall screen ──────────────────────────────────────── */

const WALL_W = 1600;
const WALL_H = 800;

function drawWall(g: CanvasRenderingContext2D, s: JourneyState) {
  const a = s.answers;
  bg(g, WALL_W, WALL_H, "rgba(112,80,245,0.30)");
  g.fillStyle = "#ffffff";
  g.font = `600 46px ${FONT}`;
  track(g, -0.8);
  g.fillText(a.name || t("studio.cinematic.places.discovery", "Discovery"), 60, 86);
  track(g, 0);
  g.font = `400 24px ${FONT}`;
  g.fillStyle = "rgba(255,255,255,0.55)";
  g.fillText(a.visitor ? t("studio.cinematic.screens.discoveryWith", "Discovery with {name}", { name: a.visitor }) : t("studio.cinematic.places.discovery", "Discovery"), 60, 124);
  g.fillStyle = "#2fd59a";
  g.beginPath();
  g.arc(WALL_W - 190, 76, 8, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "rgba(255,255,255,0.6)";
  g.font = `500 20px ${FONT}`;
  g.fillText(t("studio.cinematic.screens.liveNotes", "Live notes"), WALL_W - 172, 83);

  // left column: what we heard (the about text takes the lines the other notes leave, 4 to 7)
  const L = 60;
  const colW = 640;
  g.font = `400 25px ${FONT}`;
  const below = [a.audience, a.goal].reduce((h, text) => h + 26 + 36 + Math.min(2, wrap(g, text || "…", colW).length) * 33, 0) + (a.website ? 104 : 0);
  let y = block(g, L, 186, colW, t("studio.cinematic.screens.about", "What it's about"), a.about, Math.max(4, Math.min(7, Math.floor((WALL_H - 40 - below - 186 - 36) / 33))));
  y = block(g, L, y + 26, colW, t("studio.cinematic.screens.audience", "Who it's for"), a.audience, 2);
  y = block(g, L, y + 26, colW, t("studio.cinematic.screens.goal", "Main goal"), a.goal, 2);
  if (a.website) {
    g.fillStyle = "rgba(255,255,255,0.45)";
    g.font = `600 17px ${FONT}`;
    g.fillText(t("studio.cinematic.screens.website", "Website").toUpperCase(), L, y + 26);
    chip(g, L, y + 40, `↗ ${a.website.replace(/^https?:\/\//i, "").replace(/\/$/, "")}`, "rgba(93,134,255,0.28)", "#cfdcff");
  }

  // right column: files (two rows at most; long names are cut), then requirements
  const R = 780;
  const RW = WALL_W - 60 - R;
  g.fillStyle = "rgba(255,255,255,0.45)";
  g.font = `600 17px ${FONT}`;
  g.fillText(t("studio.cinematic.screens.files", "Files").toUpperCase(), R, 186);
  let fx = R;
  let fy = 200;
  if (!s.uploads.length) {
    g.fillStyle = "rgba(255,255,255,0.28)";
    g.font = `400 25px ${FONT}`;
    g.fillText("…", R, 236);
  }
  g.font = `500 21px ${FONT}`;
  const moreW = g.measureText(t("studio.cinematic.screens.more", "+{count} more", { count: 99 })).width + 38;
  const end = WALL_W - 60;
  for (let i = 0; i < s.uploads.length; i++) {
    const f = s.uploads[i];
    g.font = `500 21px ${FONT}`;
    const label = fit(g, `${f.progress >= 1 ? "✓ " : f.phase === "failed" ? "✕ " : ""}${f.name}`, RW - 28);
    const w = g.measureText(label).width + 28;
    // on the second row, room stays for a "+n more" chip while files remain
    const rest = i < s.uploads.length - 1 ? moreW : 0;
    if (fy === 200 ? fx + w > end : fx + w + rest > end) {
      if (fy === 200) { fx = R; fy += 50; }
      if (fx + w + rest > end) {
        chip(g, fx, fy, t("studio.cinematic.screens.more", "+{count} more", { count: s.uploads.length - i }), "rgba(255,255,255,0.12)", "#ffffff", 21);
        break;
      }
    }
    chip(g, fx, fy, label, f.progress >= 1 ? "rgba(47,213,154,0.22)" : "rgba(255,255,255,0.12)", f.progress >= 1 ? "#bff5df" : "#ffffff", 21);
    fx += w + 10;
  }
  if (s.mode === "real") {
    drawProjectNotes(g, s, R, fy + 92);
    return;
  }
  g.fillStyle = "rgba(255,255,255,0.45)";
  g.font = `600 17px ${FONT}`;
  g.fillText(t("studio.cinematic.screens.firstRequirements", "First requirements").toUpperCase(), R, fy + 92);
  // laid out for the story's full set from the first card on, so nothing moves as they come in: the usual cards
  // while they fit, smaller ones (title 20 px, body 15 px) for a longer list
  const top = fy + 112;
  const total = Math.max(s.requirements.length, s.story.requirements(a.followups).length);
  const pitch = Math.min(118, Math.floor((WALL_H - 36 - top + 14) / Math.max(1, Math.ceil(total / 2))));
  const h = pitch - 14;
  const big = h >= 100;
  s.requirements.forEach((r, i) => {
    const cx = R + (i % 2) * 400;
    const cy = top + Math.floor(i / 2) * pitch;
    g.fillStyle = "rgba(255,255,255,0.94)";
    roundRect(g, cx, cy, 380, big ? 104 : h, 16);
    g.fill();
    g.fillStyle = "#7050F5";
    roundRect(g, cx + 16, cy + (big ? 16 : 12), 46, big ? 26 : 24, big ? 13 : 12);
    g.fill();
    g.fillStyle = "#ffffff";
    g.font = `600 15px ${MONO}`;
    g.fillText(r.id, cx + 27, cy + (big ? 34 : 29));
    g.fillStyle = "#0b0b0f";
    g.font = `600 ${big ? 22 : 20}px ${FONT}`;
    g.fillText(fit(g, r.title, 290), cx + 74, cy + (big ? 36 : 31));
    g.fillStyle = "#484c58";
    g.font = `400 ${big ? 17 : 15}px ${FONT}`;
    lines(g, r.body, 350, 2).forEach((l, k) => g.fillText(l, cx + 16, cy + (big ? 66 + k * 22 : 55 + k * 19), 350));
  });
}
/** The real office: what is really in the project so far, each line as its record says. */
function drawProjectNotes(g: CanvasRenderingContext2D, s: JourneyState, x: number, y: number) {
  g.fillStyle = "rgba(255,255,255,0.45)";
  g.font = `600 17px ${FONT}`;
  g.fillText(t("studio.cinematic.screens.inYourProject", "In your project").toUpperCase(), x, y);
  const filed = s.uploads.filter((u) => u.phase === "done").length;
  const rows: [string, boolean][] = [];
  const p = s.project.status;
  if (p !== "none") {
    rows.push([p === "created" ? t("studio.cinematic.screens.projectCreated", "Project created")
      : p === "creating" ? t("studio.cinematic.stage.creating", "Creating the project…")
      : t("studio.cinematic.screens.projectNotCreated", "Project not created yet"), p === "created"]);
  }
  if (s.answers.website) {
    rows.push([s.websiteSave === "saved" ? t("studio.cinematic.screens.websiteSaved", "Website saved")
      : s.websiteSave === "failed" ? t("studio.cinematic.screens.websiteNotSaved", "Website not saved")
      : t("studio.cinematic.screens.websiteSaving", "Saving the website…"), s.websiteSave === "saved"]);
  }
  if (s.answersSave !== "idle") {
    rows.push([s.answersSave === "saved" ? t("studio.cinematic.screens.answersSaved", "Users and goal saved")
      : s.answersSave === "failed" ? t("studio.cinematic.screens.answersNotSaved", "Users and goal not saved")
      : t("studio.cinematic.screens.answersSaving", "Saving users and goal…"), s.answersSave === "saved"]);
  }
  if (filed) rows.push([filed === 1 ? t("studio.cinematic.summary.fileFiled", "1 file filed") : t("studio.cinematic.summary.filesFiled", "{count} files filed", { count: filed }), true]);
  if (s.agent.state === "reading") rows.push([t("studio.cinematic.screens.agentReading", "Business agent reading…"), false]);
  if (s.agent.state === "read") {
    rows.push([s.agent.found
      ? (s.agent.found === 1 ? t("studio.cinematic.screens.agentNotedOne", "Business agent: 1 point noted") : t("studio.cinematic.screens.agentNoted", "Business agent: {count} points noted", { count: s.agent.found }))
      : t("studio.cinematic.cards.agentReadBy", "Read by the business agent"), true]);
  }
  g.font = `400 24px ${FONT}`;
  if (!rows.length) {
    g.fillStyle = "rgba(255,255,255,0.28)";
    g.fillText("…", x, y + 44);
  }
  rows.forEach(([text, ok], i) => {
    const ty = y + 44 + i * 40;
    g.fillStyle = ok ? "#2fd59a" : "rgba(255,255,255,0.55)";
    g.fillText(ok ? "✓" : "•", x, ty);
    g.fillStyle = "#ffffff";
    g.fillText(fit(g, text, WALL_W - 60 - x - 40), x + 34, ty);
  });
}

// the wall shows a file once it has been read (the upload progress lives in the overlay card): it redraws per answer,
// per file read and per requirement, never per progress tick
let filesKey = "";
let filesRef: JourneyState["uploads"] = [];
const wallDeps = (s: JourneyState) => {
  const k = s.uploads.map((f) => (f.progress >= 1 ? "1" : f.phase === "failed" ? "x" : "0") + f.name).join("|");
  if (k !== filesKey) { filesKey = k; filesRef = s.uploads; }
  return [s.answers, filesRef, s.requirements, s.story, s.mode, s.project.status, s.websiteSave, s.answersSave, s.agent];
};

export function useWallScreen() {
  return useLiveCanvas(WALL_W, WALL_H, drawWall, wallDeps, 0.64);
}

/* ── the engineer's monitor ─────────────────────────────────────────────── */

/** The engineer's monitor: where the code lives. MADP Factory (the default) or the visitor's own GitHub; a GitHub
 *  account appears only once the real connection reports it. */
function drawMonitor(g: CanvasRenderingContext2D, s: JourneyState) {
  const W = 960;
  const H = 540;
  const a = s.answers;
  const login = s.githubLogin;
  const onGithub = a.code === "github" || (a.code === "" && s.github === "connecting");
  g.fillStyle = "#0d1117";
  g.fillRect(0, 0, W, H);
  g.fillStyle = "#161b22";
  g.fillRect(0, 0, W, 54);
  g.fillStyle = "#ffffff";
  g.font = `600 22px ${FONT}`;
  g.fillText(a.code === "factory" ? "MADP Factory" : onGithub ? "GitHub" : t("studio.cinematic.screens.codeHome", "Code home"), 70, 35);
  g.beginPath();
  g.arc(40, 27, 13, 0, Math.PI * 2);
  g.fill();
  const slug = repoSlug(a.name || t("studio.cinematic.screens.newProduct", "new product"));
  const row = (y: number, title: string, note: string, on: boolean, tint: string) => {
    g.fillStyle = on ? "rgba(46,160,67,0.18)" : "#161b22";
    roundRect(g, 40, y, W - 80, 86, 12);
    g.fill();
    if (on) {
      g.strokeStyle = "#2ea043";
      g.lineWidth = 2;
      roundRect(g, 40, y, W - 80, 86, 12);
      g.stroke();
    }
    g.fillStyle = tint;
    g.font = `600 24px ${FONT}`;
    g.fillText(fit(g, title, W - 300), 66, y + 38);
    g.fillStyle = "#8b949e";
    g.font = `400 18px ${FONT}`;
    g.fillText(fit(g, note, W - 300), 66, y + 66);
    if (on) {
      g.fillStyle = "#3fb950";
      g.font = `600 20px ${FONT}`;
      g.fillText(`✓ ${t("studio.cinematic.screens.chosen", "Chosen")}`, W - 180, y + 50);
    }
  };
  if (a.code === "") {
    if (s.github === "connecting") {
      g.textAlign = "center";
      g.fillStyle = "#e6edf3";
      g.font = `600 34px ${FONT}`;
      g.fillText(t("studio.cinematic.screens.connectingGithub", "Connecting GitHub…"), W / 2, 220);
      g.fillStyle = "#8b949e";
      g.font = `400 20px ${FONT}`;
      g.fillText(t("studio.cinematic.screens.waitingGithub", "Waiting for your OK on GitHub"), W / 2, 262);
      g.textAlign = "left";
      return;
    }
    g.fillStyle = "#e6edf3";
    g.font = `600 30px ${FONT}`;
    g.fillText(t("studio.cinematic.screens.whereCode", "Where should the code live?"), 40, 112);
    row(150, "MADP Factory", t("studio.cinematic.screens.keptSafe", "Kept safe for you · recommended"), false, "#79a8ff");
    row(256, "GitHub", login ? t("studio.cinematic.screens.connectedAs", "Connected as @{login}", { login }) : t("studio.cinematic.screens.githubOptional", "Optional · connect any time"), false, "#58a6ff");
    return;
  }
  if (a.code === "factory") {
    g.fillStyle = "#8b949e";
    g.font = `400 18px ${FONT}`;
    g.fillText(t("studio.cinematic.screens.keptInFactory", "Kept safe in MADP Factory · GitHub can be connected later"), 40, 96);
    row(120, slug, t("studio.cinematic.screens.privateMain", "Private · main"), true, "#79a8ff");
  } else {
    g.fillStyle = "#8b949e";
    g.font = `400 18px ${FONT}`;
    g.fillText(login ? t("studio.cinematic.screens.signedInAs", "Signed in as @{login}", { login }) : t("studio.cinematic.screens.signedIn", "Signed in"), 40, 96);
    row(120, a.repo, t("studio.cinematic.screens.newRepo", "New private repository · created when we start"), true, "#58a6ff");
  }
  if (a.env) {
    g.fillStyle = "#3fb950";
    g.font = `500 20px ${MONO}`;
    g.fillText(`${t("studio.cinematic.screens.environment", "environment: {env}", { env: a.env.toLowerCase() })}  ✓`, 40, H - 34);
  }
}
const monitorDeps = (s: JourneyState) => [s.github, s.githubLogin, s.answers.code, s.answers.repo, s.answers.env, s.answers.name, s.story];

export function useEngineerMonitor() {
  return useLiveCanvas(960, 540, drawMonitor, monitorDeps);
}

/* ── the build floor's board ────────────────────────────────────────────── */

const COLS = () => [
  t("studio.cinematic.screens.colPlanned", "Planned"), t("studio.cinematic.screens.colInProgress", "In progress"), t("studio.cinematic.screens.colReview", "Review"), t("studio.cinematic.screens.colTesting", "Testing"), t("studio.cinematic.screens.colDone", "Done"),
];
/** the real office's board: the project's steps after Project setup */
const REAL_PLANNED = ["understanding", "sanitization", "requirements", "scope", "build", "release"] as const;
/** where the Planned cards start, and the line they end above: from the build floor's resting view, the front desks'
 *  monitors hide the board below about y = 535 */
const CARDS_TOP = 206;
const CARDS_END = 512;

function drawBoard(g: CanvasRenderingContext2D, s: JourneyState) {
  const W = 1600;
  const H = 640;
  bg(g, W, H, s.phase === "handoff" ? "rgba(47,213,154,0.35)" : "rgba(93,134,255,0.18)");
  g.fillStyle = "#ffffff";
  g.font = `600 44px ${FONT}`;
  track(g, -0.8);
  g.fillText(s.answers.name || t("studio.cinematic.screens.buildBoard", "Build board"), 56, 78);
  track(g, 0);
  g.font = `400 22px ${FONT}`;
  g.fillStyle = "rgba(255,255,255,0.55)";
  g.fillText(s.phase === "handoff"
    ? (s.mode === "real" ? t("studio.cinematic.journey.openingSetup", "Opening Project setup") : t("studio.cinematic.screens.teamStarting", "Your team is starting"))
    : t("studio.cinematic.screens.waitingForGo", "Waiting for the go"), 56, 114);
  // the story: its first requirements, planned; the real office: the project's own steps (setup in progress, the
  // rest planned), never made-up tickets
  const cards: string[][] = s.mode === "real"
    ? [REAL_PLANNED.map((p) => STEP_LABEL[p]), [STEP_LABEL.business], [], [], []]
    : [s.requirements.map((r) => r.title), [], [], [], []];
  COLS().forEach((c, i) => {
    const x = 56 + i * 304;
    g.fillStyle = "rgba(255,255,255,0.07)";
    roundRect(g, x, 150, 286, H - 190, 18);
    g.fill();
    g.fillStyle = "rgba(255,255,255,0.7)";
    g.font = `600 20px ${FONT}`;
    g.fillText(c, x + 18, 186);
    const list = cards[i] ?? [];
    if (list.length) {
      // the usual 64 px cards while they fit above the monitors, shorter ones closer together for a longer list
      const pitch = Math.min(76, Math.floor((CARDS_END - CARDS_TOP + 8) / Math.max(1, list.length)));
      const ch = pitch - (pitch >= 76 ? 12 : 8);
      list.forEach((title, k) => {
        g.fillStyle = "rgba(255,255,255,0.92)";
        roundRect(g, x + 14, CARDS_TOP + k * pitch, 258, ch, 12);
        g.fill();
        g.fillStyle = "#0b0b0f";
        g.font = `500 18px ${FONT}`;
        g.fillText(fit(g, title, 230), x + 28, CARDS_TOP + k * pitch + Math.round(ch / 2) + 6);
      });
    }
  });
}
const boardDeps = (s: JourneyState) => [s.phase, s.requirements, s.answers.name, s.mode];

export function useBuildBoard() {
  return useLiveCanvas(1600, 640, drawBoard, boardDeps, 0.64);
}
