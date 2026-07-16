import type { ReactNode } from "react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

// Lightweight stand-ins for the two utilities the app imports from
// `@seliseblocks/blocks-kit/components`. The real subpath transitively bundles
// a nested framer-motion build whose module-load reads process.env.NODE_ENV in
// a way jsdom can't satisfy; the app only needs these small helpers.

export function RenderConditionally({
  condition,
  children,
}: {
  condition: boolean;
  children: ReactNode;
}) {
  return condition ? <>{children}</> : null;
}

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
