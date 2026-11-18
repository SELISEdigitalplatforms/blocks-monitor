/** Share a scope document or screen designs: pick workspace members (they are notified and find it under "Shared with
 *  you" on Home), see who already has it, create a read-only external link (Share externally), or download it as a PDF. */
import { useId, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Download, X } from "lucide-react";
import { useMemberName, useMemberOptions } from "@/madp/blocks/projects/context";
import { NOT_CONFIGURED_MESSAGE, isNotConfigured, messageFor } from "@/madp/blocks/projects/messages";
import { useCreateShare, useDeleteShare } from "@/madp/blocks/projects/mutations";
import { useProjectShares } from "@/madp/blocks/projects/reads";
import { isBlocksProjectId } from "@/madp/domain/projects";
import { ExternalShareSection } from "@/madp/components/share/ExternalShareSection";
import { requestScopePdf, type PdfJob } from "@/madp/components/scope/ScopePrint";
import { ViewOnlyNote } from "@/madp/components/workspace/ViewOnlyNote";
import { viewerTip } from "@/madp/data/rbac";
import { cn } from "@/madp/lib/cn";
import { initialsOf, useCan, useMe, whenLabel, type ShareTarget } from "@/madp/state/workspaces";
import { Avatar, Button, Chip, IconButton, Modal } from "@/madp/ui/kit";
import { useT } from "@/madp/i18n";

const LABEL = "text-[12px] font-medium uppercase tracking-[0.06em] text-ink3";

function pdfJob(target: ShareTarget): PdfJob {
  return target.type === "screen" ? { type: "screen", screenId: target.ref } : { type: target.type };
}

type Props = { open: boolean; onClose: () => void; projectId: string; projectName: string; target: ShareTarget | null };
type Choice = { id: string; name: string; role?: string };
type Result = { ok: true } | { ok: false; error: string };
interface ViewProps extends Props {
  choices: Choice[];
  shares: { id: string; sharedWith: string; createdAt: string; name: ReactNode; role?: string; known: boolean; nameText?: string }[];
  /** Blocks projects may only offer members; local ones can send people to the team settings. */
  canInviteLink: boolean;
  create: (userIds: string[]) => Promise<Result>;
  remove: (shareId: string) => Promise<Result>;
}

const failure = (e: unknown): Result => ({ ok: false, error: isNotConfigured(e) ? NOT_CONFIGURED_MESSAGE : messageFor(e) });

export function ShareDialog(props: Props) {
  return isBlocksProjectId(props.projectId) ? <BlocksShareDialog {...props} /> : null;
}

function ShareeName({ userId }: { userId: string }) {
  return <>{useMemberName(userId)}</>;
}

function BlocksShareDialog(props: Props) {
  const { projectId, target } = props;
  const options = useMemberOptions();
  const query = useProjectShares(projectId, target?.type ?? "scope", target?.ref ?? "");
  const create = useCreateShare();
  const del = useDeleteShare();
  const shares = query.data ?? [];
  const sharedIds = new Set(shares.map((s) => s.sharedWithUserId));
  return (
    <ShareView {...props} canInviteLink={false}
      choices={options.filter((m) => !sharedIds.has(m.userId)).map((m) => ({ id: m.userId, name: m.name }))}
      shares={shares.map((s) => ({ id: s.id, sharedWith: s.sharedWithUserId, createdAt: "", name: <ShareeName userId={s.sharedWithUserId} />, known: true }))}
      create={async (userIds) => {
        if (!target) return { ok: true };
        try { await create.run({ projectId, itemType: target.type, itemRef: target.ref, userIds }); return { ok: true }; } catch (e) { return failure(e); }
      }}
      remove={async (shareId) => { try { await del.run({ projectId, shareId }); return { ok: true }; } catch (e) { return failure(e); } }} />
  );
}

