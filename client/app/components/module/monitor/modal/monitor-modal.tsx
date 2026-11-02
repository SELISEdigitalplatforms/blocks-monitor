import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle } from "@/components/core";
import { X } from "lucide-react";
import { DialogProps } from "@radix-ui/react-dialog";
import { PropsWithChildren } from "react";
import { useT } from "@seliseblocks/genesis-os/i18n";

type Props = PropsWithChildren<
  DialogProps & {
    itemId: string | null;
  }
>;

export function MonitorModal({ itemId, open, onOpenChange, children }: Props) {
  const { t } = useT("monitor.monitors");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="md:max-w-(--breakpoint-sm)" hideCloseButton>
        <DialogHeader className="relative pr-8">
          <DialogTitle>
            {itemId ? t("MONITOR_MODAL.CONFIGURE") : t("MONITOR_MODAL.ADD_MONITOR")}
          </DialogTitle>
          <DialogClose
            type="button"
            onClick={() => onOpenChange?.(false)}
            className="absolute right-0 top-0 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-hidden focus:ring-2 focus:ring-ring focus:ring-offset-2"
          >
            <X className="h-4 w-4" />
            <span className="sr-only">{t("common:CLOSE")}</span>
          </DialogClose>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}
