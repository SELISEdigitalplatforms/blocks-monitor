/**
 * The guides' assets on top of the cast loader (../loader.ts): each guide's own model file is downloaded and parsed
 * once, tailored once (sleeves, collar, trouser legs as its base needs) and gets its own copy of the body material with
 * the polo painted in (once per file, ~100 ms); the clips are the cast's shared set.
 */
import { CanvasTexture, Color, Matrix4, MeshPhysicalMaterial, Quaternion, Vector3, type Bone, LinearSRGBColorSpace, SRGBColorSpace, Texture, TextureLoader, type Material, MeshStandardMaterial, type Object3D, type SkinnedMesh } from "three";
import { instantiate, loadClips, loadModel, type LoadedModel } from "../loader";
import { dressHead, dressPolo, foldCollar, logoAnchor, slimForearms, trouserLegs, type PoloResult } from "./outfit";
import { AGENTS, agentClipsUrl, agentModelUrl, LOGO_URL, type AgentRole } from "./registry";

export interface DressedAgent {
  model: LoadedModel;
  /** the polo body material (shared by every instance of this guide) */
  body: MeshStandardMaterial;
  bodyName: string;
  logo: PoloResult["logo"];
  /** the logo patch in the chest bone's frame (unit width) */
  logoMatrix: Matrix4 | null;
  /** the face: skin material with sheen, off-white sclera */
  head: MeshStandardMaterial | null;
  headName: string;
  /** each eyeball in its bone's frame: a unit sphere there, looking down +z (rest gaze) */
  eyes: { bone: string; matrix: Matrix4; radius: number }[];
}

/** a physical copy of a glTF material: same maps, plus a soft cloth/skin sheen */
function physical(src: MeshStandardMaterial, sheen: number, sheenColor: string): MeshPhysicalMaterial {
  const m = new MeshPhysicalMaterial();
  MeshStandardMaterial.prototype.copy.call(m, src);
  m.sheen = sheen;
  m.sheenRoughness = 0.65;
  m.sheenColor = new Color(sheenColor);
  m.specularIntensity = 0.5;
  return m;
}

const dressed = new Map<AgentRole, Promise<DressedAgent>>();
let logoP: Promise<Texture> | null = null;

export function headMesh(root: Object3D): SkinnedMesh | null {
  let found: SkinnedMesh | null = null;
  root.traverse((o) => {
    const m = o as SkinnedMesh;
    if (!found && m.isSkinnedMesh && (m.material as Material).name?.endsWith("_head")) found = m;
  });
  return found;
}

export function bodyMesh(root: Object3D): SkinnedMesh | null {
  let found: SkinnedMesh | null = null;
  root.traverse((o) => {
    const m = o as SkinnedMesh;
    if (!found && m.isSkinnedMesh && (m.material as Material).name?.endsWith("_body")) found = m;
  });
  return found;
}

function canvasTex(c: HTMLCanvasElement, srgb: boolean, like?: Texture | null): CanvasTexture {
  const t = new CanvasTexture(c);
  t.flipY = false;
  t.colorSpace = srgb ? SRGBColorSpace : LinearSRGBColorSpace;
  t.anisotropy = 4;
  if (like) { t.wrapS = like.wrapS; t.wrapT = like.wrapT; }
  return t;
}

