/** A guide's small real portrait (captured from the 3D character); calm initials until the capture is in. */
import { cn } from "@/lib/cn";
import { usePortraits } from "../journey/portraits";
import { t } from "@/i18n";

export function GuideAvatar({ who, size = 36, ring }: { who: "assistant" | "pm"; size?: number; ring?: "listening" | "thinking" | "speaking" | null }) {
  const url = usePortraits((s) => s[who]);
  return (
    <span className={cn("cine-avatar relative inline-grid shrink-0 place-items-center rounded-full", ring && `cine-ring-${ring}`)} style={{ width: size, height: size }}>
      {url ? (
        <img src={url} alt="" className="h-full w-full rounded-full object-cover" draggable={false} />
      ) : (
        <span className="grid h-full w-full place-items-center rounded-full bg-gradient-to-br from-[#2b3140] to-[#4a5368] text-[11px] font-semibold text-white">
          {who === "assistant" ? "MA" : "BA"}
        </span>
      )}
    </span>
  );
}

/** The guides' names as shown (read at render time). */
export const GUIDE_NAME: { readonly assistant: string; readonly pm: string } = {
  get assistant() { return t("studio.cinematic.guides.assistant", "MADP Assistant"); },
  get pm() { return t("studio.cinematic.hosts.businessAnalyst", "Business analyst"); },
};
