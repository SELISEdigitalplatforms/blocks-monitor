import type React from "react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { ChevronLeft, ChevronRight, KeyRound, MailPlus, MoreHorizontal, ShieldCheck, ShieldOff, UserCheck, UserPlus, UserX, Users } from "lucide-react";
import { Avatar, Button, Card, Chip, IconButton, Input, Label, MENU_ITEM, MENU_PANEL, Modal } from "@/madp/ui/kit";
import { Popover } from "@/madp/ui/popover";
import { cn } from "@/madp/lib/cn";
import { useSession } from "@/madp/blocks/session";
import {
  PEOPLE_PAGE_SIZE, deactivateGuard, demoteGuard, invitePerson, isSelf, listPeople, resendInvite, setSuperAdmin,
  type AdminResult, type PersonRow,
} from "@/madp/blocks/people";
import { deactivatePerson, reactivatePerson, type PersonChange } from "@/madp/blocks/admin";
import { CreateAccountDialog } from "@/madp/components/admin/CreateAccountDialog";
import { AccessRequestsList } from "@/madp/components/admin/AccessRequestsList";
import { useT } from "@/madp/i18n";

type Pending = { kind: "deactivate" | "demote"; row: PersonRow } | null;

const initials = (r: PersonRow) =>
  ((r.firstName[0] ?? "") + (r.lastName[0] ?? "") || r.email.slice(0, 2)).toUpperCase();

function RowMenu({ row, isMe, onResend, onActive, onAdmin }: {
  row: PersonRow; isMe: boolean; onResend: () => void; onActive: () => void; onAdmin: () => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => { if (open) panel.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus(); }, [open]);
  useEffect(() => {
    if (!open) return;
    const click = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!trigger.current?.contains(target) && !panel.current?.contains(target)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener("mousedown", click);
    window.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", click); window.removeEventListener("keydown", key); };
  }, [open]);

  const onKeyDown = (e: ReactKeyboardEvent) => {
    const items = [...(panel.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      items[e.key === "Home" ? 0 : items.length - 1]?.focus();
    } else if (e.key === "Tab") setOpen(false);
  };

  const selfTip = (msg: string) => (isMe ? msg : undefined);
  const items: { key: string; label: string; icon: React.JSX.Element; onClick: () => void; disabledReason?: string }[] = [
    { key: "resend", label: t("settings.people.resend", "Resend the invitation"), icon: <MailPlus size={16} strokeWidth={1.75} />, onClick: onResend },
    row.active
      ? { key: "active", label: t("settings.people.deactivate", "Deactivate"), icon: <UserX size={16} strokeWidth={1.75} />, onClick: onActive, disabledReason: selfTip(t("settings.people.cantDeactivateSelf", "You can't deactivate your own account.")) }
      : { key: "active", label: t("settings.people.reactivate", "Reactivate"), icon: <UserCheck size={16} strokeWidth={1.75} />, onClick: onActive },
    row.superAdmin
      ? { key: "admin", label: t("settings.people.removeSuperAdmin", "Remove Super admin"), icon: <ShieldOff size={16} strokeWidth={1.75} />, onClick: onAdmin, disabledReason: selfTip(t("settings.people.cantDemoteSelf", "You can't remove your own Super admin role.")) }
      : { key: "admin", label: t("settings.people.makeSuperAdmin", "Make Super admin"), icon: <ShieldCheck size={16} strokeWidth={1.75} />, onClick: onAdmin },
  ];

  return (
    <div>
      <IconButton ref={trigger} icon={<MoreHorizontal size={18} strokeWidth={1.75} />} label={t("settings.people.actionsFor", "Actions for {name}", { name: row.displayName })}
        aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} />
      {open && (
        <Popover anchorRef={trigger} panelRef={panel} placement="bottom-end" onClose={() => setOpen(false)} role="menu"
          aria-label={t("settings.people.actionsFor", "Actions for {name}", { name: row.displayName })} onKeyDown={onKeyDown} className={cn(MENU_PANEL, "w-64")}>
          {items.map((it) => (
            <button key={it.key} type="button" role="menuitem" title={it.disabledReason} aria-disabled={it.disabledReason ? true : undefined}
              className={cn(MENU_ITEM, "items-center", it.disabledReason && "cursor-not-allowed opacity-60")}
              onClick={() => { if (it.disabledReason) return; setOpen(false); it.onClick(); }}>
              {it.icon} {it.label}
            </button>
          ))}
          {isMe && <p className="px-3 pb-1 pt-2 text-[12px] text-ink3">{t("settings.people.selfActionsOff", "Some actions are off for your own account.")}</p>}
        </Popover>
      )}
    </div>
  );
}

