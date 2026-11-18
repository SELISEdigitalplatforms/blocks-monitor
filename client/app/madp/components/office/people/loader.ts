import {
  AnimationClip,
  AnimationMixer,
  Box3,
  Bone,
  Group,
  Material,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  SkinnedMesh,
  Vector3,
  type AnimationAction,
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { BODY } from "../humanKit";
import type { PersonModel } from "./manifest";

/**
 * The code-built person's standing height, so the GLB people match the office:
 * hips (BODY.hipY 0.9) + spine pivot (BODY.spineY 0.1) + neck/head pivot (BODY.headY 0.5)
 * + the skull top above the head pivot (skull centred at y 0.115, radius about 0.12 = 0.235).
 */
const SKULL_TOP = 0.115 + 0.12;
export const PERSON_HEIGHT: number = BODY.hipY + BODY.spineY + BODY.headY + SKULL_TOP;

/** Yaw (radians) applied inside the instance root so every model faces +Z (heading 0). Both rigs export facing +Z. */
const FACING_YAW: Record<PersonModel["family"], number> = { A: 0, B: 0 };

export interface LoadedPerson {
  model: PersonModel;
  scene: Group;
  clips: AnimationClip[];
  clipNames: ReadonlySet<string>;
  scale: number;
  yOffset: number;
  height: number;
  headY: number;
}

export interface PersonInstance {
  root: Group;
  mixer: AnimationMixer;
  action(name: string): AnimationAction | null;
  dispose(): void;
}

/** Pure: scale a model of vertical extent minY..maxY to `target`, with its feet (minY) on y = 0. */
export function fitToHeight(minY: number, maxY: number, target: number): { scale: number; yOffset: number } {
  const span = maxY - minY;
  const scale = span > 0 && Number.isFinite(span) ? target / span : 1;
  return { scale, yOffset: -minY * scale };
}

const RETRY_AFTER_MS = 30_000;
const cache = new Map<string, Promise<LoadedPerson>>();
const ready = new Map<string, LoadedPerson>();
const ghostMaterials = new WeakMap<LoadedPerson, Map<Material, Material>>();

let loader: GLTFLoader | null = null;
function sharedLoader(): GLTFLoader {
  if (!loader) loader = new GLTFLoader();
  return loader;
}

/** Raised when the WebAssembly meshopt decoder cannot compile (the page's CSP refuses it); not retried this session. */
export class MeshoptUnavailableError extends Error {
  constructor(cause?: unknown) {
    super("The meshopt decoder is not available in this browser session.");
    this.name = "MeshoptUnavailableError";
    this.cause = cause;
  }
}

/** Set once the decoder failed to compile, so the office keeps its code-built people without logging again. */
let meshoptBlocked = false;
let meshoptReady: Promise<void> | null = null;

/** Pure: the extensions a GLB declares (extensionsUsed and extensionsRequired); [] for anything that is not a valid GLB. */
export function glbExtensions(buffer: ArrayBuffer): string[] {
  try {
    if (buffer.byteLength < 20) return [];
    const view = new DataView(buffer);
    if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2) return [];
    const length = view.getUint32(12, true);
    if (view.getUint32(16, true) !== 0x4e4f534a || 20 + length > buffer.byteLength) return [];
    const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, length))) as {
      extensionsUsed?: unknown;
      extensionsRequired?: unknown;
    };
    const names = new Set<string>();
    for (const list of [json.extensionsUsed, json.extensionsRequired]) {
      if (Array.isArray(list)) for (const n of list) if (typeof n === "string") names.add(n);
    }
    return [...names];
  } catch {
    return [];
  }
}

function isCompileRefusal(e: unknown): boolean {
  if (typeof WebAssembly !== "undefined" && e instanceof WebAssembly.CompileError) return true;
  if (e instanceof EvalError) return true;
  const n = (e as { name?: string } | null)?.name;
  return n === "CompileError" || n === "EvalError";
}

/** Loads the WebAssembly decoder only for a model that needs it, once, and sets it on the shared loader. */
function ensureMeshopt(): Promise<void> {
  if (meshoptBlocked) return Promise.reject(new MeshoptUnavailableError());
  if (!meshoptReady) {
    meshoptReady = (async () => {
      try {
        const { MeshoptDecoder } = await import("three/examples/jsm/libs/meshopt_decoder.module.js");
        await MeshoptDecoder.ready;
        sharedLoader().setMeshoptDecoder(MeshoptDecoder);
      } catch (e) {
        if (isCompileRefusal(e)) {
          meshoptBlocked = true;
          throw new MeshoptUnavailableError(e);
        }
        meshoptReady = null;
        throw e;
      }
    })();
  }
  return meshoptReady;
}

