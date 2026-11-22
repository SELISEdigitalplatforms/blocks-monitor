/** The scene's camera, shared with the HTML overlays so they can place themselves once (no per-frame reprojection). */
import { PerspectiveCamera, Vector3 } from "three";
import { STAGES, type StageId, type Vec3 } from "../journey/places";

const cam = new PerspectiveCamera(50, 16 / 9, 0.05, 80);
const v = new Vector3();

/** Where a world point lands (in % of the stage) when the camera rests at a place's view. */
export function projectAtRest(stage: StageId, p: Vec3, aspect: number): { x: number; y: number } {
  const c = STAGES[stage].camera;
  cam.aspect = aspect;
  cam.position.set(...c.pos);
  cam.lookAt(...c.target);
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld();
  v.set(...p).project(cam);
  return { x: (v.x * 0.5 + 0.5) * 100, y: (1 - (v.y * 0.5 + 0.5)) * 100 };
}
