import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  RadioGroup,
  RadioGroupItem,
} from "@/components/core";
import {
  useGetAlertRecipientSuggestions,
  useSaveAlertRecipient,
} from "@/hooks/use-alert-recipients";
import { showErrorToast, showSuccessToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { IAlertRecipient, IAlertRecipientMonitor } from "@/models/alert-recipients.model";
import {
  addAlertRecipientEmails,
  getInvalidEmailMessage,
  normalizeAlertRecipientEmail,
  splitAlertRecipientEmails,
} from "@/utils/alert-recipient-email.util";
import { ErrorTransformer } from "@seliseblocks/genesis-os/utils";
import { Loader2, Search } from "lucide-react";
import { type SubmitEvent, useId, useMemo, useState } from "react";
import { monitorKindLabel, recipientCountLabel, storedAllMonitors } from "./alert-recipients.utils";
import EmailChipsInput from "./email-chips-input";
import { tStatic, useT } from "@seliseblocks/genesis-os/i18n";

const MONITOR_ALERT_RECIPIENTS_MODULE = "monitor.alert-recipients";

export const getDuplicateRecipientMessage = () =>
  tStatic(MONITOR_ALERT_RECIPIENTS_MODULE, "RECIPIENT_DIALOG.DUPLICATE_RECIPIENT");

type Scope = "all" | "selected";

type RecipientDialogProps = {
  mode: "add" | "edit";
  /** The person being edited (edit mode). */
  recipient?: IAlertRecipient;
  projectKey: string;
  monitors: IAlertRecipientMonitor[];
  recipients: IAlertRecipient[];
  maxEmailsPerMonitor: number;
  onClose: () => void;
};

type EmailState = {
  /** Normalized and without repeats, in the typed order. */
  emails: string[];
  emailError: string | null;
  visibleEmailError: string | null;
};

/** The typed addresses: the normalized ones, and the parts that are not valid emails. */
const parseEmails = (typed: string) => {
  const parts = splitAlertRecipientEmails(typed);
  const emails: string[] = [];
  const invalid: string[] = [];
  for (const part of parts) {
    const normalized = normalizeAlertRecipientEmail(part);
    if (!normalized) invalid.push(part);
    else if (!emails.includes(normalized)) emails.push(normalized);
  }
  return { parts, emails, invalid };
};

const invalidEmailsMessage = (parts: string[], invalid: string[]) =>
  parts.length === 1
    ? getInvalidEmailMessage()
    : tStatic(MONITOR_ALERT_RECIPIENTS_MODULE, "RECIPIENT_DIALOG.INVALID_EMAILS", {
        emails: invalid.join(", "),
      });

const duplicateRecipientsMessage = (emails: string[], duplicates: string[]) =>
  emails.length === 1
    ? getDuplicateRecipientMessage()
    : tStatic(MONITOR_ALERT_RECIPIENTS_MODULE, "RECIPIENT_DIALOG.DUPLICATE_RECIPIENTS", {
        emails: duplicates.join(", "),
      });

/**
 * The emails to save and the error to show: invalid input on blur or submit; a duplicate or too
 * many addresses as soon as they are typed. Add mode takes several addresses, Edit only the stored one.
 */
const getEmailState = (
  isEdit: boolean,
  storedEmail: string | undefined,
  typed: string,
  recipientEmails: ReadonlySet<string>,
  maxEmails: number,
  revealInvalid: boolean,
): EmailState => {
  if (isEdit) {
    const emailError = storedEmail ? null : getInvalidEmailMessage();
    return { emails: storedEmail ? [storedEmail] : [], emailError, visibleEmailError: null };
  }

  const { parts, emails, invalid } = parseEmails(typed);
  const duplicates = emails.filter((email) => recipientEmails.has(email));
  let emailError: string | null = null;
  let showNow = false;
  if (parts.length === 0) emailError = getInvalidEmailMessage();
  else if (invalid.length > 0) emailError = invalidEmailsMessage(parts, invalid);
  else if (duplicates.length > 0) {
    emailError = duplicateRecipientsMessage(emails, duplicates);
    showNow = true;
  } else if (emails.length > maxEmails) {
    emailError = tStatic(MONITOR_ALERT_RECIPIENTS_MODULE, "RECIPIENT_DIALOG.TOO_MANY_EMAILS", {
      max: maxEmails,
    });
    showNow = true;
  }
  const visibleEmailError = showNow || revealInvalid ? emailError : null;
  return { emails, emailError, visibleEmailError };
};

/** One address the API refused or that failed in transit, with what to tell the user. */
type FailedSave = { email: string; error: unknown };

const failureLine = (failure: FailedSave) =>
  `${failure.email}: ${
    typeof failure.error === "string" && failure.error
      ? failure.error
      : tStatic(MONITOR_ALERT_RECIPIENTS_MODULE, "RECIPIENT_DIALOG.SAVE_FAILED")
  }`;

const getSaveLabel = (
  isEdit: boolean,
  scope: Scope,
  selectedCount: number,
  monitorCount: number,
) => {
  if (isEdit) return tStatic(MONITOR_ALERT_RECIPIENTS_MODULE, "common:SAVE");
  if (scope === "selected") {
    return tStatic(MONITOR_ALERT_RECIPIENTS_MODULE, "RECIPIENT_DIALOG.ADD_TO_MONITORS", {
      count: selectedCount,
    });
  }
  return monitorCount === 1
    ? tStatic(MONITOR_ALERT_RECIPIENTS_MODULE, "RECIPIENT_DIALOG.ADD_TO_MONITORS", { count: 1 })
    : tStatic(MONITOR_ALERT_RECIPIENTS_MODULE, "RECIPIENT_DIALOG.ADD_TO_ALL_MONITORS", {
        count: monitorCount,
      });
};

const fullMonitorsNote = (fullCount: number, maxEmailsPerMonitor: number) =>
  tStatic(MONITOR_ALERT_RECIPIENTS_MODULE, "RECIPIENT_DIALOG.FULL_MONITORS_NOTE", {
    count: fullCount,
    max: maxEmailsPerMonitor,
  });

const filterMonitors = (monitors: IAlertRecipientMonitor[], filter: string) => {
  const filterText = filter.trim().toLowerCase();
  return filterText
    ? monitors.filter((monitor) => monitor.name.toLowerCase().includes(filterText))
    : monitors;
};

const scopeCardClass = (active: boolean) =>
  cn(
    "flex cursor-pointer items-start gap-3 rounded-lg px-4 py-3.5",
    active ? "border-2 border-primary bg-primary/5" : "m-px border border-border bg-background",
  );

/**
 * Add alert recipients (one or several emails) or edit one: the email, then "All monitors" or a
 * checklist of monitors. Mounted only while open, so every opening starts from a fresh state.
 */
const RecipientDialog = ({
  mode,
  recipient,
  projectKey,
  monitors,
  recipients,
  maxEmailsPerMonitor,
  onClose,
}: RecipientDialogProps) => {
  const { t } = useT(MONITOR_ALERT_RECIPIENTS_MODULE);
  const isEdit = mode === "edit" && !!recipient;
  const id = useId();
  const emailId = `${id}-email`;
  const emailErrorId = `${id}-email-error`;
  const emailHintId = `${id}-email-hint`;
  const legendId = `${id}-legend`;

  // Add mode: the emails turned into chips, and the text still being typed.
  const [chips, setChips] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [touched, setTouched] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [scope, setScope] = useState<Scope>(
    !recipient || storedAllMonitors(recipient) ? "all" : "selected",
  );
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set(recipient?.monitorIds ?? []),
  );
  const [filter, setFilter] = useState("");
  // Covers the whole run of saves, since the mutation is idle between two of them.
  const [saving, setSaving] = useState(false);

  const saveMutation = useSaveAlertRecipient();
  const suggestions = useGetAlertRecipientSuggestions(projectKey, !isEdit);

  const recipientEmails = useMemo(() => new Set(recipients.map((r) => r.email)), [recipients]);
  const personMonitorIds = useMemo(() => new Set(recipient?.monitorIds ?? []), [recipient]);

  // Invalid input is reported on blur or submit; a duplicate as soon as it is typed.
  const { emails, emailError, visibleEmailError } = getEmailState(
    isEdit,
    recipient?.email,
    [...chips, draft].join(" "),
    recipientEmails,
    maxEmailsPerMonitor,
    touched || submitted,
  );

  // Add mode only (a cached list would otherwise show in Edit), and hidden while loading and after
  // any failure, e.g. a caller without the manage permission. A member already typed is hidden too.
  const memberEmails =
    !isEdit && suggestions.isSuccess
      ? suggestions.data.memberEmails.filter(
          (member) => !recipientEmails.has(member) && !emails.includes(member),
        )
      : [];

  const isFull = (monitor: IAlertRecipientMonitor) =>
    monitor.emailCount >= maxEmailsPerMonitor && !personMonitorIds.has(monitor.itemId);
  const fullCount = monitors.filter(isFull).length;
  const selectedIds = monitors
    .filter((monitor) => selected.has(monitor.itemId) && !isFull(monitor))
    .map((monitor) => monitor.itemId);

  const visibleMonitors = filterMonitors(monitors, filter);

  const isSaving = saving || saveMutation.isPending;
  const canSave =
    !emailError && !isSaving && (scope === "all" ? monitors.length > 0 : selectedIds.length > 0);

  const saveLabel = getSaveLabel(isEdit, scope, selectedIds.length, monitors.length);

  let emailDescribedBy: string | undefined;
  if (visibleEmailError) emailDescribedBy = emailErrorId;
  else if (!isEdit) emailDescribedBy = emailHintId;

  const toggleMonitor = (monitorId: string, checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(monitorId);
      else next.delete(monitorId);
      return next;
    });
  };

  /** The API's message for one saved email; throws on a transport failure. */
  const saveOne = async (address: string) => {
    const response = await saveMutation.mutateAsync({
      projectKey,
      email: address,
      allMonitors: scope === "all",
      monitorIds: scope === "all" ? [] : selectedIds,
    });
    if (!response?.isSuccess) {
      return { ok: false, message: response?.message || t("RECIPIENT_DIALOG.SAVE_FAILED") };
    }
    return { ok: true, message: response.message || t("RECIPIENT_DIALOG.SAVED") };
  };

  /** One person: the API's own message, as before several emails were allowed. */
  const reportOne = (failed: FailedSave[], lastMessage: string) => {
    if (failed.length > 0) {
      showErrorToast({ errors: failed[0].error });
      return;
    }
    showSuccessToast({ description: lastMessage });
    onClose();
  };

  /** Several people: the refused ones stay typed in the field, so a retry sends only them. */
  const reportMany = (failed: FailedSave[], total: number) => {
    const savedCount = total - failed.length;
    if (failed.length === 0) {
      showSuccessToast({ description: t("RECIPIENT_DIALOG.SAVED_MANY", { count: total }) });
      onClose();
      return;
    }
    setChips(failed.map((failure) => failure.email));
    setDraft("");
    showErrorToast({
      title: t("RECIPIENT_DIALOG.SOME_NOT_SAVED", { count: savedCount, total }),
      errors: failed.map(failureLine),
    });
  };

  // One request per email, in order: the server applies its per-person rules (the "All monitors"
  // limit, full monitors) to each, and one refusal does not stop the others.
  const handleSubmit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitted(true);
    if (!canSave || emails.length === 0) return;
    setSaving(true);
    const failed: FailedSave[] = [];
    let lastMessage = "";
    for (const address of emails) {
      try {
        const result = await saveOne(address);
        if (result.ok) lastMessage = result.message;
        else failed.push({ email: address, error: result.message });
      } catch (error) {
        failed.push({ email: address, error: ErrorTransformer(error) });
      }
    }
    setSaving(false);
    if (emails.length === 1) reportOne(failed, lastMessage);
    else reportMany(failed, emails.length);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      {/* Header and footer stay put; only the body scrolls, so Save is always in reach. */}
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-[600px] flex-col gap-0 overflow-hidden rounded-lg p-0 sm:rounded-lg">
        <form noValidate onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <DialogHeader className="shrink-0 px-6 pb-3 pt-6 text-left">
            <DialogTitle className="text-xl">
              {isEdit ? t("RECIPIENT_DIALOG.EDIT_TITLE") : t("RECIPIENT_DIALOG.ADD_TITLE")}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {t("RECIPIENT_DIALOG.DESCRIPTION")}
            </DialogDescription>
          </DialogHeader>

          <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 pb-5 pt-1">
            <div className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-3">
                <Label htmlFor={emailId} className="font-semibold">
                  {t("common:EMAIL")}
                </Label>
                {!isEdit && chips.length > 0 && (
                  <div className="flex items-center gap-3 text-xs">
                    <span
                      className={cn(
                        "tabular-nums",
                        emails.length > maxEmailsPerMonitor
                          ? "text-destructive"
                          : "text-muted-foreground",
                      )}
                    >
                      {t("RECIPIENT_DIALOG.EMAILS_COUNT", {
                        count: emails.length,
                        max: maxEmailsPerMonitor,
                      })}
                    </span>
                    <button
                      type="button"
                      disabled={isSaving}
                      className="font-medium text-primary hover:underline disabled:opacity-50"
                      onClick={() => {
                        setChips([]);
                        setDraft("");
                      }}
                    >
                      {t("RECIPIENT_DIALOG.CLEAR_ALL")}
                    </button>
                  </div>
                )}
              </div>
              {isEdit ? (
                <Input
                  id={emailId}
                  type="email"
                  value={recipient.email}
                  readOnly
                  aria-readonly
                  className="bg-muted"
                />
              ) : (
                <EmailChipsInput
                  id={emailId}
                  chips={chips}
                  draft={draft}
                  onChipsChange={setChips}
                  onDraftChange={setDraft}
                  onBlur={() => setTouched(true)}
                  isChipRejected={(chip) => recipientEmails.has(chip)}
                  placeholder={t("RECIPIENT_DIALOG.EMAILS_PLACEHOLDER")}
                  morePlaceholder={t("RECIPIENT_DIALOG.ADD_MORE_PLACEHOLDER")}
                  invalid={!!visibleEmailError}
                  describedBy={emailDescribedBy}
                  disabled={isSaving}
                />
              )}
              {visibleEmailError && (
                <p id={emailErrorId} className="text-sm text-destructive">
                  {visibleEmailError}
                </p>
              )}
              {!isEdit && !visibleEmailError && (
                <p id={emailHintId} className="text-[13px] text-muted-foreground">
                  {t("RECIPIENT_DIALOG.EMAILS_HINT", { max: maxEmailsPerMonitor })}
                </p>
              )}
              {memberEmails.length > 0 && (
                <div className="flex max-h-24 flex-wrap items-center gap-1.5 overflow-y-auto pt-1">
                  <span className="text-xs text-muted-foreground">
                    {t("RECIPIENT_DIALOG.PROJECT_MEMBERS")}
                  </span>
                  {memberEmails.map((member) => (
                    <Button
                      key={member}
                      type="button"
                      variant="outline"
                      size="xxs"
                      className="h-7 rounded-full border-dashed border-primary px-2.5 text-xs font-normal text-primary"
                      onClick={() => {
                        setChips((current) => addAlertRecipientEmails(current, member));
                        setTouched(true);
                      }}
                    >
                      {member}
                    </Button>
                  ))}
                </div>
              )}
            </div>

            <fieldset className="flex flex-col gap-2">
              <legend id={legendId} className="pb-2 text-sm font-semibold">
                {t("RECIPIENT_DIALOG.SEND_ALERTS_FOR")}
              </legend>
              <RadioGroup
                aria-labelledby={legendId}
                value={scope}
                onValueChange={(value) => setScope(value as Scope)}
                className="gap-2"
              >
                <Label htmlFor={`${id}-all`} className={scopeCardClass(scope === "all")}>
                  <RadioGroupItem id={`${id}-all`} value="all" className="mt-0.5" />
                  <span className="flex flex-col gap-0.5">
                    <span className="text-[15px] font-semibold">
                      {t("RECIPIENT_DIALOG.ALL_MONITORS", { total: monitors.length })}
                    </span>
                    <span className="text-[13px] font-normal text-muted-foreground">
                      {t("RECIPIENT_DIALOG.ALL_MONITORS_HINT")}
                    </span>
                  </span>
                </Label>
                <Label htmlFor={`${id}-selected`} className={scopeCardClass(scope === "selected")}>
                  <RadioGroupItem id={`${id}-selected`} value="selected" className="mt-0.5" />
                  <span className="flex flex-col gap-0.5">
                    <span className="text-[15px] font-semibold">
                      {t("RECIPIENT_DIALOG.SELECTED_MONITORS")}
                    </span>
                    <span className="text-[13px] font-normal text-muted-foreground">
                      {t("RECIPIENT_DIALOG.SELECTED_MONITORS_HINT")}
                    </span>
                  </span>
                </Label>
              </RadioGroup>

              {scope === "all" && fullCount > 0 && (
                <p className="text-[13px] text-muted-foreground">
                  {fullMonitorsNote(fullCount, maxEmailsPerMonitor)}
                </p>
              )}

              {scope === "selected" && (
                <div className="ml-7 flex flex-col overflow-hidden rounded-lg border">
                  <div className="relative border-b p-2">
                    <Search
                      aria-hidden="true"
                      className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                    />
                    <Input
                      type="search"
                      aria-label={t("RECIPIENT_DIALOG.FILTER_MONITORS")}
                      placeholder={t("RECIPIENT_DIALOG.FILTER_MONITORS")}
                      value={filter}
                      className="h-9 pl-8"
                      onChange={(event) => setFilter(event.target.value)}
                    />
                  </div>
                  <ul
                    className="max-h-64 overflow-y-auto"
                    aria-label={t("RECIPIENT_DIALOG.MONITORS_LIST")}
                  >
                    {visibleMonitors.map((monitor) => {
                      const full = isFull(monitor);
                      const checkboxId = `${id}-monitor-${monitor.itemId}`;
                      return (
                        <li key={monitor.itemId} className="border-b last:border-b-0">
                          <Label
                            htmlFor={checkboxId}
                            className={cn(
                              "flex min-h-[42px] items-center gap-2.5 px-3 py-2 font-normal",
                              full ? "cursor-not-allowed" : "cursor-pointer",
                            )}
                          >
                            <Checkbox
                              id={checkboxId}
                              checked={!full && selected.has(monitor.itemId)}
                              disabled={full}
                              onCheckedChange={(checked) =>
                                toggleMonitor(monitor.itemId, checked === true)
                              }
                            />
                            <span className="flex-1 break-all text-sm text-foreground">
                              {monitor.name}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {full
                                ? t("RECIPIENT_DIALOG.FULL", {
                                    current: monitor.emailCount,
                                    max: maxEmailsPerMonitor,
                                  })
                                : t("RECIPIENT_DIALOG.MONITOR_META", {
                                    kind: monitorKindLabel(monitor.kind),
                                    recipients: recipientCountLabel(monitor.emailCount),
                                  })}
                            </span>
                          </Label>
                        </li>
                      );
                    })}
                    {visibleMonitors.length === 0 && (
                      <li className="px-3 py-3 text-sm text-muted-foreground">
                        {t("RECIPIENT_DIALOG.NO_MONITORS_MATCH")}
                      </li>
                    )}
                  </ul>
                </div>
              )}
            </fieldset>
          </div>

          <DialogFooter className="shrink-0 flex-wrap border-t px-6 pb-6 pt-4 sm:gap-3">
            <Button type="button" variant="outline" onClick={onClose}>
              {t("common:CANCEL")}
            </Button>
            <Button type="submit" disabled={!canSave}>
              {isSaving && <Loader2 aria-hidden="true" className="mr-2 h-4 w-4 animate-spin" />}
              {saveLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default RecipientDialog;
