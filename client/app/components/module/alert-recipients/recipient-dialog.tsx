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
  INVALID_EMAIL_MESSAGE,
  normalizeAlertRecipientEmail,
} from "@/utils/alert-recipient-email.util";
import { ErrorTransformer } from "@seliseblocks/genesis-os/utils";
import { Loader2, Search } from "lucide-react";
import { type FormEvent, useId, useMemo, useState } from "react";
import {
  countMonitors,
  monitorKindLabel,
  recipientCountLabel,
  storedAllMonitors,
} from "./alert-recipients.utils";

export const DUPLICATE_RECIPIENT_MESSAGE =
  "This person already gets alerts. Use Edit to change their monitors.";

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

const scopeCardClass = (active: boolean) =>
  cn(
    "flex cursor-pointer items-start gap-3 rounded-lg px-4 py-3.5",
    active ? "border-2 border-primary bg-primary/5" : "m-px border border-border bg-background",
  );

/**
 * Add or edit one alert recipient: an email, then "All monitors" or a checklist of monitors.
 * Mounted only while open, so every opening starts from a fresh state.
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
  const isEdit = mode === "edit" && !!recipient;
  const id = useId();
  const emailId = `${id}-email`;
  const emailErrorId = `${id}-email-error`;
  const legendId = `${id}-legend`;

  const [email, setEmail] = useState(recipient?.email ?? "");
  const [touched, setTouched] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [scope, setScope] = useState<Scope>(
    !recipient || storedAllMonitors(recipient) ? "all" : "selected",
  );
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set(recipient?.monitorIds ?? []),
  );
  const [filter, setFilter] = useState("");

  const saveMutation = useSaveAlertRecipient();
  const suggestions = useGetAlertRecipientSuggestions(projectKey, !isEdit);

  const recipientEmails = useMemo(() => new Set(recipients.map((r) => r.email)), [recipients]);
  const personMonitorIds = useMemo(() => new Set(recipient?.monitorIds ?? []), [recipient]);

  // Add mode only (a cached list would otherwise show in Edit), and hidden while loading and after
  // any failure, e.g. a caller without the manage permission.
  const memberEmails =
    !isEdit && suggestions.isSuccess
      ? suggestions.data.memberEmails.filter((member) => !recipientEmails.has(member))
      : [];

  const normalized = isEdit ? recipient.email : normalizeAlertRecipientEmail(email);
  const isDuplicate = !isEdit && !!normalized && recipientEmails.has(normalized);
  let emailError: string | null = null;
  if (!normalized) emailError = INVALID_EMAIL_MESSAGE;
  else if (isDuplicate) emailError = DUPLICATE_RECIPIENT_MESSAGE;
  // Invalid input is reported on blur or submit; a duplicate as soon as it is typed.
  const visibleEmailError = isDuplicate || touched || submitted ? emailError : null;

  const isFull = (monitor: IAlertRecipientMonitor) =>
    monitor.emailCount >= maxEmailsPerMonitor && !personMonitorIds.has(monitor.itemId);
  const fullCount = monitors.filter(isFull).length;
  const selectedIds = monitors
    .filter((monitor) => selected.has(monitor.itemId) && !isFull(monitor))
    .map((monitor) => monitor.itemId);

  const filterText = filter.trim().toLowerCase();
  const visibleMonitors = filterText
    ? monitors.filter((monitor) => monitor.name.toLowerCase().includes(filterText))
    : monitors;

  const canSave =
    !emailError &&
    !saveMutation.isPending &&
    (scope === "all" ? monitors.length > 0 : selectedIds.length > 0);

  let saveLabel = "Save";
  if (!isEdit) {
    if (scope === "selected") saveLabel = `Add to ${countMonitors(selectedIds.length)}`;
    else
      saveLabel =
        monitors.length === 1 ? "Add to 1 monitor" : `Add to all ${monitors.length} monitors`;
  }

  const toggleMonitor = (monitorId: string, checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(monitorId);
      else next.delete(monitorId);
      return next;
    });
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitted(true);
    if (!canSave || !normalized) return;
    try {
      const response = await saveMutation.mutateAsync({
        projectKey,
        email: normalized,
        allMonitors: scope === "all",
        monitorIds: scope === "all" ? [] : selectedIds,
      });
      if (!response?.isSuccess) {
        showErrorToast({ errors: response?.message || "The recipient was not saved." });
        return;
      }
      showSuccessToast({ description: response.message || "Recipient saved." });
      onClose();
    } catch (error) {
      showErrorToast({ errors: ErrorTransformer(error) });
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-[600px] gap-0 overflow-y-auto rounded-lg p-0 sm:rounded-lg">
        <form noValidate onSubmit={handleSubmit}>
          <DialogHeader className="px-6 pb-3 pt-6 text-left">
            <DialogTitle className="text-xl">
              {isEdit ? "Edit recipient" : "Add recipient"}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              This person gets an email when a chosen monitor goes down or comes back up.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-5 px-6">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={emailId} className="font-semibold">
                Email
              </Label>
              <Input
                id={emailId}
                type="email"
                inputMode="email"
                autoComplete="off"
                placeholder="name@company.com"
                value={isEdit ? recipient.email : email}
                readOnly={isEdit}
                aria-readonly={isEdit || undefined}
                aria-invalid={visibleEmailError ? true : undefined}
                aria-describedby={visibleEmailError ? emailErrorId : undefined}
                className={cn(isEdit && "bg-muted", visibleEmailError && "border-destructive")}
                onChange={(event) => setEmail(event.target.value)}
                onBlur={() => setTouched(true)}
              />
              {visibleEmailError && (
                <p id={emailErrorId} className="text-sm text-destructive">
                  {visibleEmailError}
                </p>
              )}
              {memberEmails.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  <span className="text-xs text-muted-foreground">Project members:</span>
                  {memberEmails.map((member) => (
                    <Button
                      key={member}
                      type="button"
                      variant="outline"
                      size="xxs"
                      className="h-7 rounded-full border-dashed border-primary px-2.5 text-xs font-normal text-primary"
                      onClick={() => {
                        setEmail(member);
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
                Send alerts for
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
                      All monitors ({monitors.length})
                    </span>
                    <span className="text-[13px] font-normal text-muted-foreground">
                      Also added to monitors you create later.
                    </span>
                  </span>
                </Label>
                <Label htmlFor={`${id}-selected`} className={scopeCardClass(scope === "selected")}>
                  <RadioGroupItem id={`${id}-selected`} value="selected" className="mt-0.5" />
                  <span className="flex flex-col gap-0.5">
                    <span className="text-[15px] font-semibold">Selected monitors</span>
                    <span className="text-[13px] font-normal text-muted-foreground">
                      Choose which ones.
                    </span>
                  </span>
                </Label>
              </RadioGroup>

              {scope === "all" && fullCount > 0 && (
                <p className="text-[13px] text-muted-foreground">
                  {fullCount === 1
                    ? `1 monitor already has ${maxEmailsPerMonitor} recipients and will be skipped.`
                    : `${fullCount} monitors already have ${maxEmailsPerMonitor} recipients and will be skipped.`}
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
                      aria-label="Filter monitors"
                      placeholder="Filter monitors"
                      value={filter}
                      className="h-9 pl-8"
                      onChange={(event) => setFilter(event.target.value)}
                    />
                  </div>
                  <ul className="max-h-64 overflow-y-auto" aria-label="Monitors">
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
                                ? `Full (${monitor.emailCount} of ${maxEmailsPerMonitor})`
                                : `${monitorKindLabel(monitor.kind)} · ${recipientCountLabel(monitor.emailCount)}`}
                            </span>
                          </Label>
                        </li>
                      );
                    })}
                    {visibleMonitors.length === 0 && (
                      <li className="px-3 py-3 text-sm text-muted-foreground">
                        No monitors match.
                      </li>
                    )}
                  </ul>
                </div>
              )}
            </fieldset>
          </div>

          <DialogFooter className="flex-wrap px-6 pb-6 pt-5 sm:gap-3">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSave}>
              {saveMutation.isPending && (
                <Loader2 aria-hidden="true" className="mr-2 h-4 w-4 animate-spin" />
              )}
              {saveLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default RecipientDialog;
