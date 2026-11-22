import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/blocks/queryClient";

/** One saved screen of a Figma design revision: its picture (PNG, base64) and size. */
export interface ScreenExport { name: string; nodeId: string; requirementKeys: string[]; png: string; width: number; height: number }

const PNG_BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** The saved screen exports of one design revision, checked the same way for the tiles and the viewer.
 *  The preview URL names the revision, so a loaded result never goes stale. */
function designScreensQuery(previewUrl: string) {
  return {
    queryKey: ["design-screens", previewUrl] as const,
    staleTime: Infinity,
    gcTime: 10 * 60_000,
    retry: 1,
    queryFn: async ({ signal }: { signal?: AbortSignal }): Promise<ScreenExport[]> => {
      const r = await fetch(`${previewUrl}/screens`, { credentials: "same-origin", signal });
      if (!r.ok) throw new Error("unavailable");
      const data = await r.json();
      if (!Array.isArray(data.screens) || !data.screens.length || data.screens.length > 80 || !data.screens.every((s: ScreenExport) =>
        typeof s.name === "string" && typeof s.nodeId === "string" && typeof s.png === "string" && PNG_BASE64.test(s.png) && s.width > 0 && s.width <= 20000 && s.height > 0 && s.height <= 100000)) throw new Error("invalid");
      return data.screens as ScreenExport[];
    },
  };
}

/** The screens for the design viewer; reuses what the tiles already loaded. */
export function loadDesignScreens(previewUrl: string): Promise<ScreenExport[]> {
  return queryClient.fetchQuery(designScreensQuery(previewUrl));
}

/** The screen pictures of a Figma design revision by screen id (empty until they are loaded or when none exist). */
export function useScreenImages(previewUrl: string | null | undefined): Readonly<Record<string, string>> {
  const q = useQuery({ ...designScreensQuery(previewUrl ?? ""), enabled: !!previewUrl });
  const images: Record<string, string> = {};
  for (const s of q.data ?? []) images[s.nodeId] = s.png;
  return images;
}