function resolveUrl(url: string): string {
  const base = import.meta.env.BASE_URL || "/";
  return `${base.endsWith("/") ? base : `${base}/`}${url.replace(/^\/+/, "")}`;
}

function parse(model: PersonModel): Promise<LoadedPerson> {
  const url = resolveUrl(model.url);
  return fetch(url)
    .then((res) => {
      if (!res.ok) throw new Error(`Could not load ${url} (${res.status})`);
      return res.arrayBuffer();
    })
    .then(async (buffer) => {
      if (glbExtensions(buffer).includes("EXT_meshopt_compression")) await ensureMeshopt();
      const base = url.slice(0, url.lastIndexOf("/") + 1);
      return sharedLoader().parseAsync(buffer, base);
    })
    .then((gltf) => {
      const scene = gltf.scene as unknown as Group;
      scene.traverse((o) => {
        const mesh = o as Mesh;
        if (mesh.isMesh) {
          mesh.castShadow = false;
          mesh.receiveShadow = false;
        }
        if ((o as SkinnedMesh).isSkinnedMesh) o.frustumCulled = false;
      });
      scene.updateMatrixWorld(true);
      const box = new Box3().setFromObject(scene, true);
      const { scale, yOffset } = fitToHeight(box.min.y, box.max.y, PERSON_HEIGHT);
      let headY = PERSON_HEIGHT;
      let head: Object3D | null = null;
      scene.traverse((o) => {
        if (!head && (o as Bone).isBone && /head/i.test(o.name)) head = o;
      });
      if (head) {
        const p = (head as Object3D).getWorldPosition(new Vector3());
        headY = p.y * scale + yOffset + 0.12;
      }
      const clips = gltf.animations ?? [];
      const loaded: LoadedPerson = {
        model,
        scene,
        clips,
        clipNames: new Set(clips.map((c) => c.name)),
        scale,
        yOffset,
        height: PERSON_HEIGHT,
        headY,
      };
      ready.set(model.id, loaded);
      return loaded;
    });
}

/** Parses each model once per session. A failed load is evicted after 30 s so a later mount may retry. */
export function loadPerson(model: PersonModel): Promise<LoadedPerson> {
  const hit = cache.get(model.id);
  if (hit) return hit;
  const p = parse(model);
  cache.set(model.id, p);
  p.catch((e) => {
    if (e instanceof MeshoptUnavailableError) return;
    setTimeout(() => {
      if (cache.get(model.id) === p) cache.delete(model.id);
    }, RETRY_AFTER_MS);
  });
  return p;
}

/** The parsed entry once ready (synchronous, so a remount does not flicker). */
export function peekPerson(id: string): LoadedPerson | null {
  return ready.get(id) ?? null;
}

function ghostFor(p: LoadedPerson, m: Material): Material {
  let map = ghostMaterials.get(p);
  if (!map) ghostMaterials.set(p, (map = new Map()));
  let g = map.get(m);
  if (!g) {
    g = m.clone();
    g.transparent = true;
    g.opacity = 0.35;
    g.depthWrite = false;
    map.set(m, g);
  }
  return g;
}

/**
 * A skinned clone for one agent. Geometry and materials stay SHARED with the cached scene, so
 * dispose() only frees per-instance state (mixer, skeleton bone textures) and never touches the
 * shared geometry or materials: those stay cached for the session.
 */
export function instancePerson(p: LoadedPerson, opts?: { ghost?: boolean }): PersonInstance {
  const body = cloneSkinned(p.scene) as Group;
  const skinned: SkinnedMesh[] = [];
  body.traverse((o) => {
    const mesh = o as Mesh;
    if ((o as SkinnedMesh).isSkinnedMesh) skinned.push(o as SkinnedMesh);
    if (opts?.ghost && mesh.isMesh) {
      mesh.material = Array.isArray(mesh.material)
        ? mesh.material.map((m) => ghostFor(p, m))
        : ghostFor(p, mesh.material as MeshStandardMaterial);
    }
  });
  body.rotation.y = FACING_YAW[p.model.family];
  const root = new Group();
  root.scale.setScalar(p.scale);
  root.position.y = p.yOffset;
  root.add(body);
  const mixer = new AnimationMixer(body);
  const byName = new Map(p.clips.map((c) => [c.name, c]));
  return {
    root,
    mixer,
    action(name) {
      const clip = byName.get(name);
      return clip ? mixer.clipAction(clip) : null;
    },
    dispose() {
      mixer.stopAllAction();
      mixer.uncacheRoot(body);
      for (const s of skinned) s.skeleton.dispose();
      root.removeFromParent();
    },
  };
}
