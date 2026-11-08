import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/core";
import { useT } from "@seliseblocks/genesis-os/i18n";

type BackIconButtonProps = {
  onClick: () => void;
  icon?: React.ReactNode;
  className?: string;
};

export function BackIconButton({
  icon = <ChevronLeft size={20} />,
  onClick,
  className,
}: BackIconButtonProps) {
  const { t } = useT("monitor.shared");
  return (
    <Button
      aria-label={t("BACK_BUTTONS.GO_BACK")}
      variant={"ghost"}
      size={"icon"}
      onClick={onClick}
      className={className}
    >
      {icon}
    </Button>
  );
}
