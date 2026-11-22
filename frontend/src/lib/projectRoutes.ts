import type { ProjectStatus } from "@/data/types";

export type ProjectPage = "business" | "sanitization" | "brief" | "requirements" | "objective" | "scope" | "build" | "delivered";

/** A project's page, by project id. */
export const projectRoute = (id: string, page: ProjectPage): string => `/p/${id}/${page}`;

export interface NextStep { label: string; to: string }

/** The one thing to do next, and the page it opens. A build that is not moving (paused) is carried on from the
 *  build screen. The project id is required. */
export function nextStep(s: ProjectStatus, held: boolean, id: string, sanitizing = false): NextStep {
  switch (s) {
    case "intake": return { label: "Add the business input", to: projectRoute(id, "business") };
    case "understanding":
      if (sanitizing) return { label: "Continue understanding the project", to: projectRoute(id, "sanitization") };
      return { label: "Check the requirements", to: projectRoute(id, "requirements") };
    case "objective": return { label: "Confirm the objective", to: `${projectRoute(id, "requirements")}?tab=objective` };
    case "building": return { label: held ? "Open the build" : "Watch the build", to: projectRoute(id, "build") };
    case "live": case "delivered": return { label: "See it live", to: projectRoute(id, "delivered") };
    case "abandoned": case "rejected": return { label: "See the project", to: projectRoute(id, "scope") };
    default: return { label: "Open the scope", to: projectRoute(id, "scope") };
  }
}
