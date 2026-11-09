import { cn } from "@/lib/utils";
import {
  addAlertRecipientEmails,
  normalizeAlertRecipientEmail,
} from "@/utils/alert-recipient-email.util";
import { useT } from "@seliseblocks/genesis-os/i18n";
import { AlertCircle, X } from "lucide-react";
import { type ClipboardEvent, type KeyboardEvent, useRef } from "react";

const MONITOR_ALERT_RECIPIENTS_MODULE = "monitor.alert-recipients";

/** Keys that turn the typed text into a chip. Enter only when there is text, so it can still submit. */
const SEPARATOR_KEYS = new Set([",", ";", " "]);
const SEPARATOR_PATTERN = /[\s,;]/;

type EmailChipsInputProps = {
  /** The id of the text box, for the field's label. */
  id: string;
  chips: string[];
  draft: string;
  onChipsChange: (chips: string[]) => void;
  onDraftChange: (draft: string) => void;
  onBlur: () => void;
  /** Chips to mark as errors, e.g. people who already get alerts. */
  isChipRejected: (chip: string) => boolean;
  placeholder: string;
  morePlaceholder: string;
  invalid: boolean;
  describedBy?: string;
  disabled?: boolean;
};

/**
 * A field that turns each typed or pasted email into a removable chip. Enter, comma, semicolon,
 * space, paste and leaving the field all add the typed text; Backspace in an empty box takes the
 * last chip back for editing. The chips scroll inside the field, so a long list never grows the dialog.
 */
const EmailChipsInput = ({
  id,
  chips,
  draft,
  onChipsChange,
  onDraftChange,
  onBlur,
  isChipRejected,
  placeholder,
  morePlaceholder,
  invalid,
  describedBy,
  disabled,
}: EmailChipsInputProps) => {
  const { t } = useT(MONITOR_ALERT_RECIPIENTS_MODULE);
  const inputRef = useRef<HTMLInputElement>(null);

  const commit = (text: string) => {
    if (text.trim()) onChipsChange(addAlertRecipientEmails(chips, text));
    onDraftChange("");
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || SEPARATOR_KEYS.has(event.key)) {
      // Enter in an empty box submits the form; a separator there is ignored.
      if (!draft.trim()) {
        if (event.key !== "Enter") event.preventDefault();
        return;
      }
      event.preventDefault();
      commit(draft);
      return;
    }
    if (event.key === "Backspace" && draft === "" && chips.length > 0) {
      event.preventDefault();
      onChipsChange(chips.slice(0, -1));
      onDraftChange(chips[chips.length - 1]);
    }
  };

  // Covers mobile keyboards and autocomplete, which do not always send the separator keys.
  const handleChange = (value: string) => {
    if (!SEPARATOR_PATTERN.test(value)) {
      onDraftChange(value);
      return;
    }
    const lastSeparator = value.search(/[\s,;][^\s,;]*$/);
    onChipsChange(addAlertRecipientEmails(chips, value.slice(0, lastSeparator)));
    onDraftChange(value.slice(lastSeparator + 1));
  };

  const handlePaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const pasted = event.clipboardData.getData("text");
    if (!SEPARATOR_PATTERN.test(pasted.trim())) return;
    event.preventDefault();
    commit(`${draft} ${pasted}`);
  };

  const removeChip = (chip: string) => {
    onChipsChange(chips.filter((value) => value !== chip));
    inputRef.current?.focus();
  };

  return (
    // The box itself is not a control: a click on its empty space only moves focus to the text box.
    <div
      className={cn(
        "flex max-h-40 min-h-10 w-full cursor-text flex-wrap items-center gap-1.5 overflow-y-auto rounded-md border border-input bg-background px-2 py-1.5 text-sm ring-offset-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2",
        invalid && "border-destructive",
        disabled && "cursor-not-allowed opacity-50",
      )}
      onClick={() => inputRef.current?.focus()}
    >
      {chips.length > 0 && (
        // role="list": Safari drops list semantics from an element with display: contents.
        <ul role="list" className="contents" aria-label={t("RECIPIENT_DIALOG.EMAILS_LIST")}>
          {chips.map((chip) => {
            const rejected = !normalizeAlertRecipientEmail(chip) || isChipRejected(chip);
            return (
              <li
                key={chip}
                className={cn(
                  "inline-flex h-7 max-w-full items-center gap-1 rounded-full border pl-2.5 pr-1 text-xs",
                  rejected
                    ? "border-destructive/40 bg-destructive/10 text-destructive"
                    : "border-transparent bg-secondary text-secondary-foreground",
                )}
              >
                {rejected && <AlertCircle aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />}
                <span className="truncate" title={chip}>
                  {chip}
                </span>
                <button
                  type="button"
                  disabled={disabled}
                  aria-label={t("RECIPIENT_DIALOG.REMOVE_EMAIL", { email: chip })}
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full opacity-70 hover:bg-foreground/10 hover:opacity-100 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={(event) => {
                    event.stopPropagation();
                    removeChip(chip);
                  }}
                >
                  <X aria-hidden="true" className="h-3 w-3" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <input
        ref={inputRef}
        id={id}
        type="text"
        inputMode="email"
        autoComplete="off"
        disabled={disabled}
        placeholder={chips.length > 0 ? morePlaceholder : placeholder}
        value={draft}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        className="h-7 min-w-[10rem] flex-1 bg-transparent px-1 outline-hidden placeholder:text-muted-foreground disabled:cursor-not-allowed"
        onChange={(event) => handleChange(event.target.value)}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        onBlur={() => {
          commit(draft);
          onBlur();
        }}
      />
    </div>
  );
};

export default EmailChipsInput;
