/** The 3D world of the cinematic new project (lazy-loaded): one continuous low-poly building the camera walks through
 *  on guided paths, the business agent and the business analyst as realistic people
 *  (src/components/characters; the code-built Person3D shows until they load, or if they cannot), and the clickable
 *  doorways. Overlay UI and the conversation live in CinematicNewProject.tsx. */

import { AdaptiveDpr, PerformanceMonitor } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { CharacterLights, headBob, mover, RealPerson, STOPPED, stepMover, walkProfile, type Activity, type WalkProfile } from "@/components/characters";
import { CatmullRomCurve3, Vector3, type Group, type Object3D } from "three";
import { agentSpot, LOBBY, PM_SPOT, rajivWalk, ROOM_X, WALK_SPEED, type CinematicType, type PathKey, type V3, type Waypoint } from "./journeyScenes";
import type { Phase } from "./dialogue";
import { Person3D, type PersonLook } from "./Person3D";
import { CoffeeShop, Corridor, Hotspot, Lobby, MeetingRoom, ProductRoom } from "./Rooms";

const v = (p: V3) => new Vector3(p[0], p[1], p[2]);
const UP = new Vector3(0, 1, 0);

/** Walks the camera along the current path at a human pace (speeds up, cruises, slows down; the head bobs once per
 *  step and sways once per stride, with the pace); the gaze follows smoothly. Once arrived, the visitor can look around
 *  a little with the pointer. */
function Rig({ path, pathKey, reduced, onArrive, follow }: {
  path: Waypoint[]; pathKey: PathKey; reduced: boolean; onArrive: (key: PathKey) => void;
  /** a person the gaze keeps on (step 2: the business analyst walking to the board) */
  follow?: MutableRefObject<Object3D | null> | null;
}) {
  const camera = useThree((s) => s.camera);
  const arrive = useRef(onArrive);
  arrive.current = onArrive;
  const S = useRef({
    key: "" as string, t: 0, dur: 1, done: true, len: 0, profile: null as WalkProfile | null,
    at: null as CatmullRomCurve3 | null, look: null as CatmullRomCurve3 | null, primed: false,
    endLook: new Vector3(), lookNow: new Vector3(), p: new Vector3(), q: new Vector3(), dir: new Vector3(), right: new Vector3(), aim: new Vector3(),
  });
  useFrame((state, raw) => {
    const s = S.current;
    // real time up to 10 fps (a weak device keeps the pace); longer gaps (a background tab) do not jump
    const dt = Math.min(raw, 0.1);
    if (s.key !== pathKey) {
      s.key = pathKey;
      s.t = 0;
      const last = path[path.length - 1];
      s.endLook.copy(v(last.look));
      if (!s.primed) { s.lookNow.copy(s.endLook); s.primed = true; }
      if (path.length < 2) {
        s.at = s.look = null;
        s.done = true;
        camera.position.copy(v(last.at));
        s.lookNow.copy(s.endLook);
      } else {
        s.at = new CatmullRomCurve3(path.map((w) => v(w.at)), false, "centripetal");
        s.look = new CatmullRomCurve3(path.map((w) => v(w.look)), false, "centripetal");
        s.len = s.at.getLength();
        s.profile = walkProfile(s.len, WALK_SPEED);
        s.dur = Math.max(1.2, s.profile.duration);
        s.done = false;
        if (reduced) s.t = s.dur;
      }
    }
    if (!s.done && s.at && s.look && s.profile) {
      s.t += dt;
      const d = s.profile.duration > 0 ? s.profile.at(Math.min(s.t, s.profile.duration)) : s.len * Math.min(1, s.t / s.dur);
      const u = s.len > 0 ? Math.min(1, d / s.len) : 1;
      s.at.getPointAt(u, s.p);
      s.look.getPointAt(u, s.q);
      if (!reduced) {
        const b = headBob(d, s.profile.speedAt(s.t), WALK_SPEED);
        s.dir.copy(s.q).sub(s.p).setY(0).normalize();
        s.right.crossVectors(s.dir, UP).normalize();
        s.p.addScaledVector(s.right, b.x);
        s.p.y += b.y;
      }
      camera.position.copy(s.p);
      if (follow?.current) {
        follow.current.getWorldPosition(s.aim);
        s.aim.y = 1.45;
        s.q.lerp(s.aim, 0.7);
      }
      // the gaze follows the path's look line, smoothed so turns never snap
      if (reduced) s.lookNow.copy(s.q);
      else s.lookNow.lerp(s.q, 1 - Math.exp(-dt * 7));
      if (s.t >= s.dur) {
        s.done = true;
        arrive.current(pathKey);
      }
    } else if (!reduced) {
      // look around with the pointer, a little (still on the person being followed, while they finish their walk)
      if (follow?.current) {
        follow.current.getWorldPosition(s.aim);
        s.endLook.lerp(s.aim.setY(1.4), 1 - Math.exp(-dt * 3));
      }
      s.dir.copy(s.endLook).sub(camera.position).normalize();
      s.right.crossVectors(s.dir, UP).normalize();
      s.aim.copy(s.endLook).addScaledVector(s.right, state.pointer.x * 0.7).addScaledVector(UP, state.pointer.y * 0.35);
      s.lookNow.lerp(s.aim, 1 - Math.exp(-dt * 2.5));
    } else {
      s.lookNow.copy(s.endLook);
    }
    camera.lookAt(s.lookNow);
  });
  return null;
}

