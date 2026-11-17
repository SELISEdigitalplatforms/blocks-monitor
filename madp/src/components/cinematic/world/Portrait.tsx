/** Small real portraits of the guides for the composer and the transcript: once a guide stands at a place and looks
 *  at the visitor, the scene is rendered once through a little portrait camera placed on the line from the guide's head
 *  bone to the visitor's eyes (so the shot is face-centred), and read back into an image. No per-frame cost. */
import { useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { PerspectiveCamera, Vector3, WebGLRenderTarget, SRGBColorSpace, type Object3D } from "three";
import { STAGES } from "../journey/places";
import { usePortraits } from "../journey/portraits";
import { useJourney } from "../journey/store";
import { useOfficeScene } from "../visit/scene";

const SIZE = 160;

export function PortraitCapture() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const { cam, rt, buf } = useMemo(() => {
    const c = new PerspectiveCamera(30, 1, 0.05, 20);
    const r = new WebGLRenderTarget(SIZE, SIZE, { colorSpace: SRGBColorSpace });
    return { cam: c, rt: r, buf: new Uint8Array(SIZE * SIZE * 4) };
  }, []);
  const tries = useRef({ assistant: 0, pm: 0, next: 0 });

  const head = useMemo(() => new Vector3(), []);
  const dir = useMemo(() => new Vector3(), []);
  /** the head bone of the character standing at the role's spot (the guides are Rocketbox rigs) */
  const findHead = (role: "assistant" | "pm"): boolean => {
    const j = useJourney.getState();
    const [x, , z] = STAGES[j.stage][role].at;
    let best: Object3D | null = null;
    let bestD = 0.7;
    const p = new Vector3();
    scene.traverse((o) => {
      if (o.name !== "Bip01_Head") return;
      o.getWorldPosition(p);
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < bestD) { bestD = d; best = o; }
    });
    if (!best) return false;
    (best as Object3D).getWorldPosition(head);
    return true;
  };

  const busy = useRef(false);
  const shoot = (role: "assistant" | "pm"): boolean => {
    if (busy.current) return false;
    if (!findHead(role)) return false;
    // the guide looks at the visitor: shoot from that direction, 0.55 m out, aimed at the face
    head.y += 0.07;
    dir.copy(eye).sub(head).setY(0).normalize();
    cam.position.copy(head).addScaledVector(dir, 0.62);
    cam.position.y = head.y + 0.02;
    cam.lookAt(head);
    const prev = gl.getRenderTarget();
    gl.setRenderTarget(rt);
    gl.render(scene, cam);
    gl.setRenderTarget(prev);
    // read back without stalling the GPU (a pixel buffer, resolved a frame or two later)
    busy.current = true;
    void gl.readRenderTargetPixelsAsync(rt, 0, 0, SIZE, SIZE, buf).then(() => { busy.current = false; finish(role); }, () => { busy.current = false; });
    return true;
  };
  const finish = (role: "assistant" | "pm") => {
    const c = document.createElement("canvas");
    c.width = SIZE;
    c.height = SIZE;
    const g = c.getContext("2d")!;
    const img = g.createImageData(SIZE, SIZE);
    for (let y = 0; y < SIZE; y++) img.data.set(buf.subarray((SIZE - 1 - y) * SIZE * 4, (SIZE - y) * SIZE * 4), y * SIZE * 4);
    g.putImageData(img, 0, 0);
    usePortraits.getState().set(role, c.toDataURL("image/jpeg", 0.86));
  };
  const eye = useThree((s) => s.camera).position;

  useFrame((st) => {
    const t = st.clock.elapsedTime;
    const T = tries.current;
    if (t < T.next) return;
    const j = useJourney.getState();
    if (j.walk || j.phase === "handoff") return;
    // (the assistant is captured while the intro is still up, before anything moves)
    // the assistant: in the lobby once he stands and asks; the PM: once he asks his first question
    if (T.assistant < 1 && j.stage === "reception" && t > 2.5) { if (shoot("assistant")) T.assistant++; T.next = t + 0.5; return; }
    // (the office visit: once the analyst stands at the table)
    if (T.pm < 1 && j.pm.present && j.stage === "meeting" && (j.askId === "f0" || useOfficeScene.getState().office)) { if (shoot("pm")) T.pm++; T.next = t + 0.5; }
  });
  return null;
}
