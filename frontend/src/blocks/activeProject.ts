/**
 * Active Project Context: stores which Blocks project (tenant) the user is working in.
 * All BFF API calls include this tenant ID so the BFF routes data/fn/release to the correct tenant.
 *
 * Stored in sessionStorage so it persists across page reloads.
 */

const ACTIVE_PROJECT_KEY = "madp-active-blocks-project-v1";

export interface ActiveBlocksProject {
  tenantGroupId: string;
  tenantId: string;
  name: string;
  domain?: string;
}

export function setActiveProject(project: ActiveBlocksProject): void {
  sessionStorage.setItem(ACTIVE_PROJECT_KEY, JSON.stringify(project));
}

export function getActiveProject(): ActiveBlocksProject | null {
  try {
    const raw = sessionStorage.getItem(ACTIVE_PROJECT_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as ActiveBlocksProject;
    return data.tenantGroupId ? data : null;
  } catch { return null; }
}

export function clearActiveProject(): void {
  sessionStorage.removeItem(ACTIVE_PROJECT_KEY);
}

/** The active project's tenant ID for x-blocks-key headers. */
export function getActiveProjectTenant(): string | null {
  return getActiveProject()?.tenantId || null;
}
