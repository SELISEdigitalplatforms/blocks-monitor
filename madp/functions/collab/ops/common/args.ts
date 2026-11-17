import { v } from "../../../_lib";

type Shape = Parameters<typeof v.object>[0];

/** Every project-scoped op takes projectId first. */
export function projectArgs<S extends Shape>(shape: S) {
  return v.object({ projectId: v.id(), ...shape });
}
