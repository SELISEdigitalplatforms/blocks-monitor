/** Interactive objects in the office (screens, the file tray, the GitHub terminal, the launch doors). A hotspot is
 *  live only while the current question is one it answers: then it shows a soft beacon, a hover outline and a pointer
 *  cursor, and a click answers the question (in story mode the story's own answer), so the chat is not the only control. */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Outlines } from "@react-three/drei";
import { SphereGeometry, type BufferGeometry, type Group, type Material } from "three";
import { useJourney } from "../journey/store";
import { M } from "./materials";

const beaconGeo = new SphereGeometry(0.035, 16, 12);

/** in the real office a place answers only what is the person's own pick (never typed words) */
const REAL_ANSWERS = new Set(["files", "github", "launch"]);

export function useHotspotLive(answers: string[]): boolean {
  return useJourney((s) => s.phase === "journey" && s.walk === null && s.ask !== null && s.askId !== null && answers.includes(s.askId)
    && (s.mode === "story" || REAL_ANSWERS.has(s.askId)));
}

export function Hotspot({
  answers, geometry, material, position, scale, rotation, beacon = [0, 0.6, 0], children,
}: {
  answers: string[];
  geometry: BufferGeometry;
  material: Material;
  position: [number, number, number];
  scale: [number, number, number];
  rotation?: [number, number, number];
  beacon?: [number, number, number] | null;
  children?: ReactNode;
}) {
  const live = useHotspotLive(answers);
  const [hover, setHover] = useState(false);
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const ring = useRef<Group>(null);

  useEffect(() => {
    gl.domElement.style.cursor = live && hover ? "pointer" : "";
    invalidate();
  }, [live, hover, gl, invalidate]);
  useEffect(() => () => { gl.domElement.style.cursor = ""; }, [gl]);

  useFrame((st) => {
    const r = ring.current;
    if (!r) return;
    const t = st.clock.elapsedTime;
    r.position.y = beacon ? beacon[1] + Math.sin(t * 2) * 0.02 : 0;
    r.scale.setScalar(1 + Math.sin(t * 3.2) * 0.18);
  });

  const click = () => {
    if (!live) return;
    setHover(false);
    useJourney.getState().hotspot();
  };

  return (
    <group position={position} rotation={rotation}>
      <mesh
        geometry={geometry}
        material={material}
        scale={scale}
        onPointerOver={(e) => { e.stopPropagation(); setHover(true); }}
        onPointerOut={() => setHover(false)}
        onClick={(e) => { e.stopPropagation(); click(); }}
      >
        {live && hover && <Outlines screenspace thickness={3.5} color="#1F5BFF" toneMapped={false} />}
      </mesh>
      {children}
      {live && beacon && (
        <group ref={ring} position={beacon}>
          <mesh geometry={beaconGeo} material={M.glowBlue} />
        </group>
      )}
    </group>
  );
}
