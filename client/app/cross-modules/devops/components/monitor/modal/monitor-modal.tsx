import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui-kits/dialog/dialog";
import { DialogProps } from "@radix-ui/react-dialog";
import { PropsWithChildren } from "react";

type Props = PropsWithChildren<
  DialogProps & {
    itemId: string | null;
  }
>;

export function MonitorModal({ itemId, open, onOpenChange, children }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="md:max-w-screen-sm">
        <DialogHeader>
          <DialogTitle>{itemId ? "Configure" : "Add monitor"}</DialogTitle>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}