/** A person who can walk: follows `path` (floor points) like a person once `go` is set (gait.ts: speeds up, turns
 *  towards the way, slows down, turns on the spot to `face`), and tells the person inside what they are doing. */
function Walker({ from, path, face, go, reduced, children, body }: {
  from: V3; path: readonly V3[]; face: number; go: boolean; reduced: boolean;
  children: (activity: MutableRefObject<Activity & { speed?: number }>) => ReactNode;
  /** the walking group, for a camera that follows */
  body?: MutableRefObject<Object3D | null>;
}) {
  const group = useRef<Group>(null);
  useEffect(() => {
    if (body) body.current = group.current;
  });
  const m = useRef(mover({ x: from[0], z: from[2] }, 0));
  const activity = useRef<Activity & { speed?: number }>({ moving: false, turning: false, speed: 0 });
  const started = useRef(false);
  useEffect(() => {
    if (!go || started.current) return;
    started.current = true;
    m.current.path = path.slice(1).map(([x, , z]) => ({ x, z }));
  }, [go, path]);
  useFrame((_, raw) => {
    const g = group.current;
    if (!g) return;
    const w = stepMover(m.current, Math.min(raw, 0.05), { face: started.current ? face : null, reduced });
    g.position.set(w.x, 0, w.z);
    g.rotation.y = w.heading;
    const a = activity.current;
    a.moving = w.speed > STOPPED;
    a.turning = w.turning !== 0;
    a.speed = w.speed;
  });
  return <group ref={group} position={from as [number, number, number]}>{children(activity)}</group>;
}

/** the code-built stand-ins (while the realistic people load, or if they cannot): the business agent in a navy suit, the business analyst in a
 *  taupe blazer, light-blue shirt and navy trousers */
const LOOK: Record<"greenfield" | "brownfield" | "pm", PersonLook> = {
  greenfield: { skin: "#e3bf9f", hair: "#17161a", top: "#2a3350", legs: "#262c40", shoes: "#141416", hairStyle: "short", collar: "#f4f4f7" },
  brownfield: { skin: "#e3bf9f", hair: "#17161a", top: "#2a3350", legs: "#262c40", shoes: "#141416", hairStyle: "short", collar: "#f4f4f7" },
  pm: { skin: "#b27a55", hair: "#2a1f18", top: "#706558", legs: "#282c3a", shoes: "#221813", hairStyle: "short", collar: "#9eb8d8" },
};

/** phases in which the host waits for the visitor's words */
const LISTENING: ReadonlySet<Phase> = new Set(["name", "brief", "confirm", "edit"]);
/** phases with the business analyst's room in view (its door open) */
const PM_ON: ReadonlySet<Phase> = new Set(["through", "team", "onward", "done"]);

/** Who is speaking now, so that person moves their mouth and hands for about as long as the line takes to type. */
export interface Speaking { who: "host" | "pm"; key: string; seconds: number }

export interface WorldProps {
  phase: Phase;
  type: CinematicType | null;
  pathKey: PathKey;
  path: Waypoint[];
  reduced: boolean;
  hoverType: CinematicType | null;
  onHoverType: (t: CinematicType | null) => void;
  onChoose: (t: CinematicType) => void;
  /** the project exists: the product team's door can be knocked on */
  doorReady: boolean;
  onKnock: () => void;
  onArrive: (key: PathKey) => void;
  speaking: Speaking | null;
}

const RAJIV_WALK = rajivWalk();

