/** "Share externally" in the share dialog: create a read-only link for one item (expires in 1, 7 or 30 days), copy it
 *  once, see the existing links and revoke them. The token lives only in this component's state. */
import { useRef, useState } from "react";
import { Copy, Link2, Link2Off } from "lucide-react";
import { useCan, useMemberName } from "@/madp/blocks/projects/context";
import { useCreateShareLink, useRevokeShareLink, useShareLinks, shareLinkError } from "@/madp/blocks/share/links";
import { SHARE_LINK_DEFAULT_DAYS, SHARE_LINK_EXPIRY_DAYS, shareLinkUrl, type ShareLinkExpiryDays, type ShareLinkItemType, type ShareLinkView } from "@/madp/blocks/share/types";
import { formatDateTime } from "@/madp/lib/dates";
import { cn } from "@/madp/lib/cn";
import { Button, IconButton, Input } from "@/madp/ui/kit";
import { useT } from "@/madp/i18n";

const LABEL = "text-[12px] font-medium uppercase tracking-[0.06em] text-ink3";

type Props = { projectId: string; itemType: ShareLinkItemType; itemRef: string; itemLabel: string };

function CreatedBy({ userId }: { userId: string }) {
  return <>{useMemberName(userId)}</>;
}

export function ExternalShareSection({ projectId, itemType, itemRef, itemLabel }: Props) {
  const can = useCan("items.shareExternal");
  if (!can) return null;
  return <Section projectId={projectId} itemType={itemType} itemRef={itemRef} itemLabel={itemLabel} />;
}

