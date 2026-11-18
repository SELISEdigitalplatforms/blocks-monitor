/** Asks the person to connect their GitHub account: the mark, why MADP needs it, Connect, and optionally "Skip, add it later". */
import { useConnectGithub } from "@/madp/blocks/github";
import { useT } from "@/madp/i18n";
import { Button } from "@/madp/ui/kit";
import { GithubMark } from "@/madp/components/intake/IntakeShared";

export function ConnectGithubPanel({ why, onSkip, title, disabled }: {
  why: string; onSkip?: () => void; title?: string; disabled?: boolean;
}) {
  const t = useT();
  const connect = useConnectGithub();
  const busy = connect.isPending;
  return (
    <div className="flex flex-col gap-3 rounded-block bg-surface2 p-4 sm:flex-row sm:items-center">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-surface text-ink dark:ring-1 dark:ring-line"><GithubMark size={20} /></span>
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-medium">{title ?? t("settings.github.connect.title", "Connect GitHub")}</div>
        <p className="mt-0.5 max-w-[68ch] text-[13px] text-ink2">{why}</p>
        {connect.isError && <p role="alert" className="mt-1.5 text-[13px] text-danger">{t("settings.github.connect.failed", "GitHub could not be connected. Try again.")}</p>}
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        <Button variant="secondary" size="sm" icon={<GithubMark size={14} />} disabled={busy || disabled} aria-busy={busy || undefined}
          onClick={() => connect.mutate()}>{busy ? t("settings.github.connect.connecting", "Connecting…") : t("settings.github.connect.button", "Connect GitHub")}</Button>
        {onSkip && <Button variant="ghost" size="sm" disabled={busy} onClick={onSkip}>{t("settings.github.connect.skip", "Skip, add it later")}</Button>}
      </div>
    </div>
  );
}

/** The placeholder while the connection is read. */
export function GithubLoading() {
  const t = useT();
  return <div aria-busy="true" aria-label={t("settings.github.connect.checking", "Checking the GitHub connection")} className="h-[72px] animate-pulse rounded-block bg-surface2" />;
}
