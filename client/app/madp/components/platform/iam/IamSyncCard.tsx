import { useState } from "react";
import { ArrowLeftRight, RefreshCw, SearchCheck } from "lucide-react";
import { Button, Card, Chip, Modal, Segmented } from "@/madp/ui/kit";
import { useIamSync, useSetRbacSource, type IamStatus, type IamSyncAnswer, type RbacSource } from "@/madp/blocks/iam";
import { formatDateTime } from "@/madp/lib/dates";
import { t, useT } from "@/madp/i18n";

/** Product names: not translated. */
const SOURCE_LABEL: Record<RbacSource, string> = { factory: "MADP Factory", iam: "Blocks OS IAM" };

function connection(status: IamStatus): { tone: "success" | "warning" | "neutral"; text: string } {
  if (status.available) return { tone: "success", text: t("platform.iam.sync.connected", "Connected") };
  if (status.unavailable === "not-connected") return { tone: "neutral", text: t("platform.iam.sync.notConnected", "Not connected on this server") };
  if (status.unavailable === "refused") return { tone: "warning", text: t("platform.iam.sync.refused", "Refused the platform's service account") };
  return { tone: "warning", text: t("platform.iam.sync.unreachable", "Can't be reached right now") };
}

type Counted = "difference" | "change" | "permission" | "role" | "organization" | "person";
/** "1 difference", "3 differences": one key for one, one for several, so each language words both. */
function count(n: number, what: Counted): string {
  const one = n === 1;
  switch (what) {
    case "difference": return one ? t("platform.iam.sync.count.differenceOne", "{n} difference", { n }) : t("platform.iam.sync.count.differenceMany", "{n} differences", { n });
    case "change": return one ? t("platform.iam.sync.count.changeOne", "{n} change", { n }) : t("platform.iam.sync.count.changeMany", "{n} changes", { n });
    case "permission": return one ? t("platform.iam.sync.count.permissionOne", "{n} permission", { n }) : t("platform.iam.sync.count.permissionMany", "{n} permissions", { n });
    case "role": return one ? t("platform.iam.sync.count.roleOne", "{n} role", { n }) : t("platform.iam.sync.count.roleMany", "{n} roles", { n });
    case "organization": return one ? t("platform.iam.sync.count.organizationOne", "{n} organization", { n }) : t("platform.iam.sync.count.organizationMany", "{n} organizations", { n });
    case "person": return one ? t("platform.iam.sync.count.personOne", "{n} person", { n }) : t("platform.iam.sync.count.personMany", "{n} people", { n });
  }
}