function Section({ projectId, itemType, itemRef, itemLabel }: Props) {
  const t = useT();
  const query = useShareLinks(projectId, itemType, itemRef, true);
  const create = useCreateShareLink();
  const revoke = useRevokeShareLink();
  const [days, setDays] = useState<ShareLinkExpiryDays>(SHARE_LINK_DEFAULT_DAYS);
  const [token, setToken] = useState<string | null>(null);
  const [lostToken, setLostToken] = useState(false);
  const [done, setDone] = useState("");
  // revoking cuts off everyone who holds the link at once: a second click confirms it
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const creating = useRef(false);
  const revoking = useRef(new Set<string>());
  const field = useRef<HTMLDivElement>(null);
  const links: ShareLinkView[] = query.data ?? [];

  const make = async () => {
    if (creating.current) return;
    creating.current = true;
    setBusy(true); setError(""); setDone(""); setToken(null); setLostToken(false);
    try {
      const r = await create.run({ projectId, itemType, itemRef, expiresInDays: days });
      if (r.token) { setToken(r.token); setDone(t("settings.share.external.created", "Link created. Copy it now: it is shown only once.")); }
      else setLostToken(true);
    } catch (e) {
      setError(shareLinkError(e));
    } finally {
      creating.current = false;
      setBusy(false);
    }
  };
  const copy = async () => {
    if (!token) return;
    setError("");
    try {
      await navigator.clipboard.writeText(shareLinkUrl(token));
      setDone(t("settings.share.external.copied", "Link copied."));
    } catch {
      field.current?.querySelector("input")?.select();
      setDone(t("settings.share.external.copyManually", "Copy the link from the field."));
    }
  };
  const stop = async (shareLinkId: string) => {
    if (revoking.current.has(shareLinkId)) return;
    revoking.current.add(shareLinkId);
    setError(""); setDone("");
    try {
      await revoke.run({ projectId, shareLinkId });
      setConfirmId(null);
      setDone(t("settings.share.external.revoked", "Link revoked."));
    } catch (e) {
      setError(shareLinkError(e));
    } finally {
      revoking.current.delete(shareLinkId);
    }
  };

  return (
    <section aria-label={t("settings.share.external.title", "Share externally")} className="min-w-0">
      <div className={LABEL}>{t("settings.share.external.title", "Share externally")}</div>
      <p className="mt-2 text-[13px] text-ink2">
        {t("settings.share.external.intro", "Anyone with the link sees a read-only preview, without signing in, until it expires or you revoke it.")}
      </p>
      <div role="radiogroup" aria-label={t("settings.share.external.expiresAfter", "Link expires after")} className="mt-3 flex flex-wrap gap-2">
        {SHARE_LINK_EXPIRY_DAYS.map((d) => (
          <button key={d} type="button" role="radio" aria-checked={days === d} onClick={() => setDays(d)}
            className={cn("inline-flex items-center rounded-full px-3 py-1.5 text-[13px] transition",
              days === d ? "bg-accent-soft text-accent" : "bg-surface2 text-ink2")}>
            {d === 1 ? t("settings.share.external.oneDay", "1 day") : t("settings.share.external.days", "{n} days", { n: d })}
          </button>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button variant="secondary" icon={<Link2 size={16} strokeWidth={1.75} />} onClick={make} disabled={busy}
          title={t("settings.share.external.createFor", "Create a link for {item}", { item: itemLabel })}>
          {t("settings.share.external.create", "Create link")}
        </Button>
      </div>
      {token && (
        <div ref={field} className="mt-3 flex min-w-0 items-center gap-2">
          <Input readOnly aria-label={t("settings.share.external.linkField", "External link")} value={shareLinkUrl(token)}
            onFocus={(e) => e.currentTarget.select()} className="min-w-0 flex-1 break-all" />
          <IconButton icon={<Copy size={16} strokeWidth={1.75} />} label={t("settings.share.external.copy", "Copy link")} onClick={copy} />
        </div>
      )}
      {lostToken && (
        <p role="alert" className="mt-2 text-[13px] text-danger">
          {t("settings.share.external.lostToken", "The link was created, but it can be shown only once. Revoke it and create a new one.")}
        </p>
      )}
      <p role="status" aria-live="polite" className="mt-2 text-[13px] text-success">{done}</p>
      {error && <p role="alert" className="mt-2 text-[13px] text-danger">{error}</p>}

      {query.isLoading ? (
        <p className="mt-3 text-[13px] text-ink3">{t("settings.share.external.loading", "Loading links…")}</p>
      ) : query.error ? (
        <p role="alert" className="mt-3 text-[13px] text-danger">{shareLinkError(query.error)}</p>
      ) : links.length === 0 ? (
        <p className="mt-3 text-[13px] text-ink3">{t("settings.share.external.empty", "No external links yet.")}</p>
      ) : (
        <ul aria-label={t("settings.share.external.list", "External links")} className="mt-3 flex flex-col gap-2">
          {links.map((l) => (
            <li key={l.id} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-block bg-surface2 px-3 py-2">
              <div className="min-w-0 flex-1 text-[13px]">
                <div className="break-words">{t("settings.share.external.createdBy", "Created by")} <CreatedBy userId={l.createdByUserId} /> · {formatDateTime(l.createdDate)}</div>
                <div className="break-words text-ink3">
                  {t("settings.share.external.expires", "Expires {when}", { when: formatDateTime(l.expiresAt) })} · {l.viewCount === 1 ? t("settings.share.external.oneView", "1 view") : t("settings.share.external.views", "{n} views", { n: l.viewCount })}
                  {l.lastViewedAt ? ` · ${t("settings.share.external.lastViewed", "last viewed {when}", { when: formatDateTime(l.lastViewedAt) })}` : ""}
                </div>
              </div>
              {confirmId === l.id ? (
                <span role="group" aria-label={t("settings.share.external.revokeGroup", "Revoke this link")} className="flex flex-wrap items-center gap-2 text-[13px]">
                  {t("settings.share.external.revokeConfirm", "Revoke it? Anyone who has it loses access.")}
                  <Button size="sm" variant="ghost" onClick={() => setConfirmId(null)}>{t("settings.share.external.keep", "Keep")}</Button>
                  <Button size="sm" variant="danger" onClick={() => void stop(l.id)}>{t("settings.share.external.revoke", "Revoke")}</Button>
                </span>
              ) : (
                <IconButton icon={<Link2Off size={16} strokeWidth={1.75} />} label={t("settings.share.external.revokeLabel", "Revoke link created {when}", { when: formatDateTime(l.createdDate) })}
                  className="!h-8 !w-8" onClick={() => { setError(""); setDone(""); setConfirmId(l.id); }} />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
