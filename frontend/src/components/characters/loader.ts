/**
 * Loads the cast's GLB files without WebAssembly: plain GLTFLoader, no Draco/meshopt/KTX2 decoders (the files are
 * quantized geometry + WebP textures, which browsers decode natively; the app's CSP has no 'wasm-unsafe-eval').
 * One download and parse per file, shared by every person that wears it; each person gets a skeleton clone.
 */
import { AnimationClip, Box3, Mesh, MeshStandardMaterial, Object3D, PMREMGenerator, Texture, type Loader, type SkinnedMesh, type WebGLRenderer } from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { GLTFLoader, type GLTF, type GLTFParser } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { clipsUrl, modelUrl, wasmExtensionsIn, type CharacterId, type Tier } from "./registry";

export interface LoadedModel {
  gltf: GLTF;
  /** bind-pose height (feet at 0) in model units */
  height: number;
}

const models = new Map<string, Promise<LoadedModel>>();
const clips = new Map<string, Promise<AnimationClip[]>>();
let loader: GLTFLoader | null = null;

interface ImageParser {
  json: { images?: { bufferView?: number; mimeType?: string }[] };
  sourceCache: Record<number, Promise<Texture>>;
  loadImageSource(sourceIndex: number, loader: Loader): Promise<Texture>;
  getDependency(type: "bufferView", index: number): Promise<ArrayBuffer>;
}

/** GLTFLoader plugin: embedded images decode straight from their bytes (createImageBitmap on a Blob). three's
 *  ImageBitmapLoader would fetch() a blob: URL, which the app's CSP (connect-src) rightly does not allow; decoding the
 *  bytes needs no URL at all. Images with a URI, or browsers without createImageBitmap, keep the stock path. */
export function bitmapImagesPlugin(gltfParser: GLTFParser) {
  const parser = gltfParser as unknown as ImageParser;
  const stock = parser.loadImageSource.bind(parser);
  parser.loadImageSource = (sourceIndex, imageLoader) => {
    const def = parser.json.images?.[sourceIndex];
    if (def?.bufferView === undefined || typeof createImageBitmap === "undefined") return stock(sourceIndex, imageLoader);
    const cached = parser.sourceCache[sourceIndex];
    if (cached !== undefined) return cached.then((t) => t.clone());
    const p = parser.getDependency("bufferView", def.bufferView)
      .then((bytes) => createImageBitmap(new Blob([bytes], { type: def.mimeType }), { premultiplyAlpha: "none", colorSpaceConversion: "none" }))
      .then((bitmap) => {
        const t = new Texture(bitmap);
        t.needsUpdate = true;
        t.userData.mimeType = def.mimeType;
        return t;
      });
    parser.sourceCache[sourceIndex] = p;
    return p;
  };
  return { name: "MADP_bitmap_images" };
}

function gltfLoader(): GLTFLoader {
  // deliberately no setDRACOLoader / setMeshoptDecoder / setKTX2Loader
  return (loader ??= new GLTFLoader().register(bitmapImagesPlugin));
}

async function loadGltf(url: string): Promise<GLTF> {
  const gltf = await gltfLoader().loadAsync(url);
  const wasm = wasmExtensionsIn(gltf.parser.json as { extensionsRequired?: string[]; extensionsUsed?: string[] });
  if (wasm.length) throw new Error(`${url} needs WebAssembly (${wasm.join(", ")})`);
  return gltf;
}

export function loadModel(url: string): Promise<LoadedModel> {
  let p = models.get(url);
  if (!p) {
    p = loadGltf(url).then((gltf) => {
      gltf.scene.updateMatrixWorld(true);
      const box = new Box3().setFromObject(gltf.scene);
      gltf.scene.traverse((o) => {
        const m = o as Mesh;
        if (!m.isMesh) return;
        m.castShadow = true;
        m.receiveShadow = true;
      });
      return { gltf, height: Math.max(0.01, box.max.y - Math.min(0, box.min.y)) };
    });
    p.catch(() => models.delete(url));
    models.set(url, p);
  }
  return p;
}

const clipMetas = new WeakMap<AnimationClip, Record<string, unknown>>();

/** what the build measured for a clip (asset extras madp.clips: e.g. the walk's groundSpeed in model m/s) */
export function clipMeta(clip: AnimationClip): Record<string, unknown> {
  return clipMetas.get(clip) ?? {};
}

export function loadClips(url: string): Promise<AnimationClip[]> {
  let p = clips.get(url);
  if (!p) {
    p = loadGltf(url).then((g) => {
      // what the build measured per clip (e.g. the walk's ground speed), from the file's asset extras
      const meta = ((g.parser.json as { asset?: { extras?: { madp?: { clips?: Record<string, Record<string, unknown>> } } } }).asset?.extras?.madp?.clips) ?? {};
      for (const c of g.animations) clipMetas.set(c, { ...(meta[c.name] ?? {}) });
      return g.animations;
    });
    p.catch(() => clips.delete(url));
    clips.set(url, p);
  }
  return p;
}

/** a person's model and clips, both cached */
export function loadCharacter(id: CharacterId, tier: Tier): Promise<[LoadedModel, AnimationClip[]]> {
  return Promise.all([loadModel(modelUrl(id, tier)), loadClips(clipsUrl(id))]);
}

/** start downloads early (e.g. after the room's first frame); failures surface when the person mounts */
export function prefetchCharacters(people: readonly { id: CharacterId; tier: Tier }[]): void {
  for (const p of people) loadCharacter(p.id, p.tier).catch(() => undefined);
}

/** a person of their own: the scene with a cloned skeleton, sharing geometry, materials and textures. Culling uses
 *  the skinned bind-pose bounds, padded so a raised hand (a wave) never pops out of view. */
export function instantiate(model: LoadedModel): Object3D {
  const root = cloneSkinned(model.gltf.scene);
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    const m = o as SkinnedMesh;
    if (!m.isSkinnedMesh) return;
    m.computeBoundingSphere();
    m.boundingSphere!.radius *= 1.35;
    m.frustumCulled = true;
  });
  return root;
}

/* ── one lighting recipe for every person ───────────────────────────────── */

const envs = new WeakMap<WebGLRenderer, Texture>();

/** a soft studio reflection (three's RoomEnvironment, prefiltered once per renderer) */
export function characterEnvironment(gl: WebGLRenderer): Texture {
  let t = envs.get(gl);
  if (!t) {
    const pm = new PMREMGenerator(gl);
    t = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    pm.dispose();
    envs.set(gl, t);
  }
  return t;
}

/** The shared material treatment: the studio reflection at a gentle strength, so skin, fabric and hair read the same
 *  in every scene whatever its own lights. Materials are shared by every clone; each takes the current renderer's
 *  environment (a prefiltered map belongs to one WebGL context). */
export function treatMaterials(root: Object3D, env: Texture, intensity = 0.55): void {
  root.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh) return;
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      if (!(mat instanceof MeshStandardMaterial) || mat.envMap === env) continue;
      mat.envMap = env;
      mat.envMapIntensity = intensity;
      mat.needsUpdate = true;
    }
  });
}
