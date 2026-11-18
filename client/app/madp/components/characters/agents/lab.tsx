/** /src/components/characters/agents/lab.html — a small test room for the two guides (T2's bench; not part of the journey). */
import { Canvas, useThree } from "@react-three/fiber";
import { ContactShadows, OrbitControls } from "@react-three/drei";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Agent, GuideLights, type AgentProps } from "./index";
import { RealPerson } from "../RealPerson";
import { overrideAgentModel } from "./registry";

type V3 = [number, number, number];
const q = new URLSearchParams(location.search);
if (q.get("a")) overrideAgentModel("assistant", `${q.get("a")}.close.glb`);
if (q.get("p")) overrideAgentModel("pm", `${q.get("p")}.close.glb`);
const v3 = (k: string): V3 | null => { const v = q.get(k)?.split(",").map(Number); return v?.length === 3 && v.every(Number.isFinite) ? (v as V3) : null; };
const CAM: V3 = v3("cam") ?? (q.get("close") === "6" ? [0.85, 1.65, -0.25] : q.get("close") === "5" ? [-0.55, 0.98, 0.5] : q.get("close") === "4" ? [0.75, 1.2, 1.1] : q.get("close") === "3" ? [0.4, 1.2, 2.6] : q.get("close") === "2" ? [0.06, 1.68, 0.42] : q.get("close") ? [0.25, 1.62, 1.1] : [0.6, 1.6, 5.2]);
const TARGET: V3 = v3("target") ?? (q.get("close") === "6" ? [0, 1.5, 0] : q.get("close") === "5" ? [-0.22, 0.9, 0.02] : q.get("close") === "4" ? [0.15, 1.15, 0] : q.get("close") === "3" ? [0.05, 1.0, 0] : q.get("close") === "2" ? [0.0, 1.67, 0] : q.get("close") ? [0.02, 1.6, 0] : [0, 1.1, 0]);

function Stats() {
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    let n = 0, t0 = performance.now(), raf = 0;
    const tick = () => {
      n++;
      const t = performance.now();
      if (t - t0 > 1000) { (window as unknown as { __fps: number }).__fps = (n * 1000) / (t - t0); (window as unknown as { __calls: number }).__calls = gl.info.render.calls; n = 0; t0 = t; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [gl]);
  return null;
}

function Lab() {
  const [speaking, setSpeaking] = useState<"assistant" | "pm" | null>(q.get("speak") === "pm" ? "pm" : q.get("speak") ? "assistant" : null);
  const [walkA, setWalkA] = useState<V3 | null>(null);
  const [posA, setPosA] = useState<V3>(q.get("close") ? [0, 0, 0] : [-0.6, 0, 0]);
  const before = Boolean(q.get("before"));
  const [arrived, setArrived] = useState(0);
  const cam = CAM;
  const common = (role: AgentProps["role"]): Partial<AgentProps> => ({ speaking: speaking === role, speech: "Welcome to MADP Factory. What are we building today? Give it a name, and we will take it from there.", lookAt: [cam[0], cam[1], cam[2]] });
  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__speak = (r: "assistant" | "pm" | null) => setSpeaking(r);
    w.__walk = (x: number, z: number) => setWalkA([x, 0, z]);
    w.__snap = (x: number, z: number) => setPosA([x, 0, z]);
  }, []);
  return (
    <>
      <Canvas dpr={[1, 1.5]} shadows={false} camera={{ position: cam, fov: q.get("close") ? 30 : 40 }} gl={{ antialias: true }}>
        <color attach="background" args={["#eef0f3"]} />
        <hemisphereLight args={["#ffffff", "#d8dce4", 1.1]} />
        <directionalLight position={[3, 5, 4]} intensity={1.6} />
        <directionalLight position={[-4, 3, -2]} intensity={0.5} />
        <mesh rotation-x={-Math.PI / 2}><planeGeometry args={[30, 30]} /><meshStandardMaterial color="#e4e7ec" /></mesh>
        <ContactShadows position={[0, 0.005, 0]} opacity={0.35} scale={12} blur={2.4} far={2} resolution={512} frames={Infinity} />
        {before ? (
          <>
            <group position={posA} rotation-y={0.15}><RealPerson id={q.get("who") === "pm" ? "rajiv" : "phillip"} tier="close" deferred={false} speakKey={speaking === "assistant" ? "a" : null} speakSeconds={8} /></group>
            {!q.get("solo") && <group position={[0.7, 0, -0.2]} rotation-y={-0.2}><RealPerson id="rajiv" tier="close" deferred={false} seed={3} /></group>}
          </>
        ) : (
          <>
            <Agent role={q.get("who") === "pm" ? "pm" : "assistant"} position={posA} rotation={0.15} walkingTo={walkA} onArrive={() => setArrived((n) => n + 1)} {...common("assistant")} />
            {!q.get("solo") && <Agent role="pm" position={[0.7, 0, -0.2]} rotation={-0.2} {...common("pm")} />}
          </>
        )}
        {!before && <GuideLights position={[0, 0, 0]} />}
        <OrbitControls target={TARGET} />
        <Stats />
      </Canvas>
      {!q.get("rec") && (
        <div style={{ position: "fixed", left: 12, top: 12, display: "flex", gap: 8, fontSize: 13 }}>
          <button onClick={() => setSpeaking(speaking === "assistant" ? null : "assistant")}>Assistant speaks</button>
          <button onClick={() => setSpeaking(speaking === "pm" ? null : "pm")}>BA speaks</button>
          <button onClick={() => setWalkA(walkA && walkA[0] > 0 ? [-2.5, 0, 1.5] : [2.5, 0, -1.5])}>Assistant walks</button>
          <span id="arrived">arrived {arrived}</span>
        </div>
      )}
    </>
  );
}

for (const el of [document.documentElement, document.body, document.getElementById("root")!]) Object.assign(el.style, { margin: "0", height: "100%", background: "#eef0f3" });
createRoot(document.getElementById("root")!).render(<StrictMode><Lab /></StrictMode>);
