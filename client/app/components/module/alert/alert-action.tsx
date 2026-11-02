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
  const activityState = isActive ? "Pause" : "Resume";
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
            <span>{activityState}</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            className="gap-2 cursor-pointer text-destructive"
            onClick={(e) => {
              e.stopPropagation();
              setIsDeleteDialogOpen(true);
            }}
          >
            <span>Delete</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {isUpdateDialogOpen && (
        <UpdateMonitorDialog
          monitorId={monitorId}
          isActive={isActive}
          activityState={activityState}
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

const UPDATE_FAILED = "Failed to update monitor status";
const DELETE_FAILED = "Failed to delete monitor status";

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
  activityState: string;
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
  activityState,
  isOpen,
  onOpenChange,
  request,
  name,
  projectKey,
}: UpdateMonitorDialogProps) => {
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
          title: "Failed",
          description: refusalMessage(res, UPDATE_FAILED),
        });
        return;
      }

      toast({
        variant: "success",
        title: "Success",
        description: isActive ? "Monitor paused successfully" : "Monitor resumed successfully",
      });

      onOpenChange(false);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Failed",
        description: refusalMessage(error, UPDATE_FAILED),
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
          <DialogTitle>{activityState} monitor?</DialogTitle>
          <DialogDescription>
            {isActive
              ? "This will temporarily stop all checks for this monitor until resumed."
              : "Checks will start running again based on the configured interval."}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" disabled={isLoading} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleUpdate} disabled={isLoading}>
            {isLoading ? "Updating..." : "Confirm"}
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
          title: "Failed",
          description: refusalMessage(res, DELETE_FAILED),
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
        title: "Failed",
        description: refusalMessage(error, DELETE_FAILED),
      });
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove monitor?</DialogTitle>
          <DialogDescription>
            This action will permanently delete the monitor and its related history. This cannot be
            undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            disabled={deleteMutation.isPending}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            onClick={handleDelete}
            disabled={deleteMutation.isPending}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
