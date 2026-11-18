import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { fetchPublicShare, type PublicShareResult } from "@/madp/blocks/share/public";
import { PublicSharePreview } from "@/madp/components/share/PublicSharePreview";
import { Button, Card } from "@/madp/ui/kit";
import { formatDateTime } from "@/madp/lib/dates";
import { useT } from "@/madp/i18n";

export default function PublicShare() {
  const t = useT();
  const { token = "" } = useParams();
  const [result, setResult] = useState<PublicShareResult | null>(null);
  const [round, setRound] = useState(0);
  const reload = useCallback(() => { setResult(null); setRound((n) => n + 1); }, []);

  useEffect(() => {
    const ac = new AbortController();
    void fetchPublicShare(token, ac.signal).then((r) => { if (!ac.signal.aborted) setResult(r); });
    return () => ac.abort();
  }, [token, round]);

  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow";
    document.head.appendChild(meta);
    const title = document.title;
    document.title = t("settings.share.public.documentTitle", "Shared item · MADP Factory");
    return () => { meta.remove(); document.title = title; };
  }, [t]);

  const share = result?.status === "ok" ? result.share : null;
  return (
    <div className="min-h-screen bg-canvas text-ink">
      <header className="px-6 py-5 sm:px-10">
        <span className="text-[20px] font-medium tracking-tight">MADP Factory</span>
      </header>
      <main className="mx-auto w-full max-w-[880px] px-4 pb-16 sm:px-10">
        {!result && <p className="text-[15px] text-ink2" role="status" aria-busy="true">{t("settings.share.public.opening", "Opening the shared item…")}</p>}
        {result?.status === "not_found" && <Card><p className="text-[15px] text-ink">{t("settings.share.public.notFound", "This link isn't available. It may have expired or been revoked.")}</p></Card>}
        {result?.status === "rate_limited" && <Card><p className="text-[15px] text-ink">{t("settings.share.public.rateLimited", "Too many requests. Try again in a minute.")}</p></Card>}
        {result?.status === "error" && (
          <Card>
            <div className="flex flex-col items-start gap-4">
              <p className="text-[15px] text-ink">{t("settings.share.public.loadFailed", "The shared item couldn't be loaded.")}</p>
              <Button variant="primary" onClick={reload}>{t("settings.share.public.tryAgain", "Try again")}</Button>
            </div>
          </Card>
        )}
        {share && (
          <div className="flex min-w-0 flex-col gap-4">
            <div className="flex min-w-0 flex-col gap-1">
              <h1 className="break-words text-[28px] font-medium tracking-tight">{share.item.title}</h1>
              <p className="text-[14px] text-ink2">{t("settings.share.public.sharedBy", "Shared by {name} · link expires {when}", { name: share.sharedByName, when: formatDateTime(share.expiresAt) })}</p>
            </div>
            <Card className="min-w-0"><PublicSharePreview item={share.item} onExpired={reload} /></Card>
          </div>
        )}
      </main>
    </div>
  );
}
