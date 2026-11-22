/** The landing hero's 3D stage: loads the chosen concept scene (lazily, one chunk each). */
import { lazy, type ComponentType } from "react";
import type { ConceptId, ConceptSceneProps } from "./types";

const SCENES: Record<ConceptId, ComponentType<ConceptSceneProps>> = {
  story: lazy(() => import("./story/StoryScene")),
  foundry: lazy(() => import("./foundry/FoundryScene")),
  blueprint: lazy(() => import("./blueprint/BlueprintScene")),
  // the original light line; it also takes the canvas colour under its older prop name
  line: lazy(() => import("@/components/landing/HeroScene").then((m) => {
    const Line = m.default as unknown as ComponentType<ConceptSceneProps & { stage: string }>;
    return { default: (p: ConceptSceneProps) => <Line {...p} stage={p.canvas} /> };
  })),
};

export function ConceptScene({ concept, ...props }: ConceptSceneProps & { concept: ConceptId }) {
  const Scene = SCENES[concept];
  return <Scene key={concept} {...props} />;
}