function ShareView({ open, onClose, projectId, target, choices, shares, canInviteLink, create, remove }: ViewProps) {
  const t = useT();
  const me = useMe();
  const canShare = useCan("share");
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState("");
  const [error, setError] = useState("");
  const tipId = useId();
  // hooks stay above the early return: the dialog is mounted with no target until Share is clicked
  const sharing = useRef(false);
  const removing = useRef(new Set<string>());

  if (!target) return null;
  // an external link points at one stored item: without its ref the server refuses every link
  const externalType = !target.ref ? null : target.type === "scope" ? "scope" : target.type === "screen" ? "design.screen" : null;
  const isOwner = canInviteLink && me?.role === "owner";

  const toggle = (id: string) => {
    setDone("");
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  };
  const share = async () => {
    if (!picked.length || sharing.current) return;
    const n = picked.length;
    sharing.current = true;
    setBusy(true); setError(""); setDone("");
    const r = await create(picked);
    sharing.current = false;
    setBusy(false);
    if (r.ok) { setPicked([]); setDone(n === 1 ? t("shell.workspace.share.doneOne", "Shared with 1 member") : t("shell.workspace.share.doneMany", "Shared with {count} members", { count: n })); }
    else setError(r.error);
  };
  const stop = async (id: string) => {
    if (removing.current.has(id)) return;
    removing.current.add(id);
    setError(""); setDone("");
    const r = await remove(id);
    removing.current.delete(id);
    if (!r.ok) setError(r.error);
  };
  // the print host (BlocksScopePrint) renders the real scope records; the legacy static example scope is gone
  const canDownload = isBlocksProjectId(projectId);
  const download = () => {
    onClose();
    requestScopePdf(pdfJob(target));
  };

  return (
    <Modal open={open} onClose={onClose} width={560} title={t("shell.workspace.share.title", "Share {item}", { item: target.label })}
      footer={<Button variant="ghost" onClick={onClose}>{t("common.actions.done", "Done")}</Button>}>
      <div className="flex flex-col gap-6">
        <section aria-label={t("shell.workspace.share.withMembers", "Share with workspace members")}>
          <div className={LABEL}>{t("shell.workspace.share.withMembers", "Share with workspace members")}</div>
          <p className="mt-2 text-[13px] text-ink2">
            {t("shell.workspace.share.explain", "They get a notification and find it under Shared with you on Home, with their role's rights.")}
          </p>
          {choices.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {choices.map((m) => {
                const on = picked.includes(m.id);
                return (
                  <button key={m.id} type="button" aria-pressed={on} disabled={!canShare}
                    title={canShare ? undefined : viewerTip()} aria-describedby={canShare ? undefined : tipId}
                    onClick={() => toggle(m.id)}
                    className={cn("inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[13px] transition disabled:cursor-not-allowed disabled:opacity-45",
                      on ? "bg-accent-soft text-accent" : "bg-surface2 text-ink2")}>
                    <Avatar initials={initialsOf(m.name)} size={22} tone="soft" />
                    <span className="min-w-0 truncate">{m.name}</span>
                    {m.role && <span className="text-ink3">{m.role}</span>}
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="mt-3 text-[13px] text-ink3">
              {shares.length > 0 ? t("shell.workspace.share.everyoneAlready", "Already shared with everyone else in this workspace.") : t("shell.workspace.share.noOneElse", "No one else is in this workspace yet.")}{" "}
              {isOwner && <Link to="/settings#team" onClick={onClose} className="font-medium text-accent hover:underline">{t("shell.workspace.share.inviteMembers", "Invite members")}</Link>}
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button variant="primary" onClick={share} disabled={!canShare || !picked.length || busy}
              title={canShare ? undefined : viewerTip()} aria-describedby={canShare ? undefined : tipId}>
              {t("common.actions.share", "Share")}
            </Button>
            <span role="status" aria-live="polite" className="text-[13px] text-success">{done}</span>
          </div>
          {!canShare && <ViewOnlyNote id={tipId} className="mt-3" />}
          {error && <p role="alert" className="mt-2 text-[13px] text-danger">{error}</p>}
        </section>

        <section aria-label={t("shell.workspace.share.sharedWith", "Shared with")}>
          <div className={LABEL}>{t("shell.workspace.share.sharedWith", "Shared with")}</div>
          {shares.length === 0 ? (
            <p className="mt-2 text-[13px] text-ink3">{t("shell.workspace.share.notShared", "Not shared with anyone yet.")}</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-2">
              {shares.map((s) => {
                const name = s.nameText ?? t("shell.workspace.share.thisMember", "this member");
                return (
                  <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-block bg-surface2 px-3 py-2">
                    <Avatar initials={initialsOf(name)} size={28} tone="soft" />
                    <span className="min-w-0 truncate text-[14px] font-medium">{s.name}</span>
                    {s.role && <Chip>{s.role}</Chip>}
                    {s.createdAt && <span className="text-[12px] text-ink3">{whenLabel(s.createdAt)}</span>}
                    {canShare && (
                      <IconButton icon={<X size={16} strokeWidth={1.75} />} label={t("shell.workspace.share.stopSharing", "Stop sharing with {name}", { name })}
                        className="ml-auto !h-8 !w-8" onClick={() => stop(s.id)} />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {externalType && <ExternalShareSection projectId={projectId} itemType={externalType} itemRef={target.ref} itemLabel={target.label} />}

        {canDownload && <section className="flex flex-col items-start gap-2">
          <Button variant="ghost" icon={<Download size={16} strokeWidth={1.75} />} onClick={download}
            title={t("shell.workspace.share.pdfTitle", "Opens the print dialog: choose Save as PDF. The PDF is laid out on A4.")}>
            {t("shell.workspace.share.downloadPdf", "Download PDF")}
          </Button>
          <p className="text-[12px] text-ink3">
            {target.type === "scope" ? t("shell.workspace.share.pdfScope", "Objective, features and stories, what is out of scope, milestones and screens, on A4.") : t("shell.workspace.share.pdfScreens", "One page per screen.")}
          </p>
        </section>}

        <p className="text-[12px] text-ink3">
          {externalType
            ? t("shell.workspace.share.externalNote", "Workspace shares open only for members of this workspace; an external link shows a read-only preview to anyone who has it until it expires or is revoked.")
            : t("shell.workspace.share.membersOnly", "Only members of this workspace can open it.")}
        </p>
      </div>
    </Modal>
  );
}