function InviteDialog({ open, onClose, onDone, initialEmail = "" }: {
  open: boolean; onClose: () => void; onDone: (r: AdminResult) => void; initialEmail?: string;
}) {
  const t = useT();
  const [email, setEmail] = useState(initialEmail);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  useEffect(() => { if (open) { setEmail(initialEmail); setFirstName(""); setLastName(""); setError(null); } }, [open, initialEmail]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    let r: AdminResult;
    try { r = await invitePerson({ email, firstName, lastName }); } finally { inFlight.current = false; }
    setBusy(false);
    if (r.ok) { onDone(r); onClose(); } else setError(r.error);
  };

  return (
    <Modal open={open} onClose={() => { if (!busy) onClose(); }} title={t("settings.people.inviteTitle", "Invite person")} width={520}>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <div>
          <Label>{t("settings.people.email", "Email")}</Label>
          <Input type="email" autoComplete="off" autoFocus value={email} maxLength={254} onChange={(e) => setEmail(e.target.value)} aria-label={t("settings.people.email", "Email")} placeholder={t("settings.people.emailPlaceholder", "name@company.com")} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label>{t("settings.people.firstName", "First name")}</Label>
            <Input value={firstName} maxLength={60} onChange={(e) => setFirstName(e.target.value)} aria-label={t("settings.people.firstName", "First name")} />
          </div>
          <div>
            <Label>{t("settings.people.lastName", "Last name")}</Label>
            <Input value={lastName} maxLength={60} onChange={(e) => setLastName(e.target.value)} aria-label={t("settings.people.lastName", "Last name")} />
          </div>
        </div>
        {error && <p role="alert" className="text-[13px] text-danger [overflow-wrap:anywhere]">{error}</p>}
        <div className="flex flex-wrap justify-end gap-3">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>{t("settings.people.cancel", "Cancel")}</Button>
          <Button type="submit" variant="primary" disabled={busy} icon={<UserPlus size={16} strokeWidth={1.75} />}>{t("settings.people.sendInvitation", "Send invitation")}</Button>
        </div>
      </form>
    </Modal>
  );
}

