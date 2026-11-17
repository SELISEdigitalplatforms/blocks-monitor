import { UserPlus } from "lucide-react";
import { Button, EmptyState } from "@/ui/kit";
import { adminErrorMessage, useAccessRequests } from "@/blocks/admin";
import { useT } from "@/i18n";

function when(at: string): string {
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? at : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** People a workspace admin invited who have no account yet: a platform admin creates it. */
export function AccessRequestsList({ onCreateAccount }: { onCreateAccount: (email: string) => void }) {
  const t = useT();
  const q = useAccessRequests();
  const items = q.data?.items ?? [];

  return (
    <section aria-labelledby="access-requests-title" className="flex flex-col gap-3">
      <h3 id="access-requests-title" className="font-display text-[16px] font-semibold">{t("platform.admin.accessRequests.title", "Waiting for an account")}</h3>
      {q.error ? (
        <p role="alert" className="text-[13px] text-danger [overflow-wrap:anywhere]">{adminErrorMessage(q.error)}</p>
      ) : q.isPending ? (
        <div aria-busy="true" aria-label={t("platform.admin.accessRequests.loading", "Loading the people waiting for an account")} className="h-16 rounded-block bg-surface2" />
      ) : items.length === 0 ? (
        <EmptyState icon={<UserPlus size={18} strokeWidth={1.75} />} title={t("platform.admin.accessRequests.emptyTitle", "No one is waiting")}
          text={t("platform.admin.accessRequests.emptyText", "When a workspace admin invites someone who has no account yet, they appear here.")} />
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((r) => (
            <li key={r.invitationId} className="flex flex-col gap-3 rounded-block bg-surface2 px-4 py-3 sm:flex-row sm:items-center">
              <div className="min-w-0">
                <div className="text-[14px] font-medium [overflow-wrap:anywhere]">{r.email}</div>
                <div className="text-[13px] text-ink3 [overflow-wrap:anywhere]">
                  {t("platform.admin.accessRequests.invitedLine", "{workspace} · invited by {name} · {when}", { workspace: r.workspaceName, name: r.invitedByName || t("platform.admin.accessRequests.aWorkspaceAdmin", "a workspace admin"), when: when(r.invitedAt) })}
                </div>
              </div>
              <Button size="sm" variant="secondary" className="sm:ml-auto" icon={<UserPlus size={16} strokeWidth={1.75} />}
                aria-label={t("platform.admin.accessRequests.createFor", "Create the account for {email}", { email: r.email })} onClick={() => onCreateAccount(r.email)}>{t("platform.admin.accessRequests.create", "Create the account")}</Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
