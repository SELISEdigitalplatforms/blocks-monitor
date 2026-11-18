/** Picks one of the person's GitHub repositories and its branch: who is connected, a searchable list, the branch. */
import { useEffect, useId, useMemo, useState, type KeyboardEvent } from "react";
import { Check, ExternalLink, Globe, Lock, Search } from "lucide-react";
import {
  github, useConnectGithub, useDisconnectGithub, useGithubBranches, useGithubRepos, useGithubStatus,
} from "@/madp/blocks/github";
import { relativeTime } from "@/madp/domain/dashboard";
import type { RepoRef } from "@/madp/domain/projectType";
import { useT } from "@/madp/i18n";
import { Button, Input, Label, Select } from "@/madp/ui/kit";
import { GithubMark } from "@/madp/components/intake/IntakeShared";
import { cn } from "@/madp/lib/cn";
import { ConnectGithubPanel, GithubLoading } from "./ConnectGithubPanel";
import { branchOptions, filterRepos, moveActive } from "./githubUi";

const LINK = "text-[13px] font-medium text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 rounded-sm disabled:opacity-45";

/** "Connected as @login" with Switch account and Disconnect. */
export function GithubAccountLine({ login }: { login: string }) {
  const t = useT();
  const connect = useConnectGithub();
  const disconnect = useDisconnectGithub();
  const busy = connect.isPending || disconnect.isPending;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ink2">
      <GithubMark size={16} className="text-ink" />
      <span>{t("settings.github.account.connectedAs", "Connected as")} <span className="font-medium text-ink">@{login}</span></span>
      <span className="flex items-center gap-3" aria-live="polite">
        {connect.isPending ? <span className="text-ink3">{t("settings.github.connect.connecting", "Connecting…")}</span> : disconnect.isPending ? <span className="text-ink3">{t("settings.github.account.disconnecting", "Disconnecting…")}</span> : (
          <>
            <button type="button" className={LINK} disabled={busy} onClick={() => connect.mutate()}>{t("settings.github.account.switch", "Switch account")}</button>
            <button type="button" className={LINK} disabled={busy} onClick={() => disconnect.mutate()}>{t("settings.github.account.disconnect", "Disconnect")}</button>
          </>
        )}
      </span>
    </div>
  );
}

export function ManageAccessLink({ children }: { children?: string }) {
  const t = useT();
  return (
    <a href={github.manageAccessUrl} target="_blank" rel="noopener noreferrer" className={cn(LINK, "inline-flex items-center gap-1")}>
      {children ?? t("settings.github.access.manageRepositoryAccess", "Manage repository access")}<ExternalLink size={12} strokeWidth={1.75} aria-hidden /><span className="sr-only"> {t("settings.github.access.opensInNewTab", "(opens GitHub in a new tab)")}</span>
    </a>
  );
}

