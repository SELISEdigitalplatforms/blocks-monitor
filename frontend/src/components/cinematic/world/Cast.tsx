/** The guides. The MADP Assistant meets the visitor at reception and walks ahead of them between places; the business
 *  analyst walks into the meeting room midway and then comes along. A walk is a list of waypoints fed one by one to
 *  the character's `walkingTo` (it walks to each and turns to its `rotation` at the end). Heads and eyes follow the
 *  visitor (the camera) and turn to whoever is speaking. */
import { useEffect, useRef, useState, type ComponentType } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { CapsuleGeometry, Group, MeshStandardMaterial, SphereGeometry, Vector3 } from "three";
import { PM_JOIN, STAGES, WALKS, type Vec3, type XZ } from "../journey/places";
import { useJourney } from "../journey/store";
import { Agent as RealAgent } from "../../characters/agents";

export interface AgentProps {
  role: "assistant" | "pm";
  position: Vec3;
  rotation?: number;
  speaking?: boolean;
  walkingTo?: Vec3 | null;
  onArrive?: () => void;
  lookAt?: Vec3 | null;
}

const USE_REAL = !new URLSearchParams(window.location.search).has("capsules");

const capsule = new CapsuleGeometry(0.22, 1.1, 6, 16);
const head = new SphereGeometry(0.15, 20, 16);
const shirt = new MeshStandardMaterial({ color: "#ffffff", roughness: 0.7 });
const skin = new MeshStandardMaterial({ color: "#d9a47c", roughness: 0.7 });

/** Stand-in with the same contract (?capsules): walks to `walkingTo`, then settles facing `rotation`. */
function PlaceholderAgent({ position, rotation = 0, speaking, walkingTo, onArrive }: AgentProps) {
  const ref = useRef<Group>(null);
  const cur = useRef(new Vector3(...position));
  const arrived = useRef(false);
  useEffect(() => { cur.current.set(...position); }, [position]);
  useEffect(() => { arrived.current = false; }, [walkingTo]);
  useFrame((st, dt) => {
    const g = ref.current;
    if (!g) return;
    let yaw = rotation;
    if (walkingTo && !arrived.current) {
      const dx = walkingTo[0] - cur.current.x;
      const dz = walkingTo[2] - cur.current.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.02) { arrived.current = true; onArrive?.(); }
      else {
        const step = Math.min(d, 1.0 * dt);
        cur.current.x += (dx / d) * step;
        cur.current.z += (dz / d) * step;
        yaw = Math.atan2(dx, dz);
      }
    }
    g.position.copy(cur.current);
    g.rotation.y += (yaw - g.rotation.y) * Math.min(1, dt * 4);
    g.position.y = speaking ? Math.abs(Math.sin(st.clock.elapsedTime * 8)) * 0.01 : 0;
  });
  return (
    <group ref={ref}>
      <mesh geometry={capsule} material={shirt} position={[0, 0.77, 0]} />
      <mesh geometry={head} material={skin} position={[0, 1.6, 0]} />
    </group>
  );
}

const Agent: ComponentType<AgentProps> = USE_REAL ? (RealAgent as ComponentType<AgentProps>) : PlaceholderAgent;

const v3 = ([x, z]: XZ): Vec3 => [x, 0, z];
/** where the PM waits before joining: behind the lobby's side wall, never in view */
const PM_WAIT: Vec3 = [-9.5, 0, 6.5];

/** One guide following a list of waypoints (a new `route` object starts a new walk from where they are). */
function Walker({ role, start, route, yaw, speaking, lookAt }: {
  role: "assistant" | "pm"; start: Vec3; route: { pts: XZ[]; delay: number } | null; yaw: number; speaking: boolean; lookAt: Vec3;
}) {
  const [i, setI] = useState(0);
  const [go, setGo] = useState(false);
  useEffect(() => {
    setI(0);
    setGo(false);
    if (!route) return;
    const t = window.setTimeout(() => setGo(true), route.delay);
    return () => window.clearTimeout(t);
  }, [route]);
  const target = route && go && i < route.pts.length ? v3(route.pts[i]) : route && go ? v3(route.pts[route.pts.length - 1]) : null;
  const onArrive = () => setI((n) => (route && n < route.pts.length - 1 ? n + 1 : n + (route && n === route.pts.length - 1 ? 1 : 0)));
  return <Agent role={role} position={start} rotation={yaw} speaking={speaking} walkingTo={target} onArrive={onArrive} lookAt={lookAt} />;
}

export function Cast() {
  const stage = useJourney((s) => s.stage);
  const walk = useJourney((s) => s.walk);
  const pm = useJourney((s) => s.pm);
  const speaking = useJourney((s) => s.speaking);
  const thinking = useJourney((s) => s.thinking);
  const resetN = useJourney((s) => s.resetN);
  const camera = useThree((s) => s.camera);

  // the eyes go to the visitor (a live point, read every frame by the character), or to whoever speaks
  const eye = useRef<Vec3>([0, 1.6, 5]);
  useFrame(() => {
    eye.current[0] = camera.position.x;
    eye.current[1] = camera.position.y;
    eye.current[2] = camera.position.z;
  });

  // the PM's entrance into the meeting room
  const [pmEntrance, setPmEntrance] = useState<{ pts: XZ[]; delay: number } | null>(null);
  useEffect(() => { if (pm.joinN > 0) setPmEntrance({ pts: PM_JOIN.path, delay: 200 }); }, [pm.joinN]);
  // a walk's routes stay set after the walk ends, so a guide still on the way finishes it
  const [aRoute, setARoute] = useState<{ pts: XZ[]; delay: number } | null>(null);
  const [pmRoute, setPmRoute] = useState<{ pts: XZ[]; delay: number } | null>(null);
  useEffect(() => {
    if (!walk) return;
    const w = WALKS[walk.to as keyof typeof WALKS];
    setARoute({ pts: w.assistant, delay: 0 });
    if (w.pm && useJourney.getState().pm.present) setPmRoute({ pts: w.pm, delay: 900 });
  }, [walk]);
  useEffect(() => { setARoute(null); setPmRoute(null); setPmEntrance(null); }, [resetN]);
  // at launch the guides step aside, opening the view to the build floor as its lights come up
  const phase = useJourney((s) => s.phase);
  useEffect(() => {
    if (phase !== "handoff" || useJourney.getState().stage !== "buildfloor") return;
    setARoute({ pts: [[29.4, 0.6]], delay: 0 });
    if (useJourney.getState().pm.present) setPmRoute({ pts: [[34.6, 0.6]], delay: 150 });
  }, [phase]);

  const st = STAGES[stage];
  const pmHead: Vec3 = [st.pm.at[0], 1.62, st.pm.at[2]];
  const aHead: Vec3 = [st.assistant.at[0], 1.62, st.assistant.at[2]];
  const talker = speaking ?? thinking;

  return (
    <group key={resetN}>
      <Walker role="assistant" start={STAGES.reception.assistant.at} route={aRoute} yaw={st.assistant.yaw}
        speaking={speaking === "assistant"} lookAt={talker === "pm" && pm.present ? pmHead : eye.current} />
      {/* the business analyst is loaded from the start, waiting out of sight, so walking in never stalls the frame */}
      <Walker role="pm" start={pm.present ? PM_JOIN.from : PM_WAIT} route={pm.present ? pmRoute ?? pmEntrance : null} yaw={st.pm.yaw}
        speaking={speaking === "pm"} lookAt={talker === "assistant" ? aHead : eye.current} />
    </group>
  );
}
