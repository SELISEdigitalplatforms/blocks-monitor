/**
 * The cast's lighting recipe, the same in every scene: a soft warm key from the viewer's side and above, a cool rim
 * from behind that separates the person from the room, and (in loader.ts) a gentle studio reflection on their
 * materials. Place it inside the person's group (feet at 0, facing +z). Point lights without shadows: cheap; mount it
 * only for the people in view.
 */

export interface CharacterLightsProps {
  /** person height in the group's units (default 1.8) */
  height?: number;
  /** overall strength (1 = the recipe) */
  intensity?: number;
  /** key light colour (the room's mood: warm in a café, neutral in a meeting room) */
  keyColor?: string;
}

export function CharacterLights({ height = 1.8, intensity = 1, keyColor = "#ffe8d2" }: CharacterLightsProps) {
  const h = height;
  return (
    <group>
      {/* key: front, to the side, above eye level */}
      <pointLight position={[0.9 * h / 1.8, h * 1.25, 1.5 * h / 1.8]} color={keyColor} intensity={4.2 * intensity} distance={4.5} decay={2} />
      {/* rim: behind, opposite side, high */}
      <pointLight position={[-0.7 * h / 1.8, h * 1.2, -0.9 * h / 1.8]} color="#cfe0ff" intensity={3.2 * intensity} distance={3.5} decay={2} />
    </group>
  );
}