/** IAM sync: the connection, how far IAM is out of step, Check (the plan only) and Sync now, and where roles are managed. */
export function IamSyncCard({ status, canCheck }: { status: IamStatus; canCheck: boolean }) {
  const t = useT();
  const sync = useIamSync();
  const setSource = useSetRbacSource();
  const [result, setResult] = useState<IamSyncAnswer | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [switching, setSwitching] = useState<RbacSource | null>(null);
  const conn = connection(status);
  const drift = status.drift?.total ?? null;
  const checked = formatDateTime(status.sync?.checkedAt);
  const synced = formatDateTime(status.sync?.syncedAt);

  const run = async (dryRun: boolean) => {
    setNote(null);
    try {
      const out = await sync.mutateAsync({ dryRun });
      setResult(out);
      setNote(dryRun
        ? { ok: true, text: out.plan.drift === 0
          ? t("platform.iam.sync.inStep", "Blocks OS IAM is in step with the Factory.")
          : t("platform.iam.sync.foundNothingChanged", "{differences} found. Nothing was changed.", { differences: count(out.plan.drift, "difference") }) }
        : { ok: out.failed === 0, text: out.failed === 0
          ? t("platform.iam.sync.synced", "Synced: {changes} made in Blocks OS IAM.", { changes: count(out.applied, "change") })
          : t("platform.iam.sync.partlySynced", "{changes} made; {failed} could not be made. Run Check again.", { changes: count(out.applied, "change"), failed: out.failed }) });
    } catch (e) {
      setNote({ ok: false, text: e instanceof Error ? e.message : t("platform.iam.sync.genericError", "Something went wrong. Please try again.") });
    }
  };

  const confirmSwitch = async () => {
    if (!switching) return;
    setNote(null);
    try {
      await setSource.mutateAsync({ source: switching });
      setNote({ ok: true, text: t("platform.iam.sync.switched", "Roles and permissions are now managed in {source}.", { source: SOURCE_LABEL[switching] }) });
    } catch (e) {
      setNote({ ok: false, text: e instanceof Error ? e.message : t("platform.iam.sync.genericError", "Something went wrong. Please try again.") });
    }
    setSwitching(null);
  };

  const parityAt = formatDateTime(status.parity?.at);
  return (
    <Card title={t("platform.iam.sync.title", "IAM sync")} icon={<RefreshCw size={18} strokeWidth={1.75} />} action={<Chip tone={conn.tone}>{conn.text}</Chip>} bodyClassName="flex flex-col gap-4">
      <dl className="grid gap-3 text-[14px] sm:grid-cols-2 xl:grid-cols-4">
        <div className="flex flex-col gap-0.5">
          <dt className="text-[12px] font-medium uppercase tracking-wider text-ink3">{t("platform.iam.sync.managedIn", "Managed in")}</dt>
          <dd className="font-medium">{SOURCE_LABEL[status.source]}</dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-[12px] font-medium uppercase tracking-wider text-ink3">{t("platform.iam.sync.outOfStep", "Out of step")}</dt>
          <dd className="font-medium">{drift === null ? t("platform.iam.sync.driftUnknown", "Unknown until IAM answers") : drift === 0 ? t("platform.iam.sync.driftNone", "Nothing") : count(drift, "difference")}</dd>
          {status.drift && drift !== 0 && (
            <dd className="text-[13px] text-ink2">
              {count(status.drift.permissions, "permission")}, {count(status.drift.roles, "role")}, {count(status.drift.organizations, "organization")}
            </dd>
          )}
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-[12px] font-medium uppercase tracking-wider text-ink3">{t("platform.iam.sync.lastCheck", "Last check")}</dt>
          <dd>{checked || t("platform.iam.sync.notChecked", "Not checked yet")}</dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-[12px] font-medium uppercase tracking-wider text-ink3">{t("platform.iam.sync.lastSync", "Last sync")}</dt>
          <dd>{synced || t("platform.iam.sync.notSynced", "Not synced yet")}</dd>
        </div>
      </dl>
      <p className="text-[13px] text-ink2">
        {t("platform.iam.sync.explain", "Out of step counts roles, permissions and organizations. Check also compares each person's roles and shows the plan without changing anything; Sync now makes the changes in Blocks OS IAM.")}
      </p>
      {note && <p role={note.ok ? "status" : "alert"} className={note.ok ? "text-[13px] text-ink2" : "text-[13px] text-danger"}>{note.text}</p>}
      {(canCheck || status.canSync) && (
        <div className="flex flex-wrap gap-2">
          {canCheck && (
            <Button variant="secondary" icon={<SearchCheck size={16} strokeWidth={1.75} />} disabled={sync.isPending || !status.available}
              aria-busy={sync.isPending} onClick={() => void run(true)}>{t("platform.iam.sync.check", "Check")}</Button>
          )}
          {status.canSync && (
            <Button variant="primary" icon={<RefreshCw size={16} strokeWidth={1.75} />} disabled={sync.isPending || !status.available}
              onClick={() => void run(false)}>{t("platform.iam.sync.syncNow", "Sync now")}</Button>
          )}
        </div>
      )}
      {!status.canSync && <p className="text-[13px] text-ink3">{t("platform.iam.sync.adminsOnly", "Syncing and changing where roles are managed is for platform admins.")}</p>}
      {result && <SyncPlan answer={result} />}

      <section aria-label={t("platform.iam.sync.whereManaged", "Where roles are managed")} className="flex flex-col gap-2 border-t border-line pt-4">
        <h4 className="flex items-center gap-2 text-[14px] font-medium"><ArrowLeftRight size={16} strokeWidth={1.75} aria-hidden />{t("platform.iam.sync.whereManaged", "Where roles are managed")}</h4>
        {status.canSync ? (
          <Segmented label={t("platform.iam.sync.whereManaged", "Where roles are managed")} value={status.source}
            onChange={(v) => { if (v !== status.source) setSwitching(v); }}
            options={[{ value: "factory", label: SOURCE_LABEL.factory }, { value: "iam", label: SOURCE_LABEL.iam }]} />
        ) : <p className="text-[14px]">{SOURCE_LABEL[status.source]}</p>}
        <p className="text-[13px] text-ink2">
          {status.parity?.at
            ? <>{status.parity.ok
              ? t("platform.iam.sync.parityMatched", "Parity check {at}: everyone's access matched.", { at: parityAt })
              : t("platform.iam.sync.parityFound", "Parity check {at}: {differences} found.", { at: parityAt, differences: count(status.parity.mismatches ?? 0, "difference") })}{" "}</>
            : <>{t("platform.iam.sync.noParity", "No parity check has run yet.")} </>}
          {status.parity?.url && <a className="text-[rgb(var(--c-accent-text))] underline underline-offset-2" href={status.parity.url} target="_blank" rel="noreferrer">{t("platform.iam.sync.openParity", "Open the parity check result")}</a>}
        </p>
      </section>

      <Modal open={switching !== null} onClose={() => setSwitching(null)}
        title={switching === "iam" ? t("platform.iam.sync.switchToIamTitle", "Manage roles in Blocks OS IAM?") : t("platform.iam.sync.switchToFactoryTitle", "Manage roles in MADP Factory?")}
        footer={(
          <>
            <Button variant="ghost" onClick={() => setSwitching(null)}>{t("platform.iam.sync.cancel", "Cancel")}</Button>
            <Button variant="primary" disabled={setSource.isPending || (switching === "iam" && !status.available)} onClick={() => void confirmSwitch()}>
              {switching === "iam" ? t("platform.iam.sync.useIam", "Use Blocks OS IAM") : t("platform.iam.sync.useFactory", "Use MADP Factory")}
            </Button>
          </>
        )}>
        <div className="flex flex-col gap-3 text-[14px] text-ink2">
          {switching === "iam" ? (
            <>
              <p>{t("platform.iam.sync.switchToIamText", "From now on what each person may do is read from Blocks OS IAM. Changes made here are saved to IAM first and kept in the Factory too, so you can switch back.")}</p>
              <p>{t("platform.iam.sync.switchToIamWarning", "Anything out of step changes what people can do the moment you switch. Run Check, and look at the parity check result, first.")}</p>
              {drift !== null && drift > 0 && <p className="text-warning">{t("platform.iam.sync.outOfStepNow", "IAM is out of step right now: {differences}.", { differences: count(drift, "difference") })}</p>}
              {!status.available && <p className="text-danger">{t("platform.iam.sync.switchUnavailable", "Blocks OS IAM can't be reached, so the switch is not possible right now.")}</p>}
            </>
          ) : (
            <p>{t("platform.iam.sync.switchToFactoryText", "What each person may do is read from the Factory again. Changes made while IAM was the source were kept in the Factory, so nothing is lost.")}</p>
          )}
        </div>
      </Modal>
    </Card>
  );
}

