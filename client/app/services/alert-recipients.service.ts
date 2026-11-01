import { ALERT_ENDPOINTS } from "@/constants/endpoint.constant";
import { serviceInstances } from "@/lib/http-client";
import type {
  DeleteAlertRecipientResponse,
  GetAlertRecipientSuggestionsResponse,
  GetAlertRecipientsResponse,
  IDeleteAlertRecipientPayload,
  ISaveAlertRecipientPayload,
  SaveAlertRecipientResponse,
} from "@/models/alert-recipients.model";

class AlertRecipientsService {
  private readonly httpClient = serviceInstances.monitorService;

  async getAlertRecipients(projectKey: string) {
    const url = `${ALERT_ENDPOINTS.GET_ALERT_RECIPIENTS}?projectKey=${encodeURIComponent(projectKey)}`;
    return this.httpClient.get<GetAlertRecipientsResponse>(url);
  }

  async getAlertRecipientSuggestions(projectKey: string) {
    const url = `${ALERT_ENDPOINTS.GET_ALERT_RECIPIENT_SUGGESTIONS}?projectKey=${encodeURIComponent(projectKey)}`;
    return this.httpClient.get<GetAlertRecipientSuggestionsResponse>(url);
  }

  async saveAlertRecipient(payload: ISaveAlertRecipientPayload) {
    return this.httpClient.post<SaveAlertRecipientResponse>(
      ALERT_ENDPOINTS.SAVE_ALERT_RECIPIENT,
      payload,
    );
  }

  /** The email goes in the body, never the URL: request logs must not carry addresses. */
  async deleteAlertRecipient(payload: IDeleteAlertRecipientPayload) {
    return this.httpClient.post<DeleteAlertRecipientResponse>(
      ALERT_ENDPOINTS.DELETE_ALERT_RECIPIENT,
      payload,
    );
  }
}

export const alertRecipientsService = new AlertRecipientsService();