function Scene({ phase, type, pathKey, path, reduced, hoverType, onHoverType, onChoose, doorReady, onKnock, onArrive, speaking }: WorldProps) {
  const choosing = phase === "choose";
  const inRoom = phase !== "choose" && phase !== "entering";
  const pmOn = PM_ON.has(phase);
  const onward = pathKey === "onward";
  const pmSpeaking = speaking?.who === "pm" ? speaking.key : null;
  const rajiv = useRef<Object3D | null>(null);
  return (
    <>
      <color attach="background" args={["#1b2233"]} />
      <fog attach="fog" args={["#1b2233", 20, 46]} />
      <hemisphereLight args={["#c9d3ff", "#4a3b30", 0.7]} />
      <directionalLight position={[-6, 12, 16]} intensity={0.7} color="#cfd8ff" castShadow
        shadow-mapSize={[1024, 1024]} shadow-camera-left={-14} shadow-camera-right={14} shadow-camera-top={14} shadow-camera-bottom={-6} />
      <pointLight position={[-ROOM_X, 2.7, 1]} color="#ffc58a" intensity={26} distance={13} decay={2} />
      <pointLight position={[ROOM_X, 2.8, 1]} color="#e6f0ff" intensity={26} distance={13} decay={2} />
      <pointLight position={[0, 2.8, -6]} color="#fff1dc" intensity={12} distance={12} decay={2} />
      <pointLight position={[0, 2.8, -12]} color="#fff5e8" intensity={18} distance={10} decay={2} />
      <pointLight position={[0, 3.6, 10.5]} color="#ffd8a8" intensity={18} distance={16} decay={2} />

      <Lobby />
      <CoffeeShop />
      <MeetingRoom />
      <Corridor type={type} doorOpen={pmOn} reduced={reduced} />
      <ProductRoom />

      {(["greenfield", "brownfield"] as const).map((t) => {
        const here = type === t;
        const speakKey = speaking?.who === "host" && here ? speaking.key : null;
        return (
          <group key={t} position={agentSpot(t) as [number, number, number]}>
            {/* The business agent greets in both rooms: a wave on arrival, talking while he says his line, then listening.
                Once a room is chosen, only that room's business agent stays. */}
            {(type === null || here) && <RealPerson id="phillip" tier="close" reduced={reduced} seed={t === "greenfield" ? 1 : 2}
              waveKey={inRoom && here ? `greet:${t}` : null} speakKey={speakKey} speakSeconds={speaking?.seconds}
              listening={here && LISTENING.has(phase)}
              fallback={<Person3D look={LOOK[t]} wave={inRoom && here} reduced={reduced} speakKey={speakKey} speakSeconds={speaking?.seconds} />} />}
            {here && phase !== "choose" && <CharacterLights keyColor={t === "greenfield" ? "#ffdcb4" : "#eef2ff"} />}
          </group>
        );
      })}
      {/* the business analyst waits in the product team's room; in step 2 walks over to the team's board */}
      <Walker from={PM_SPOT} path={RAJIV_WALK.path} face={RAJIV_WALK.face} go={onward} reduced={reduced} body={rajiv}>
        {(activity) => (
          <>
            <RealPerson id="rajiv" tier="close" reduced={reduced} seed={3} waveKey={pmOn ? "greet:pm" : null} activity={activity}
              speakKey={pmSpeaking} speakSeconds={speaking?.seconds} listening={phase === "team" && !pmSpeaking}
              fallback={<Person3D look={LOOK.pm} wave={pmOn} reduced={reduced} speakKey={pmSpeaking} speakSeconds={speaking?.seconds} />} />
            {(pmOn || phase === "door") && <CharacterLights keyColor="#fff0de" />}
          </>
        )}
      </Walker>

      <Hotspot p={[-ROOM_X, 1.2, 6.12]} s={[1.4, 2.4, 0.12]} active={choosing} highlight={hoverType === "greenfield"}
        onHover={(on) => onHoverType(on ? "greenfield" : null)} onClick={() => onChoose("greenfield")} />
      <Hotspot p={[ROOM_X, 1.2, 6.12]} s={[1.4, 2.4, 0.12]} active={choosing} highlight={hoverType === "brownfield"}
        onHover={(on) => onHoverType(on ? "brownfield" : null)} onClick={() => onChoose("brownfield")} />
      <Hotspot p={[0, 1.15, -7.86]} s={[1.2, 2.3, 0.1]} active={phase === "door" && doorReady} pulse onClick={onKnock} />

      <Rig path={path} pathKey={pathKey} reduced={reduced} onArrive={onArrive} follow={onward ? rajiv : null} />
    </>
  );
}

/** The canvas. Drops the resolution, then the shadows, when the device cannot hold the frame rate. */
export default function CinematicWorld(props: WorldProps) {
  const [low, setLow] = useState(false);
  return (
    <Canvas shadows={!low} dpr={low ? 1 : [1, 1.75]} gl={{ antialias: !low, powerPreference: "high-performance" }}
      camera={{ fov: 55, near: 0.05, far: 80, position: LOBBY.at as [number, number, number] }} aria-hidden>
      <PerformanceMonitor onDecline={() => setLow(true)} flipflops={2} />
      <AdaptiveDpr pixelated={false} />
      <Scene {...props} />
    </Canvas>
  );
}
