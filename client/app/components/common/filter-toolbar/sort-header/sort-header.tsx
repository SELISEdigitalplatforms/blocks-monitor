import { cn } from "@/lib/utils";
import { RenderConditionally } from "@seliseblocks/blocks-kit/components";
import { ArrowDown, ArrowUp } from "lucide-react";
import { MouseEvent } from "react";
import type { SortValue } from "./sort-header.types";

type SortHeaderProps = {
  id: string;
  label: string;
  value: SortValue;
  onChange: (params: SortValue) => void;
  defaultValue?: SortValue;
  isSortingEnabled?: boolean;
  className?: string;
};

export const SortHeader = ({
  label,
  id,
  value,
  onChange,
  defaultValue,
  isSortingEnabled = true,
  className,
}: SortHeaderProps) => {
  const currentValue = value ||
    defaultValue || { property: "", isDescending: false };
  const Icon = currentValue.isDescending ? ArrowDown : ArrowUp;

  const onClickHandler = (e: MouseEvent) => {
    e.stopPropagation();
    onChange({
      property: id,
      isDescending:
        id !== currentValue.property ? false : !currentValue.isDescending,
    });
  };

  const isActive = id === currentValue.property;

  return (
    <div
      className={cn("flex cursor-pointer items-center gap-2", className)}
      onClick={onClickHandler}>
      <span className="font-bold text-medium-emphasis">{label}</span>
      <RenderConditionally condition={isSortingEnabled && isActive}>
        <Icon
          className={`h-4 w-4 ${isActive ? "text-high-emphasis" : "text-low-emphasis opacity-50"}`}
        />
      </RenderConditionally>
    </div>
  );
};
