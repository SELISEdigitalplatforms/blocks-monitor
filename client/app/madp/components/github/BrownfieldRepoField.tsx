/** The repository field of /new for a brownfield project. */
import { useEffect } from "react";
import { useGithubStatus } from "@/madp/blocks/github";
import type { RepoRef } from "@/madp/domain/projectType";
import { useT } from "@/madp/i18n";
import { Button, Label } from "@/madp/ui/kit";
import { GithubRepoChooser } from "./RepoPicker";

/** Brownfield: connect GitHub, then pick the existing product's repository; or skip it (optional: it can be added later in Project setup). */
export function BrownfieldRepoField({ value, skipped, disabled, error, onSkip, onChange }: {
  value: RepoRef | null; skipped: boolean; disabled: boolean; error: string | null;
  onSkip: (skipped: boolean) => void; onChange: (v: RepoRef | null) => void;
}) {
  const t = useT();
  const github = useGithubStatus();
  const disconnected = github.isSuccess && !github.data.connected;
  // a repository picked before a disconnect is not sent
  useEffect(() => { if (disconnected && value) onChange(null); }, [disconnected, value, onChange]);
  return (
    <div className="max-w-2xl">
      <Label>{t("settings.github.brownfield.label", "Existing product repository (optional)")}</Label>
      {github.isError ? (
        <p className="rounded-block bg-surface2 px-4 py-3 text-[13px] text-ink2">{t("settings.github.brownfield.unavailable", "GitHub can't be connected right now. You can add the repository any time in Project setup.")}</p>
      ) : skipped && !value ? (
        <div className="flex flex-wrap items-center gap-3 rounded-block bg-surface2 px-4 py-3">
          <p className="min-w-0 flex-1 text-[13px] text-ink2">{t("settings.github.brownfield.skipped", "No repository for now. You can add it any time in Project setup.")}</p>
          <Button variant="ghost" size="sm" onClick={() => onSkip(false)}>{t("settings.github.brownfield.addNow", "Add it now")}</Button>
        </div>
      ) : (
        <GithubRepoChooser value={value} disabled={disabled} onChange={onChange} onSkip={() => onSkip(true)}
          why={t("settings.github.brownfield.why", "MADP reads this code to understand the product as it is today. Connect your GitHub account and pick the repository.")} />
      )}
      {error && <p role="alert" className="mt-1.5 text-[13px] text-danger">{error}</p>}
      {value && !error && <p className="mt-2 text-[13px] text-ink3">{t("settings.github.brownfield.changeLater", "You can change it in Project setup until the project analysis starts.")}</p>}
    </div>
  );
}