/** onOpenAccess: when given, each person gets an "Access" button (Platform → People opens their roles and organizations). */
export function PeopleCard({ onOpenAccess }: { onOpenAccess?: (row: PersonRow) => void } = {}) {
  const t = useT();
  const isAdmin = useSession((s) => !!s.profile?.isSuperAdmin);
  const me = useSession((s) => s.profile);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<PersonRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [result, setResult] = useState<AdminResult | null>(null);
  const [inviting, setInviting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [warning, setWarning] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const confirmInFlight = useRef(false);
  const seq = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(() => { setQuery(search.trim()); setPage(1); }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const load = useCallback(async () => {
    const id = ++seq.current;
    setLoading(true);
    const r = await listPeople({ page, search: query });
    if (id !== seq.current) return;
    setLoading(false);
    if (r.ok) { setRows(r.rows); setTotal(r.total); setLoadError(null); } else setLoadError(r.error);
  }, [page, query]);

  useEffect(() => { if (isAdmin) void load(); }, [isAdmin, load]);

  if (!isAdmin) return null;

  const pages = Math.max(1, Math.ceil(total / PEOPLE_PAGE_SIZE));
  const report = (r: AdminResult | PersonChange) => { setResult(r); setWarning("warning" in r && r.warning ? r.warning : null); if (r.ok) void load(); };

  const run = async (fn: () => Promise<AdminResult | PersonChange>) => { report(await fn()); };

  const confirm = async () => {
    if (!pending || busy || confirmInFlight.current) return;
    confirmInFlight.current = true;
    setBusy(true);
    setConfirmError(null);
    let r: AdminResult | PersonChange;
    try {
      r = pending.kind === "deactivate" ? await deactivatePerson(pending.row) : await setSuperAdmin(pending.row, false);
    } finally { confirmInFlight.current = false; }
    setBusy(false);
    if (r.ok) { setPending(null); report(r); } else setConfirmError(r.error);
  };

  return (
    <div id="people" tabIndex={-1} className="scroll-mt-6 outline-none">
      <Card title={t("settings.people.title", "People")} icon={<Users size={18} strokeWidth={1.75} />} bodyClassName="flex flex-col gap-4"
        action={<div className="flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" icon={<KeyRound size={16} strokeWidth={1.75} />}
            onClick={() => { setResult(null); setCreating(true); }}>{t("settings.people.createAccount", "Create account")}</Button>
          <Button size="sm" variant="primary" icon={<UserPlus size={16} strokeWidth={1.75} />}
            onClick={() => { setResult(null); setInviteEmail(""); setInviting(true); }}>{t("settings.people.inviteTitle", "Invite person")}</Button>
        </div>}>
        <p className="max-w-[68ch] text-[14px] text-ink2">
          {t("settings.people.intro", "Everyone who can sign in. Invite someone by e-mail and they get a link to set their password, or create an account with a temporary password you share yourself.")}
        </p>
        <Input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("settings.people.searchPlaceholder", "Search by name or email")} aria-label={t("settings.people.searchLabel", "Search people")} maxLength={100} />
        {result && (result.ok
          ? <p role="status" className="text-[13px] text-ink2 [overflow-wrap:anywhere]">{result.message}</p>
          : <p role="alert" className="text-[13px] text-danger [overflow-wrap:anywhere]">{result.error}</p>)}
        {warning && <p role="status" className="text-[13px] text-[rgb(var(--c-warning-text))] [overflow-wrap:anywhere]">{warning}</p>}
        {loadError && <p role="alert" className="text-[13px] text-danger [overflow-wrap:anywhere]">{loadError}</p>}
        {!loadError && !loading && rows.length === 0 && <p className="text-[14px] text-ink3">{query ? t("settings.people.noMatch", "No one matches that search.") : t("settings.people.empty", "No one can sign in yet. Invite the first person.")}</p>}
        <ul className="flex flex-col gap-3" aria-busy={loading}>
          {rows.map((r) => {
            const isMe = isSelf(me, r);
            return (
              <li key={r.userId} className="flex flex-col gap-3 rounded-block bg-surface2 px-4 py-3 sm:flex-row sm:items-center">
                <Avatar initials={initials(r)} size={36} tone={isMe ? "accent" : "soft"} />
                <div className="min-w-0">
                  <div className="text-[14px] font-medium [overflow-wrap:anywhere]">{isMe ? t("settings.people.nameYou", "{name} (you)", { name: r.displayName }) : r.displayName}</div>
                  <div className="text-[13px] text-ink3 [overflow-wrap:anywhere]">{r.email}</div>
                </div>
                <div className="flex flex-wrap items-center gap-3 sm:ml-auto">
                  {r.superAdmin && <Chip tone="accent">{t("settings.people.superAdmin", "Super admin")}</Chip>}
                  {!r.active && <Chip tone="warning">{t("settings.people.deactivated", "Deactivated")}</Chip>}
                  {onOpenAccess && (
                    <Button size="sm" variant="ghost" aria-label={t("settings.people.openAccess", "Open {name}'s access", { name: r.displayName })} onClick={() => onOpenAccess(r)}>{t("settings.people.access", "Access")}</Button>
                  )}
                  <RowMenu row={r} isMe={isMe}
                    onResend={() => void run(() => resendInvite(r))}
                    onActive={() => {
                      if (!r.active) { void run(() => reactivatePerson(r)); return; }
                      const g = deactivateGuard({ me, target: r, superAdminCount: 2 });
                      if (g) { setResult({ ok: false, error: g }); return; }
                      setConfirmError(null); setPending({ kind: "deactivate", row: r });
                    }}
                    onAdmin={() => {
                      if (!r.superAdmin) { void run(() => setSuperAdmin(r, true)); return; }
                      const g = demoteGuard({ me, target: r, superAdminCount: 2 });
                      if (g) { setResult({ ok: false, error: g }); return; }
                      setConfirmError(null); setPending({ kind: "demote", row: r });
                    }} />
                </div>
              </li>
            );
          })}
        </ul>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-[13px] text-ink3">{t("settings.people.pageOf", "Page {page} of {pages}", { page, pages })}</span>
          <div className="flex gap-3">
            <Button size="sm" variant="ghost" icon={<ChevronLeft size={16} strokeWidth={1.75} />} disabled={page <= 1 || loading} onClick={() => setPage(page - 1)}>{t("settings.people.previous", "Previous")}</Button>
            <Button size="sm" variant="ghost" iconRight={<ChevronRight size={16} strokeWidth={1.75} />} disabled={page >= pages || loading} onClick={() => setPage(page + 1)}>{t("settings.people.next", "Next")}</Button>
          </div>
        </div>
        <AccessRequestsList onCreateAccount={(email) => { setResult(null); setInviteEmail(email); setInviting(true); }} />
      </Card>
      <CreateAccountDialog open={creating} onClose={() => setCreating(false)} onCreated={(m) => report({ ok: true, message: m })} />
      <InviteDialog open={inviting} onClose={() => setInviting(false)} onDone={report} initialEmail={inviteEmail} />
      <Modal open={!!pending} onClose={() => { if (!busy) setPending(null); }} width={480}
        title={pending ? (pending.kind === "deactivate"
          ? t("settings.people.deactivateTitle", "Deactivate {name}?", { name: pending.row.displayName })
          : t("settings.people.demoteTitle", "Remove Super admin from {name}?", { name: pending.row.displayName })) : ""}
        footer={<>
          <Button variant="ghost" onClick={() => setPending(null)} disabled={busy}>{t("settings.people.cancel", "Cancel")}</Button>
          <Button variant="danger" disabled={busy} onClick={confirm}>{pending?.kind === "deactivate" ? t("settings.people.deactivate", "Deactivate") : t("settings.people.removeSuperAdmin", "Remove Super admin")}</Button>
        </>}>
        <p className="text-[14px] text-ink2">
          {pending?.kind === "deactivate"
            ? t("settings.people.deactivateText", "They can no longer sign in until you reactivate them.")
            : t("settings.people.demoteText", "They keep their account but can no longer manage people.")}
        </p>
        {confirmError && <p role="alert" className="mt-3 text-[13px] text-danger [overflow-wrap:anywhere]">{confirmError}</p>}
      </Modal>
    </div>
  );
}
