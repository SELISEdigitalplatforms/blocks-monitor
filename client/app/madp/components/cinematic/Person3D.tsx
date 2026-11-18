/** A stylised person built in code (no downloads, no WebAssembly): about 1.75 m tall, facing +z. Breathes, blinks,
 *  turns its head towards the visitor, waves once when `wave` turns on, and moves its mouth and hands while it speaks.
 *  The app's CSP has no 'wasm-unsafe-eval', so the meshopt-compressed GLB people of the Studio office cannot decode here;
 *  see docs/cinematic/PLAN.md for the realistic-character options. */

import { useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { Vector3, type Group, type Mesh } from "three";

export interface PersonLook { skin: string; hair: string; top: string; legs: string; shoes: string; hairStyle: "short" | "bob" | "long"; collar?: string }

const v = new Vector3();

function Limb({ r, len, c, y }: { r: number; len: number; c: string; y: number }) {
  return (
    <mesh position={[0, y, 0]} castShadow>
      <capsuleGeometry args={[r, len, 4, 10]} />
      <meshStandardMaterial color={c} roughness={0.85} />
    </mesh>
  );
}

export function Person3D({ look, wave, speakKey, speakSeconds = 0, reduced }: {
  look: PersonLook; wave: boolean; speakKey: string | null; speakSeconds?: number; reduced: boolean;
}) {
  const torso = useRef<Group>(null);
  const head = useRef<Group>(null);
  const armR = useRef<Group>(null);
  const armL = useRef<Group>(null);
  const mouth = useRef<Mesh>(null);
  const eyes = useRef<Group>(null);
  const live = useRef({ waveT: -1, speakT: 0, blinkIn: 2.5, blinkT: 0 });

  useEffect(() => { if (wave) live.current.waveT = 0; }, [wave]);
  useEffect(() => { live.current.speakT = speakKey ? speakSeconds : 0; }, [speakKey, speakSeconds]);

  useFrame(({ clock, camera }, raw) => {
    const L = live.current;
    const dt = Math.min(raw, 0.05);
    const t = clock.elapsedTime;
    if (!torso.current || !head.current || !armR.current || !armL.current) return;
    // head towards the visitor, within a natural range
    if (head.current.parent) {
      head.current.parent.worldToLocal(v.copy(camera.position));
      const yaw = Math.max(-0.6, Math.min(0.6, Math.atan2(v.x, v.z)));
      head.current.rotation.y += (yaw - head.current.rotation.y) * (reduced ? 1 : 1 - Math.exp(-dt * 4));
    }
    if (reduced) return;
    torso.current.scale.set(1, 1 + Math.sin(t * 1.6) * 0.012, 1);
    torso.current.rotation.z = Math.sin(t * 0.5) * 0.015;
    // blink
    L.blinkIn -= dt;
    if (L.blinkIn <= 0) { L.blinkT = 0.14; L.blinkIn = 2.5 + (Math.sin(t * 7.3) + 1) * 1.5; }
    if (L.blinkT > 0) L.blinkT -= dt;
    if (eyes.current) eyes.current.scale.y = L.blinkT > 0 ? 0.15 : 1;
    // wave with the right arm
    let rz = 0.12;
    let lz = -0.12;
    let lx = 0;
    if (L.waveT >= 0) {
      L.waveT += dt;
      const k = Math.min(1, L.waveT / 0.35) * Math.min(1, Math.max(0, (2.4 - L.waveT) / 0.35));
      rz = 0.12 + k * (2.5 + Math.sin(L.waveT * 9) * 0.3 - 0.12);
      if (L.waveT > 2.4) L.waveT = -1;
    }
    // speaking: the mouth moves, the left hand gestures, a small nod
    if (L.speakT > 0) {
      L.speakT -= dt;
      if (mouth.current) mouth.current.scale.y = 1 + Math.abs(Math.sin(t * 13)) * 2.2;
      lx = -0.5 - Math.sin(t * 2.2) * 0.25;
      lz = -0.25;
      head.current.rotation.x = Math.sin(t * 3.1) * 0.05;
    } else {
      if (mouth.current) mouth.current.scale.y = 1;
      head.current.rotation.x *= 0.9;
    }
    armR.current.rotation.z += (rz - armR.current.rotation.z) * (1 - Math.exp(-dt * 10));
    armL.current.rotation.z += (lz - armL.current.rotation.z) * (1 - Math.exp(-dt * 6));
    armL.current.rotation.x += (lx - armL.current.rotation.x) * (1 - Math.exp(-dt * 6));
  });

  const { skin, hair, top, legs, shoes, hairStyle, collar } = look;
  return (
    <group>
      {/* feet and legs */}
      {[-0.1, 0.1].map((x) => (
        <group key={x} position={[x, 0, 0]}>
          <mesh position={[0, 0.045, 0.04]} castShadow>
            <boxGeometry args={[0.11, 0.09, 0.26]} />
            <meshStandardMaterial color={shoes} roughness={0.5} />
          </mesh>
          <Limb r={0.068} len={0.68} c={legs} y={0.47} />
        </group>
      ))}
      <mesh position={[0, 0.9, 0]} castShadow scale={[1, 0.7, 0.75]}>
        <sphereGeometry args={[0.18, 14, 10]} />
        <meshStandardMaterial color={legs} roughness={0.85} />
      </mesh>
      {/* torso, arms, neck, head */}
      <group ref={torso} position={[0, 0.92, 0]}>
        <mesh position={[0, 0.3, 0]} castShadow scale={[1, 1, 0.68]}>
          <capsuleGeometry args={[0.19, 0.34, 4, 14]} />
          <meshStandardMaterial color={top} roughness={0.8} />
        </mesh>
        {collar && (
          <mesh position={[0, 0.53, 0.07]} rotation={[0.35, 0, 0]}>
            <coneGeometry args={[0.07, 0.14, 3]} />
            <meshStandardMaterial color={collar} roughness={0.6} />
          </mesh>
        )}
        {([[armR, -1], [armL, 1]] as const).map(([ref, s]) => (
          <group key={s} ref={ref} position={[s * -0.235, 0.5, 0]}>
            <Limb r={0.052} len={0.5} c={top} y={-0.28} />
            <mesh position={[0, -0.6, 0]} castShadow>
              <sphereGeometry args={[0.052, 10, 8]} />
              <meshStandardMaterial color={skin} roughness={0.7} />
            </mesh>
          </group>
        ))}
        <mesh position={[0, 0.6, 0]}>
          <cylinderGeometry args={[0.05, 0.055, 0.1, 10]} />
          <meshStandardMaterial color={skin} roughness={0.7} />
        </mesh>
        <group ref={head} position={[0, 0.72, 0]}>
          <mesh castShadow scale={[0.92, 1.12, 1]}>
            <sphereGeometry args={[0.115, 20, 16]} />
            <meshStandardMaterial color={skin} roughness={0.65} />
          </mesh>
          <group ref={eyes} position={[0, 0.02, 0.1]}>
            {[-0.04, 0.04].map((x) => (
              <mesh key={x} position={[x, 0, 0]}>
                <sphereGeometry args={[0.013, 8, 6]} />
                <meshStandardMaterial color="#141218" roughness={0.3} />
              </mesh>
            ))}
          </group>
          <mesh ref={mouth} position={[0, -0.05, 0.108]}>
            <boxGeometry args={[0.032, 0.006, 0.01]} />
            <meshStandardMaterial color="#4a2420" />
          </mesh>
          {/* hair: a cap, plus the length of the style */}
          <mesh position={[0, 0.035, -0.012]} rotation={[-0.45, 0, 0]} scale={[0.98, 1.1, 1.04]}>
            <sphereGeometry args={[0.124, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.6]} />
            <meshStandardMaterial color={hair} roughness={0.9} />
          </mesh>
          {hairStyle !== "short" && (
            <mesh position={[0, hairStyle === "long" ? -0.1 : -0.03, -0.06]} castShadow>
              <boxGeometry args={[0.24, hairStyle === "long" ? 0.3 : 0.16, 0.12]} />
              <meshStandardMaterial color={hair} roughness={0.9} />
            </mesh>
          )}
        </group>
      </group>
    </group>
  );
}
