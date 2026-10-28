"use client";

import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  Input,
  Skeleton,
} from "@/components/core";
import {
  filterRecipients,
  removedNotice,
  sortByEmail,
  storedAllMonitors,
} from "@/components/module/alert-recipients/alert-recipients.utils";
import CoverageBadge from "@/components/module/alert-recipients/coverage-badge";
import RecipientDialog from "@/components/module/alert-recipients/recipient-dialog";
import RecipientsTable from "@/components/module/alert-recipients/recipients-table";
import {
  useDeleteAlertRecipient,
  useGetAlertRecipients,
  useSaveAlertRecipient,
} from "@/hooks/use-alert-recipients";
import { showErrorToast, showSuccessToast } from "@/hooks/use-toast";
import type { IAlertRecipient } from "@/models/alert-recipients.model";
import { useScopedPath } from "@seliseblocks/genesis-os/hooks";
import { useProjectStore } from "@seliseblocks/genesis-os/store";
import { ErrorTransformer } from "@seliseblocks/genesis-os/utils";
import { AlertCircle, Loader2, Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";

type DialogState = { mode: "add" } | { mode: "edit"; recipient: IAlertRecipient } | null;

/** What Undo resends: the person's assignment from the last load before the removal (H8). */
type RemovedNotice = {
  email: string;
  removed: number;
  allMonitors: boolean;
  monitorIds: string[];
};

const LOADING_ROWS = 5;

const LoadingRows = () => (
  <div className="flex flex-col gap-3 p-6" data-testid="recipients-loading">
    {Array.from({ length: LOADING_ROWS }, (_, index) => (
      <Skeleton key={index} className="h-12 w-full" /> //nosonar
    ))}
  </div>
);

const AlertRecipientsPage = () => {
  const project = useProjectStore()?.selectedProject;
  const projectKey = project?.tenantId || "";
  const projectName = project?.name || "this project";
  const scoped = useScopedPath();

  const [search, setSearch] = useState("");
  const [dialog, setDialog] = useState<DialogState>(null);
  const [notice, setNotice] = useState<RemovedNotice | null>(null);

  const { data, isLoading, isError, error, refetch, isFetching } =
    useGetAlertRecipients(projectKey);
  const deleteMutation = useDeleteAlertRecipient();
  const undoMutation = useSaveAlertRecipient();

  const monitors = useMemo(() => data?.monitors ?? [], [data]);
  const monitorsById = useMemo(() => new Map(monitors.map((m) => [m.itemId, m])), [monitors]);
  const recipients = useMemo(() => sortByEmail(data?.recipients ?? []), [data]);
  const rows = useMemo(
    () => filterRecipients(recipients, monitorsById, search),
    [recipients, monitorsById, search],
  );
  const withoutRecipients = (data?.monitorsWithoutRecipients ?? []).filter((id) =>
    monitorsById.has(id),
  ).length;
  const maxEmailsPerMonitor = data?.maxEmailsPerMonitor ?? 10;

  const hasData = !!data && !isError;
  const hasMonitors = monitors.length > 0;

  const handleRemove = async (recipient: IAlertRecipient) => {
    try {
      const response = await deleteMutation.mutateAsync({ projectKey, email: recipient.email });
      if (!response?.isSuccess) {
        showErrorToast({ errors: response?.message || "The recipient was not removed." });
        return;
      }
      setNotice({
        email: recipient.email,
        removed: response.data?.removed ?? recipient.monitorIds.length,
        allMonitors: storedAllMonitors(recipient),
        monitorIds: recipient.monitorIds,
      });
    } catch (removeError) {
      showErrorToast({ errors: ErrorTransformer(removeError) });
    }
  };

  const handleUndo = async () => {
    if (!notice) return;
    try {
      const response = await undoMutation.mutateAsync({
        projectKey,
        email: notice.email,
        allMonitors: notice.allMonitors,
        monitorIds: notice.allMonitors ? [] : notice.monitorIds,
      });
      if (!response?.isSuccess) {
        showErrorToast({ errors: response?.message || "The recipient was not restored." });
        return;
      }
      setNotice(null);
      showSuccessToast({ description: response.message || `${notice.email} restored.` });
    } catch (undoError) {
      showErrorToast({ errors: ErrorTransformer(undoError) });
    }
  };

  // Undo needs something to put back: a person on no monitor and not "All" cannot be re-added.
  const canUndo = !!notice && (notice.allMonitors || notice.monitorIds.length > 0);

  const renderBody = () => {
    if (isLoading) return <LoadingRows />;
    if (isError || !data) {
      return (
        <div className="p-6">
          <Alert variant="destructive">
            <AlertCircle aria-hidden="true" />
            <AlertTitle>Alert recipients could not be loaded.</AlertTitle>
            <AlertDescription>
              <p>{error instanceof Error ? error.message : "Try again."}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-2"
                disabled={isFetching}
                onClick={() => refetch()}
              >
                {isFetching && <Loader2 aria-hidden="true" className="mr-2 h-4 w-4 animate-spin" />}
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        </div>
      );
    }
    if (!hasMonitors) {
      return (
        <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
          <p className="font-medium text-foreground">Add a monitor first.</p>
          <Link
            to={scoped("monitor")}
            className="text-sm font-semibold text-primary hover:underline"
          >
            Go to Monitor
          </Link>
        </div>
      );
    }
    if (recipients.length === 0) {
      return (
        <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
          <p className="font-medium text-foreground">No one gets alert emails yet.</p>
          <Button type="button" onClick={() => setDialog({ mode: "add" })} className="gap-1">
            <Plus aria-hidden="true" size={16} />
            Add recipient
          </Button>
        </div>
      );
    }
    if (rows.length === 0) {
      return (
        <p className="px-6 py-12 text-center text-muted-foreground">No people or monitors match.</p>
      );
    }
    return (
      <div className="overflow-x-auto">
        <RecipientsTable
          recipients={rows}
          monitorsById={monitorsById}
          totalMonitors={monitors.length}
          removingEmail={
            deleteMutation.isPending ? (deleteMutation.variables?.email ?? null) : null
          }
          onEdit={(recipient) => setDialog({ mode: "edit", recipient })}
          onRemove={handleRemove}
        />
      </div>
    );
  };

  return (
    <main className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-lg font-semibold md:text-2xl">Alert recipients</h1>
          <p className="text-muted-foreground">
            People who get an email when a monitor in {projectName} goes down or comes back up.
          </p>
        </div>
        <Button
          type="button"
          className="gap-1"
          disabled={!hasData || !hasMonitors}
          onClick={() => setDialog({ mode: "add" })}
        >
          <Plus aria-hidden="true" size={16} />
          Add recipient
        </Button>
      </div>

      {/* Always mounted, so screen readers announce the notice when its text appears. */}
      <div role="status" aria-live="polite">
        {notice && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 py-2 pl-4 pr-2 text-sm text-foreground">
            <span className="flex-1">{removedNotice(notice.email, notice.removed)}</span>
            {canUndo && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="font-semibold text-primary"
                disabled={undoMutation.isPending}
                onClick={handleUndo}
              >
                {undoMutation.isPending && (
                  <Loader2 aria-hidden="true" className="mr-2 h-4 w-4 animate-spin" />
                )}
                Undo
              </Button>
            )}
          </div>
        )}
      </div>

      <Card className="overflow-hidden">
        {hasData && hasMonitors && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-b px-6 py-4">
            <div className="relative min-w-[220px] flex-[0_1_320px]">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                type="search"
                aria-label="Search people or monitors"
                placeholder="Search people or monitors"
                value={search}
                className="pl-9"
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <CoverageBadge total={monitors.length} withoutRecipients={withoutRecipients} />
          </div>
        )}
        <CardContent className="p-0">{renderBody()}</CardContent>
        {hasData && (
          <div className="border-t bg-muted/40 px-6 py-3.5 text-[13px] text-muted-foreground">
            Alerts are sent to the emails saved on each monitor. A monitor can have up to{" "}
            {maxEmailsPerMonitor}.
          </div>
        )}
      </Card>

      {dialog && data && (
        <RecipientDialog
          key={dialog.mode === "edit" ? dialog.recipient.email : "add"}
          mode={dialog.mode}
          recipient={dialog.mode === "edit" ? dialog.recipient : undefined}
          projectKey={projectKey}
          monitors={monitors}
          recipients={recipients}
          maxEmailsPerMonitor={maxEmailsPerMonitor}
          onClose={() => setDialog(null)}
        />
      )}
    </main>
  );
};

export default AlertRecipientsPage;