/** The searchable repository list and the branch select of a connected person. `value` is the chosen repository and branch. */
export function RepoPicker({ login, value, onChange, disabled }: {
  login: string; value: RepoRef | null; onChange: (v: RepoRef) => void; disabled?: boolean;
}) {
  const t = useT();
  const id = useId();
  const listId = `${id}-repos`;
  const repos = useGithubRepos();
  const [query, setQuery] = useState("");
  const shown = useMemo(() => filterRepos(repos.data ?? [], query), [repos.data, query]);
  const [active, setActive] = useState(-1);
  const chosenName = value ? `${value.owner}/${value.name}` : "";
  const chosenListed = shown.findIndex((r) => r.fullName.toLowerCase() === chosenName.toLowerCase());
  const branches = useGithubBranches(value);

  // the active option follows the list: the chosen repository when shown, else the first one
  useEffect(() => { setActive(shown.length === 0 ? -1 : chosenListed >= 0 ? chosenListed : 0); }, [shown, chosenListed]);
  useEffect(() => {
    if (active >= 0) document.getElementById(`${id}-opt-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, id]);

  const choose = (i: number) => {
    const r = shown[i];
    if (!r || disabled) return;
    setActive(i);
    onChange({ owner: r.owner, name: r.name, branch: r.defaultBranch });
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); setActive((a) => moveActive(a, shown.length, e.key)); }
    else if (e.key === "Enter") { e.preventDefault(); if (active >= 0) choose(active); }
    else if (e.key === "Escape" && query) { e.preventDefault(); setQuery(""); }
  };

  const options = branchOptions(branches.data ?? [], value?.branch ?? "");
  const now = Date.now();

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <GithubAccountLine login={login} />
      <div className="min-w-0">
        <Label>{t("settings.github.picker.repository", "Repository")}</Label>
        <div className="relative">
          <Search size={16} strokeWidth={1.75} aria-hidden className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink3" />
          <Input id={`${id}-search`} aria-label={t("settings.github.picker.searchAria", "Repository: search your repositories")} role="combobox" aria-expanded="true" aria-controls={listId} aria-autocomplete="list"
            aria-activedescendant={active >= 0 ? `${id}-opt-${active}` : undefined} autoComplete="off" spellCheck={false}
            className="pl-11" placeholder={t("settings.github.picker.searchPlaceholder", "Search your repositories")} value={query} disabled={disabled}
            onChange={(e) => setQuery(e.target.value)} onKeyDown={onKey} />
        </div>
        {value && chosenListed < 0 && !repos.isPending && (
          <p className="mt-2 text-[13px] text-ink2">{t("settings.github.picker.chosen", "Chosen:")} <span className="font-medium text-ink">{chosenName}</span>. {t("settings.github.picker.chosenHint", "Pick another repository below to change it.")}</p>
        )}
        <ul id={listId} role="listbox" aria-label={t("settings.github.picker.repositories", "Repositories")} aria-busy={repos.isPending || undefined}
          className="mt-2 max-h-[264px] overflow-y-auto rounded-block bg-surface2 p-1.5">
          {repos.isPending && [0, 1, 2].map((i) => <li key={i} aria-hidden className="m-1 h-12 animate-pulse rounded-block bg-ink/[0.05]" />)}
          {repos.isError && (
            <li className="flex flex-wrap items-center gap-3 px-3 py-3 text-[13px] text-danger">
              {t("settings.github.picker.loadFailed", "The repositories could not be loaded.")}
              <Button size="sm" variant="ghost" onClick={() => void repos.refetch()}>{t("settings.github.retry", "Retry")}</Button>
            </li>
          )}
          {repos.isSuccess && shown.length === 0 && (
            <li className="px-3 py-3 text-[13px] text-ink2">{query.trim() ? t("settings.github.picker.noMatch", "No repository matches “{query}”.", { query: query.trim() }) : t("settings.github.picker.none", "MADP can't see any repository yet.")}</li>
          )}
          {shown.map((r, i) => {
            const selected = i === chosenListed;
            return (
              <li key={r.fullName} id={`${id}-opt-${i}`} role="option" aria-selected={selected}
                onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setActive(i)} onClick={() => choose(i)}
                className={cn("flex cursor-pointer items-start gap-3 rounded-block px-3 py-2.5 transition",
                  selected ? "bg-accent-soft" : i === active && "bg-surface", i === active && "ring-1 ring-accent/50",
                  disabled && "cursor-not-allowed opacity-60")}>
                <span className="mt-0.5 text-ink3">{r.private ? <Lock size={14} strokeWidth={1.75} aria-hidden /> : <Globe size={14} strokeWidth={1.75} aria-hidden />}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-[14px] font-medium text-ink">{r.fullName}</span>
                    <span className="shrink-0 text-[12px] text-ink3">{r.private ? t("settings.github.picker.private", "Private") : t("settings.github.picker.public", "Public")}</span>
                  </span>
                  {r.description && <span className="block truncate text-[13px] text-ink2">{r.description}</span>}
                  <span className="block text-[12px] text-ink3">{r.defaultBranch} · {t("settings.github.picker.updated", "updated {when}", { when: relativeTime(r.updatedAt, now) })}</span>
                </span>
                {selected && <Check size={16} strokeWidth={2} aria-hidden className="mt-0.5 shrink-0 text-accent" />}
              </li>
            );
          })}
        </ul>
        <p className="mt-2 text-[13px] text-ink3">{t("settings.github.picker.missingRepo", "Missing a repo?")} <ManageAccessLink>{t("settings.github.access.manageAccess", "Manage access")}</ManageAccessLink></p>
      </div>
      <div className="min-w-0 sm:max-w-[320px]">
        <Label>{t("settings.github.picker.branch", "Branch")}</Label>
        <Select label={t("settings.github.picker.branch", "Branch")} value={value?.branch ?? ""} options={options} disabled={disabled || !value || branches.isPending}
          placeholder={!value ? t("settings.github.picker.chooseRepoFirst", "Choose a repository first") : branches.isPending ? t("settings.github.picker.loadingBranches", "Loading branches…") : t("settings.github.picker.chooseBranch", "Choose a branch")}
          onChange={(b) => { if (value) onChange({ ...value, branch: b }); }} />
      </div>
    </div>
  );
}

/** Connect first, then pick: the Connect panel while GitHub is not connected, the picker once it is. */
export function GithubRepoChooser({ value, onChange, why, onSkip, disabled }: {
  value: RepoRef | null; onChange: (v: RepoRef) => void; why: string; onSkip?: () => void; disabled?: boolean;
}) {
  const t = useT();
  const status = useGithubStatus();
  if (status.isPending) return <GithubLoading />;
  if (status.isError) {
    return (
      <p role="alert" className="flex flex-wrap items-center gap-3 text-[13px] text-danger">
        {t("settings.github.picker.checkFailed", "The GitHub connection could not be checked.")}
        <Button size="sm" variant="ghost" onClick={() => void status.refetch()}>{t("settings.github.retry", "Retry")}</Button>
      </p>
    );
  }
  if (!status.data.connected || !status.data.login) return <ConnectGithubPanel why={why} onSkip={onSkip} disabled={disabled} />;
  return <RepoPicker login={status.data.login} value={value} onChange={onChange} disabled={disabled} />;
}