function SyncPlan({ answer }: { answer: IamSyncAnswer }) {
  const t = useT();
  const p = answer.plan;
  const rows: { label: string; items: string[] }[] = [
    { label: t("platform.iam.plan.permissionsToAdd", "Permissions to add"), items: p.permissions.create },
    { label: t("platform.iam.plan.rolesToAdd", "Roles to add"), items: p.roles.create.map((r) => r.name) },
    { label: answer.source === "iam" ? t("platform.iam.plan.rolesDiffer", "Roles that differ (IAM is kept)") : t("platform.iam.plan.rolesToUpdate", "Roles to update"), items: p.roles.update.map((r) => r.name) },
    { label: t("platform.iam.plan.rolesOnlyInIam", "Roles only in IAM (kept)"), items: p.roles.onlyInIam },
    { label: t("platform.iam.plan.organizationsToAdd", "Organizations to add"), items: p.organizations.create.map((o) => o.name) },
    { label: t("platform.iam.plan.grantsToAdd", "Role grants to add"), items: p.grants.add.map((g) => `${g.email || g.userId}: ${g.roles.join(", ")}`) },
    { label: answer.source === "iam" ? t("platform.iam.plan.grantsOnlyInIam", "Grants only in IAM (kept)") : t("platform.iam.plan.grantsToRemove", "Role grants to remove"), items: p.grants.remove.map((g) => `${g.email || g.userId}: ${g.roles.join(", ")}`) },
  ];
  return (
    <section aria-label={answer.dryRun ? t("platform.iam.plan.checkResult", "Check result") : t("platform.iam.plan.syncResult", "Sync result")} className="flex flex-col gap-2 rounded-block bg-surface2 px-4 py-3">
      <h4 className="text-[14px] font-medium">{answer.dryRun ? t("platform.iam.plan.wouldChange", "What Sync now would change") : t("platform.iam.plan.changed", "What was changed")}</h4>
      <ul className="flex flex-col gap-1.5 text-[13px]">
        {rows.map((r) => (
          <li key={r.label}>
            {r.items.length === 0 ? (
              <span className="text-ink2">{t("platform.iam.plan.none", "{label}: none", { label: r.label })}</span>
            ) : (
              <details>
                <summary className="cursor-pointer text-ink">{t("platform.iam.plan.countLine", "{label}: {n}", { label: r.label, n: r.items.length })}</summary>
                <ul className="mt-1 flex flex-col gap-0.5 pl-4 text-ink2">
                  {r.items.slice(0, 50).map((x, i) => <li key={`${x}-${i}`} className="[overflow-wrap:anywhere]">{x}</li>)}
                  {r.items.length > 50 && <li>{t("platform.iam.plan.andMore", "and {n} more", { n: r.items.length - 50 })}</li>}
                </ul>
              </details>
            )}
          </li>
        ))}
      </ul>
      {p.grants.peopleNotChecked > 0 && (
        <p className="text-[13px] text-ink2">{t("platform.iam.plan.partlyCompared", "One run compares {people}; {n} more were not compared.", { people: count(p.grants.peopleChecked, "person"), n: p.grants.peopleNotChecked })}</p>
      )}
    </section>
  );
}
