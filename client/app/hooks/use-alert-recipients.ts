import type {
  IAlertRecipientsData,
  IDeleteAlertRecipientPayload,
  ISaveAlertRecipientPayload,
} from "@/models/alert-recipients.model";
import { alertRecipientsService } from "@/services/alert-recipients.service";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export const ALERT_RECIPIENTS_QUERY_KEY = "alert-recipients";
export const ALERT_RECIPIENT_SUGGESTIONS_QUERY_KEY = "alert-recipient-suggestions";

/** A refused GET ("Project not found." and the like) is an error, never an empty list. */
const unwrap = async <T>(
  request: Promise<{ isSuccess: boolean; message?: string | null; data: T | null }>,
): Promise<T> => {
  const response = await request;
  if (!response?.isSuccess || response.data == null) {
    throw new Error(response?.message || "The request was refused.");
  }
  return response.data;
};

export const useGetAlertRecipients = (projectKey: string) => {
  return useQuery({
    queryKey: [ALERT_RECIPIENTS_QUERY_KEY, projectKey],
    queryFn: () => unwrap(alertRecipientsService.getAlertRecipients(projectKey)),
    enabled: !!projectKey,
    refetchOnMount: "always",
  });
};

/**
 * Project-member emails for the Add dialog. Needs the manage permission; any failure leaves the
 * suggestions hidden, so it is not retried.
 */
export const useGetAlertRecipientSuggestions = (projectKey: string, enabled: boolean) => {
  return useQuery({
    queryKey: [ALERT_RECIPIENT_SUGGESTIONS_QUERY_KEY, projectKey],
    queryFn: () => unwrap(alertRecipientsService.getAlertRecipientSuggestions(projectKey)),
    enabled: enabled && !!projectKey,
    retry: false,
  });
};

/** Recipients changed: the page, the suggestions and any open monitor details are stale. */
const useInvalidateRecipients = () => {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: [ALERT_RECIPIENTS_QUERY_KEY] });
    queryClient.invalidateQueries({ queryKey: [ALERT_RECIPIENT_SUGGESTIONS_QUERY_KEY] });
    queryClient.invalidateQueries({ queryKey: ["get-monitor-by-id"] });
  };
};

export const useSaveAlertRecipient = () => {
  const invalidate = useInvalidateRecipients();
  return useMutation({
    mutationKey: ["save-alert-recipient"],
    mutationFn: (payload: ISaveAlertRecipientPayload) =>
      alertRecipientsService.saveAlertRecipient(payload),
    // Also after a refusal: a partial write (the "All monitors" choice failing after the monitor
    // writes) still changed monitors.
    onSettled: invalidate,
  });
};

export const useDeleteAlertRecipient = () => {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateRecipients();
  return useMutation({
    mutationKey: ["delete-alert-recipient"],
    mutationFn: (payload: IDeleteAlertRecipientPayload) =>
      alertRecipientsService.deleteAlertRecipient(payload),
    // The row goes as soon as the API confirms (H7); the refetch below then brings the counts.
    onSuccess: (response, { projectKey, email }) => {
      if (!response?.isSuccess) return;
      queryClient.setQueryData<IAlertRecipientsData>(
        [ALERT_RECIPIENTS_QUERY_KEY, projectKey],
        (current) =>
          current && {
            ...current,
            recipients: current.recipients.filter((recipient) => recipient.email !== email),
          },
      );
    },
    onSettled: invalidate,
  });
};
