import { cn } from "@/lib/cn";
import { viewerTip } from "@/data/rbac";
import { useT } from "@/i18n";
import { useWorkspaces } from "@/blocks/workspaces/store";

export function ViewOnlyNote({
  id,
  text,
  className,
}: {
  id: string;
  text?: string;
  className?: string;
}) {
  useT();
  const ready = useWorkspaces((s) => s.ready);
  if (!ready) return null;
  return (
    <p id={id} className={cn("mt-1.5 text-[12px] text-ink3", className)}>
      {text ?? viewerTip()}
    </p>
  );
}
