import { EllipsisVertical, Pause, Play, Trash2 } from "lucide-react";
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
        <DropdownMenuContent align="center" className="pointer-events-auto min-w-40 rounded-sm">
          <DropdownMenuItem
            className="cursor-pointer gap-2 text-[13px]"
            onClick={(e) => {
              e.stopPropagation();
              setIsUpdateDialogOpen(true);
            }}
          >
            {isActive ? (
              <Pause className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Play className="h-4 w-4" aria-hidden="true" />
            )}
            <span>{activityState}</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            className="cursor-pointer gap-2 text-[13px] text-destructive focus:bg-destructive/10 focus:text-destructive"
            onClick={(e) => {
              e.stopPropagation();
              setIsDeleteDialogOpen(true);
            }}
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
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
      if (request) {
        await updateMutation.mutateAsync({
          itemId: monitorId,
          isActive: !isActive,
        });
      } else {
        await updateHealth.mutateAsync({
          itemId: monitorId,
          isActive: !isActive,
          name,
          projectKey,
        });
      }

      toast({
        variant: "success",
        title: "Success",
        description: isActive ? "Monitor paused successfully" : "Monitor resumed successfully",
      });

      onOpenChange(false);
    } catch {
      toast({
        variant: "destructive",
        title: "Failed",
        description: "Failed to update monitor status",
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
      if (request) {
        await deleteMutation.mutateAsync(monitorId);
      } else {
        await deleteHealth.mutateAsync(monitorId);
      }
      onOpenChange(false);
      if (goBack) {
        navigate(-1);
      }
    } catch {
      toast({
        variant: "destructive",
        title: "Failed",
        description: "Failed to delete monitor status",
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
