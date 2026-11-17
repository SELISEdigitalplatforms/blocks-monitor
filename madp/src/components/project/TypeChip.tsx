/** The project type as a chip: greenfield (new product) or brownfield (existing product). */
import { Building2, RefreshCw, Sprout } from "lucide-react";
import { Chip } from "@/ui/kit";
import { type ProjectType } from "@/domain/projectType";
import { useT } from "@/i18n";
import { typeName } from "@/components/project/stepNames";

export const TYPE_ICON = { greenfield: Sprout, brownfield: Building2, greyfield: RefreshCw } as const;
const TONE = { greenfield: "success", brownfield: "warning", greyfield: "neutral" } as const;

/** A missing type is greenfield, as for a stored project without RepoMode. */
export function TypeChip({ type = "greenfield", className }: { type?: ProjectType; className?: string }) {
  const t = useT();
  const Icon = TYPE_ICON[type];
  return (
    <Chip tone={TONE[type]} className={className} icon={<Icon size={12} strokeWidth={1.75} aria-hidden />}
      title={type === "brownfield" ? t("project.type.brownfieldHint", "Existing product: MADP changes it in its own repository") : type === "greenfield" ? t("project.type.greenfieldHint", "New product: MADP builds it from scratch") : undefined}>
      {typeName(type)}
    </Chip>
  );
}