async function dress(role: AgentRole): Promise<DressedAgent> {
  const model = await loadModel(agentModelUrl(role));
  model.gltf.scene.updateMatrixWorld(true);
  // FBX vertex colours (some Rocketbox exports carry them) would tint the textures: not used
  model.gltf.scene.traverse((o) => {
    const m = o as SkinnedMesh;
    if (!m.isMesh || !m.geometry.getAttribute("color")) return;
    m.geometry.deleteAttribute("color");
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) { (mat as MeshStandardMaterial).vertexColors = false; mat.needsUpdate = true; }
  });
  const mesh = bodyMesh(model.gltf.scene);
  if (!mesh) throw new Error(`${role}: no body mesh`);
  const src = mesh.material as MeshStandardMaterial;
  if (!model.gltf.userData.tailored) {
    // once per file: bare forearms instead of long sleeves, a laid-down collar where it stood up, trouser legs below shorts
    const def = AGENTS[role];
    if (!def.bareArms) slimForearms(mesh);
    if (def.foldCollar) foldCollar(mesh);
    if (def.shorts) trouserLegs(mesh);
    model.gltf.userData.tailored = true;
  }
  const r = dressPolo(mesh, { paintCollar: Boolean(AGENTS[role].foldCollar) });
  const body = physical(src, 0.25, "#f4f1ec");
  body.name = `${src.name}_polo`;
  body.map = canvasTex(r.color, true, src.map);
  if (r.normal) body.normalMap = canvasTex(r.normal, false, src.normalMap);
  if (r.rough) { const t = canvasTex(r.rough, false, src.roughnessMap); body.roughnessMap = t; body.metalnessMap = t; }
  body.needsUpdate = true;
  if (import.meta.env.DEV) ((window as unknown as { __polo?: Record<string, PoloResult> }).__polo ??= {})[role] = r;
  const chest = mesh.skeleton.bones.find((b) => b.name === "Bip01_Spine2") as Bone | undefined;

  // the face
  let head: MeshPhysicalMaterial | null = null, headName = "";
  const eyes: DressedAgent["eyes"] = [];
  const hm = headMesh(model.gltf.scene);
  if (hm) {
    const hsrc = hm.material as MeshStandardMaterial;
    const h = dressHead(hm);
    head = physical(hsrc, 0.35, "#ffd9c7");
    headName = hsrc.name;
    head.name = `${hsrc.name}_face`;
    head.map = canvasTex(h.color, true, hsrc.map);
    head.sheenColor.set("#ffffff");
    head.sheenColorMap = canvasTex(h.sheen, true, hsrc.map);
    if (h.rough) { const t = canvasTex(h.rough, false, hsrc.roughnessMap); head.roughnessMap = t; head.metalnessMap = t; }
    head.needsUpdate = true;
    for (const e of h.eyes) {
      const bone = hm.skeleton.bones.find((b) => b.name === e.bone);
      if (!bone) continue;
      bone.updateWorldMatrix(true, false);
      const inWorld = new Matrix4().compose(e.center, new Quaternion(), new Vector3(e.radius, e.radius, e.radius));
      eyes.push({ bone: e.bone, radius: e.radius, matrix: new Matrix4().copy(bone.matrixWorld).invert().multiply(inWorld) });
    }
  }
  return { model, body, bodyName: src.name, logo: r.logo, logoMatrix: chest ? logoAnchor(chest, r.logo, 0.005) : null, head, headName, eyes };
}

export function loadAgent(role: AgentRole): Promise<DressedAgent> {
  let p = dressed.get(role);
  if (!p) {
    p = dress(role);
    p.catch(() => dressed.delete(role));
    dressed.set(role, p);
  }
  return p;
}

export function loadLogo(): Promise<Texture> {
  if (!logoP) {
    logoP = new TextureLoader().loadAsync(LOGO_URL).then((t) => {
      t.colorSpace = SRGBColorSpace;
      t.anisotropy = 16;
      return t;
    });
    logoP.catch(() => { logoP = null; });
  }
  return logoP;
}

export { agentClipsUrl, loadClips };

/** start downloads (and the polo painting) early, e.g. when the journey opens */
export function preloadAgents(): void {
  for (const r of ["assistant", "pm"] as const) {
    loadAgent(r).catch(() => undefined);
    loadClips(agentClipsUrl(r)).catch(() => undefined);
  }
  loadLogo().catch(() => undefined);
}

/** one guide of its own: cloned skeleton, the polo material on the body */
export function instantiateAgent(a: DressedAgent): Object3D {
  const root = instantiate(a.model);
  root.traverse((o) => {
    const m = o as SkinnedMesh;
    if (!m.isSkinnedMesh) return;
    const n = (m.material as Material).name;
    if (n === a.bodyName) m.material = a.body;
    else if (a.head && n === a.headName) m.material = a.head;
  });
  return root;
}
