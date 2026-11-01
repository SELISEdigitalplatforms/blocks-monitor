import {
  Badge,
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/core";
import type { IAlertRecipient, IAlertRecipientMonitor } from "@/models/alert-recipients.model";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { countMonitors } from "./alert-recipients.utils";

/** Chips shown per row before "+K more" (#256 Q6). */
export const MAX_VISIBLE_CHIPS = 5;

type MonitorChipsProps = {
  names: string[];
};

const MonitorChips = ({ names }: MonitorChipsProps) => {
  const [expanded, setExpanded] = useState(false);
  const hidden = names.length - MAX_VISIBLE_CHIPS;
  const visible = expanded || hidden <= 0 ? names : names.slice(0, MAX_VISIBLE_CHIPS);
  return (
    <>
      {visible.map((name, index) => (
        <Badge
          // Names are not unique, so the position keeps the key stable.
          key={`${name}-${index}`} //nosonar
          variant="secondary"
          className="inline-flex rounded-full px-2.5 font-normal"
        >
          {name}
        </Badge>
      ))}
      {hidden > 0 && (
        // Stays in place as "Show less" once expanded, so keyboard focus is never dropped.
        <Button
          type="button"
          variant="link"
          size="sm"
          className="h-7 px-1"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "Show less" : `+${hidden} more`}
        </Button>
      )}
    </>
  );
};

type RecipientRowProps = {
  recipient: IAlertRecipient;
  monitorsById: ReadonlyMap<string, IAlertRecipientMonitor>;
  totalMonitors: number;
  isRemoving: boolean;
  onEdit: (recipient: IAlertRecipient) => void;
  onRemove: (recipient: IAlertRecipient) => void;
};

const RecipientRow = ({
  recipient,
  monitorsById,
  totalMonitors,
  isRemoving,
  onEdit,
  onRemove,
}: RecipientRowProps) => {
  const names = recipient.monitorIds
    .map((id) => monitorsById.get(id)?.name)
    .filter((name): name is string => !!name)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

  return (
    <TableRow>
      <TableCell className="py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden="true"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold text-primary"
          >
            {recipient.email.charAt(0).toUpperCase()}
          </span>
          <span className="break-all font-medium text-foreground">{recipient.email}</span>
        </div>
      </TableCell>
      <TableCell className="py-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {recipient.allMonitors ? (
            <>
              <Badge className="inline-flex rounded-full px-3">
                All monitors ({totalMonitors})
              </Badge>
              <span className="text-[13px] text-muted-foreground">New monitors too</span>
            </>
          ) : (
            <>
              <span className="mr-1 text-[13px] font-semibold text-foreground">
                {names.length === 0 ? "No monitors" : `${countMonitors(names.length)}:`}
              </span>
              <MonitorChips names={names} />
            </>
          )}
        </div>
      </TableCell>
      <TableCell className="py-3">
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label={`Edit ${recipient.email}`}
            onClick={() => onEdit(recipient)}
          >
            Edit
          </Button>
          {/* blocks-error-800 meets AA in both themes (about 9.7:1 light, 11.3:1 dark); --destructive does not. */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="text-blocks-error-800 hover:text-blocks-error-800"
            aria-label={`Remove ${recipient.email} from all monitors`}
            disabled={isRemoving}
            onClick={() => onRemove(recipient)}
          >
            {isRemoving && <Loader2 aria-hidden="true" className="mr-1 h-4 w-4 animate-spin" />}
            Remove
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
};

type RecipientsTableProps = {
  recipients: IAlertRecipient[];
  monitorsById: ReadonlyMap<string, IAlertRecipientMonitor>;
  totalMonitors: number;
  /** The email being removed, if any. */
  removingEmail: string | null;
  onEdit: (recipient: IAlertRecipient) => void;
  onRemove: (recipient: IAlertRecipient) => void;
};

/**
 * Recipient | Gets alerts for | Actions. The table keeps a 760 px minimum width and scrolls inside
 * its card on narrow screens, so the page itself never scrolls sideways.
 */
const RecipientsTable = ({
  recipients,
  monitorsById,
  totalMonitors,
  removingEmail,
  onEdit,
  onRemove,
}: RecipientsTableProps) => (
  <Table className="min-w-[760px]">
    <TableHeader>
      <TableRow>
        <TableHead className="w-[30%] text-foreground">Recipient</TableHead>
        <TableHead className="text-foreground">Gets alerts for</TableHead>
        <TableHead className="w-[180px] text-right text-foreground">Actions</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      {recipients.map((recipient) => (
        <RecipientRow
          key={recipient.email}
          recipient={recipient}
          monitorsById={monitorsById}
          totalMonitors={totalMonitors}
          isRemoving={removingEmail === recipient.email}
          onEdit={onEdit}
          onRemove={onRemove}
        />
      ))}
    </TableBody>
  </Table>
);

export default RecipientsTable;
