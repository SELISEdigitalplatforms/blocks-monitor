/**
 * Soft light for the guides, so faces read warm and alive instead of flat and grey: a warm key from the viewer's side
 * and above, a cool low fill from the other side, and a rim from behind that separates them from the room. Point lights
 * without shadows (cheap). Mount one per room, centred between the guides (feet level, facing +z); together with the
 * studio reflection on their materials and the canvas's tone mapping (R3F default: ACES Filmic, sRGB output).
 */
export interface GuideLightsProps {
  position?: [number, number, number];
  /** overall strength (1 = the recipe) */
  intensity?: number;
  keyColor?: string;
}

export function GuideLights({ position = [0, 0, 0], intensity = 1, keyColor = "#ffe9d6" }: GuideLightsProps) {
  const k = intensity;
  return (
    <group position={position}>
      <pointLight position={[1.4, 2.4, 2.4]} color={keyColor} intensity={5 * k} distance={7} decay={2} />
      <pointLight position={[-2.2, 1.5, 1.8]} color="#e4ecff" intensity={2.6 * k} distance={6} decay={2} />
      <pointLight position={[-0.8, 2.3, -1.6]} color="#d6e4ff" intensity={4.5 * k} distance={5} decay={2} />
    </group>
  );
}
