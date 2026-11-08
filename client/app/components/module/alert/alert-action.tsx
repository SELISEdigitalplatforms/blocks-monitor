import { EllipsisVertical } from "lucide-react";
import { useState, type ReactNode } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/core";
import { Button } from "@/components/core";
import {
  useDeleteHealth,
  useDeleteMonitor,
  useUpdateHealth,
  useUpdateSingleMonitor,
} from "@/hooks/use-alerts";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/core";
import { useNavigate } from "react-router";
import { toast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { useT } from "@seliseblocks/genesis-os/i18n";

const MONITOR_ALERTS_MODULE = "monitor.alerts";

type AlertActionProps = {
  monitorId: string;
  isActive: boolean;
  name: string;
  request: boolean;
  projectKey: string;
  goBack?: boolean;
  monitorSourceType?: number;
  children?: ReactNode;
};

const AlertAction = ({
  monitorId,
  isActive,
  goBack,
  name,
  request,
  projectKey,
  monitorSourceType,
  children = <EllipsisVertical className="h-5 w-5" />,
}: AlertActionProps) => {
  const { t } = useT(MONITOR_ALERTS_MODULE);
  const [isUpdateDialogOpen, setIsUpdateDialogOpen] = useState<boolean>(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState<boolean>(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
        <DropdownMenuContent align="center" className="flex pointer-events-auto gap-2 flex-col">
          <DropdownMenuItem
            className="gap-2 cursor-pointer"
            onClick={(e) => {
              e.stopPropagation();
              setIsUpdateDialogOpen(true);
            }}
          >
            <span>{isActive ? t("ALERT_ACTION.PAUSE") : t("ALERT_ACTION.RESUME")}</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            className="gap-2 cursor-pointer text-destructive"
            onClick={(e) => {
              e.stopPropagation();
              setIsDeleteDialogOpen(true);
            }}
          >
            <span>{t("common:DELETE")}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {isUpdateDialogOpen && (
        <UpdateMonitorDialog
          monitorId={monitorId}
          isActive={isActive}
          isOpen={isUpdateDialogOpen}
          onOpenChange={setIsUpdateDialogOpen}
          name={name}
          request={request}
          projectKey={projectKey}
          monitorSourceType={monitorSourceType}
        />
      )}

      {isDeleteDialogOpen && (
        <DeleteMonitorDialog
          monitorId={monitorId}
          isOpen={isDeleteDialogOpen}
          onOpenChange={setIsDeleteDialogOpen}
          goBack={goBack}
          request={request}
        />
      )}
    </>
  );
};

export default AlertAction;

/**
 * The server's reason for a refusal, else `fallback`. A 403 (a Blocks-managed monitor) arrives as an
 * HttpError whose `errors` is the response body; a 200 refusal arrives as the body itself. Any other
 * thrown Error (network, parsing) keeps the fallback rather than showing its raw text.
 */
const refusalMessage = (source: unknown, fallback: string): string => {
  const value = source as
    { message?: unknown; errors?: { message?: unknown } | null } | null | undefined;
  const message = value?.errors?.message ?? (source instanceof Error ? undefined : value?.message);
  return typeof message === "string" && message.trim() ? message : fallback;
};

type UpdateMonitorDialogProps = {
  monitorId: string;
  isActive: boolean;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  request: boolean;
  projectKey: string;
  monitorSourceType?: number;
};

const UpdateMonitorDialog = ({
  monitorId,
  isActive,
  isOpen,
  onOpenChange,
  request,
  name,
  projectKey,
}: UpdateMonitorDialogProps) => {
  const { t } = useT(MONITOR_ALERTS_MODULE);
  const updateMutation = useUpdateSingleMonitor();
  const updateHealth = useUpdateHealth();
  const queryClient = useQueryClient();
  const isLoading = updateMutation.isPending || updateHealth.isPending;

  const handleUpdate = async () => {
    try {
      const res = request
        ? await updateMutation.mutateAsync({
            itemId: monitorId,
            isActive: !isActive,
          })
        : await updateHealth.mutateAsync({
            itemId: monitorId,
            isActive: !isActive,
            name,
            projectKey,
          });

      // A refusal can come back as a 200 with isSuccess false: show the server's reason, not "success".
      if (!res?.isSuccess) {
        toast({
          variant: "destructive",
          title: t("ALERT_ACTION.FAILED"),
          description: refusalMessage(res, t("ALERT_ACTION.UPDATE_FAILED")),
        });
        return;
      }

      toast({
        variant: "success",
        title: t("common:SUCCESS"),
        description: isActive
          ? t("ALERT_ACTION.PAUSED_SUCCESS")
          : t("ALERT_ACTION.RESUMED_SUCCESS"),
      });

      onOpenChange(false);
    } catch (error) {
      toast({
        variant: "destructive",
        title: t("ALERT_ACTION.FAILED"),
        description: refusalMessage(error, t("ALERT_ACTION.UPDATE_FAILED")),
      });
    } finally {
      await queryClient.invalidateQueries({
        queryKey: ["health-monitor-list"],
      });
      await queryClient.invalidateQueries({ queryKey: ["monitor-list-by-id"] });
      await queryClient.invalidateQueries({
        queryKey: ["get-monitor-by-id", monitorId],
      });
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isActive ? t("ALERT_ACTION.PAUSE_TITLE") : t("ALERT_ACTION.RESUME_TITLE")}
          </DialogTitle>
          <DialogDescription>
            {isActive ? t("ALERT_ACTION.PAUSE_DESCRIPTION") : t("ALERT_ACTION.RESUME_DESCRIPTION")}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" disabled={isLoading} onClick={() => onOpenChange(false)}>
            {t("common:CANCEL")}
          </Button>
          <Button onClick={handleUpdate} disabled={isLoading}>
            {isLoading ? t("ALERT_ACTION.UPDATING") : t("common:CONFIRM")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

type DeleteMonitorDialogProps = {
  monitorId: string;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  goBack?: boolean;
  request: boolean;
};

const DeleteMonitorDialog = ({
  monitorId,
  isOpen,
  onOpenChange,
  goBack = true,
  request,
}: DeleteMonitorDialogProps) => {
  const { t } = useT(MONITOR_ALERTS_MODULE);
  const navigate = useNavigate();
  // Only call the hook when the dialog is open
  const deleteMutation = useDeleteMonitor();
  const deleteHealth = useDeleteHealth();

  const handleDelete = async () => {
    try {
      const res = request
        ? await deleteMutation.mutateAsync(monitorId)
        : await deleteHealth.mutateAsync(monitorId);

      // A refused delete (200, isSuccess false) must not close the dialog and navigate as if it worked.
      if (!res?.isSuccess) {
        toast({
          variant: "destructive",
          title: t("ALERT_ACTION.FAILED"),
          description: refusalMessage(res, t("ALERT_ACTION.DELETE_FAILED")),
        });
        return;
      }

      onOpenChange(false);
      if (goBack) {
        navigate(-1);
      }
    } catch (error) {
      toast({
        variant: "destructive",
        title: t("ALERT_ACTION.FAILED"),
        description: refusalMessage(error, t("ALERT_ACTION.DELETE_FAILED")),
      });
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("ALERT_ACTION.REMOVE_TITLE")}</DialogTitle>
          <DialogDescription>{t("ALERT_ACTION.REMOVE_DESCRIPTION")}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            disabled={deleteMutation.isPending}
            onClick={() => onOpenChange(false)}
          >
            {t("common:CANCEL")}
          </Button>
          <Button
            onClick={handleDelete}
            disabled={deleteMutation.isPending}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {t("common:CONFIRM")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
