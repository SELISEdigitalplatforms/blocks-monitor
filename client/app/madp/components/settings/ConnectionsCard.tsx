/** Settings → Connections: the signed-in person's own accounts the team works with (GitHub for now). */
import { Link2 } from "lucide-react";
import { useConnectGithub, useDisconnectGithub, useGithubStatus } from "@/madp/blocks/github";
import { Button, Card, Chip } from "@/madp/ui/kit";
import { GithubMark } from "@/madp/components/intake/IntakeShared";
import { ManageAccessLink } from "@/madp/components/github/RepoPicker";
import { useT } from "@/madp/i18n";

export function ConnectionsCard() {
  const t = useT();
  const status = useGithubStatus();
  const connect = useConnectGithub();
  const disconnect = useDisconnectGithub();
  const login = status.data?.connected ? status.data.login : null;
  const busy = connect.isPending || disconnect.isPending;

  return (
    <div id="connections" tabIndex={-1} className="scroll-mt-6 outline-none">
      <Card title={t("settings.connections.title", "Connections")} icon={<Link2 size={18} strokeWidth={1.75} />} bodyClassName="flex flex-col gap-4"
        action={status.isPending ? undefined : login ? <Chip tone="success">{t("settings.connections.connected", "Connected")}</Chip> : <Chip tone="neutral">{t("settings.connections.notConnected", "Not connected")}</Chip>}>
        <p className="max-w-[68ch] text-[14px] text-ink2">
          {t("settings.connections.intro", "Your own accounts the team works with. They belong to you, not to the workspace.")}
        </p>
        <ul className="flex flex-col gap-3">
          <li className="flex flex-col gap-3 rounded-block bg-surface2 px-4 py-3 sm:flex-row sm:items-center">
            <GithubMark size={18} className="shrink-0 text-ink2" />
            <div className="min-w-0" aria-live="polite">
              <div className="text-[14px] font-medium">GitHub</div>
              {status.isPending ? (
                <div className="text-[13px] text-ink3">{t("settings.connections.checking", "Checking…")}</div>
              ) : status.isError ? (
                <div className="text-[13px] text-danger">{t("settings.connections.checkFailed", "The connection could not be checked.")}</div>
              ) : login ? (
                <>
                  <div className="text-[13px] text-ink2">{t("settings.connections.connectedAs", "Connected as")} <span className="font-medium text-ink">@{login}</span></div>
                  <div className="mt-1"><ManageAccessLink /></div>
                </>
              ) : (
                <div className="text-[13px] text-ink2">{t("settings.connections.notConnectedText", "Not connected · connect it so the team can work on the code of an existing product, and keep the code of new products in your account.")}</div>
              )}
              {(connect.isError || disconnect.isError) && <p role="alert" className="mt-1 text-[13px] text-danger">{t("settings.connections.failed", "That didn't work. Try again.")}</p>}
            </div>
            <div className="flex gap-2 self-start sm:ml-auto sm:self-center">
              {status.isError ? (
                <Button size="sm" variant="ghost" onClick={() => void status.refetch()}>{t("settings.connections.retry", "Retry")}</Button>
              ) : login ? (
                <Button size="sm" variant="ghost" disabled={busy} aria-busy={disconnect.isPending || undefined}
                  onClick={() => disconnect.mutate()}>{disconnect.isPending ? t("settings.connections.disconnecting", "Disconnecting…") : t("settings.connections.disconnect", "Disconnect")}</Button>
              ) : (
                <Button size="sm" variant="secondary" icon={<GithubMark size={14} />} disabled={busy || status.isPending}
                  aria-busy={connect.isPending || undefined} onClick={() => connect.mutate()}>{connect.isPending ? t("settings.connections.connecting", "Connecting…") : t("settings.connections.connect", "Connect GitHub")}</Button>
              )}
            </div>
          </li>
        </ul>
      </Card>
    </div>
  );
}
