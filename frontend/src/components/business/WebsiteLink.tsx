/** An existing product's website on the Project setup page: a link that opens in a new tab and, for the project team,
 *  a small window to add, change or remove it (project.update; it stays editable after the hand-over). A new idea has
 *  no website, so nothing shows for it. */
import { useEffect, useId, useState, type FormEvent } from "react";
import { Globe, PencilLine, Plus } from "lucide-react";
import { Button, Input, Modal } from "@/ui/kit";
import { showToast } from "@/ui/Toast";
import { cn } from "@/lib/cn";
import { useUpdateProject } from "@/blocks/projects/mutations";
import { messageFor } from "@/blocks/projects/messages";
import { useT } from "@/i18n";
import type { ProjectRecord } from "@/blocks/projects/records";
import { LIMITS, WEBSITE_MESSAGE, checkWebsite } from "@/domain/guidedStart";

const PILL = "inline-flex max-w-[240px] items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[12px] font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-accent/50";

/** "https://www.alpinefresh.ch/" → "www.alpinefresh.ch" (the address as people say it). */
export function websiteLabel(url: string): string {
  return url.replace(/^https?:\/\//i, "").replace(/\/$/, "");
}

export function WebsiteLink({ project, canEdit }: { project: ProjectRecord; canEdit: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const url = project.websiteUrl;
  if (project.type !== "brownfield" || (!url && !canEdit)) return null;
  return (
    <>
      {url ? (
        <span className="inline-flex items-center gap-0.5">
          <a href={url} target="_blank" rel="noopener noreferrer" title={t("analysis.business.website.openInTab", "Open {site} in a new tab", { site: websiteLabel(url) })}
            className={cn(PILL, "bg-surface2 text-ink2 hover:text-ink hover:underline underline-offset-4")}>
            <Globe size={12} strokeWidth={1.75} aria-hidden className="shrink-0" />
            <span className="min-w-0 truncate">{websiteLabel(url)}</span>
          </a>
          {canEdit && (
            <button type="button" onClick={() => setOpen(true)} aria-label={t("analysis.business.website.change", "Change the website")} title={t("analysis.business.website.change", "Change the website")}
              className="grid h-7 w-7 place-items-center rounded-full text-ink3 outline-none transition hover:bg-surface2 hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/50">
              <PencilLine size={13} aria-hidden />
            </button>
          )}
        </span>
      ) : (
        <button type="button" onClick={() => setOpen(true)} className={cn(PILL, "text-accent hover:bg-accent-soft")}>
          <Plus size={12} strokeWidth={2} aria-hidden />{t("analysis.business.website.add", "Add website")}
        </button>
      )}
      <WebsiteDialog open={open} project={project} onClose={() => setOpen(false)} />
    </>
  );
}

function WebsiteDialog({ open, project, onClose }: { open: boolean; project: ProjectRecord; onClose: () => void }) {
  const t = useT();
  const update = useUpdateProject();
  const inputId = useId();
  const [value, setValue] = useState(project.websiteUrl);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) { setValue(project.websiteUrl); setError(null); }
  }, [open, project.websiteUrl]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (update.isPending) return;
    const w = checkWebsite(value);
    if (!w.ok) { setError(WEBSITE_MESSAGE[w.problem]); return; }
    setError(null);
    if (w.value === project.websiteUrl) { onClose(); return; }
    try {
      await update.run({ projectId: project.id, websiteUrl: w.value });
      showToast(w.value ? t("analysis.business.website.saved", "Website saved.") : t("analysis.business.website.removed", "Website removed."));
      onClose();
    } catch (err) {
      setError(messageFor(err));
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={t("analysis.business.website.title", "Website")} width={480}
      footer={<>
        <Button variant="ghost" onClick={onClose}>{t("analysis.business.cancel", "Cancel")}</Button>
        <Button variant="primary" type="submit" form="website-form" disabled={update.isPending}>{update.isPending ? t("analysis.business.saving", "Saving…") : t("analysis.business.save", "Save")}</Button>
      </>}>
      <form id="website-form" onSubmit={(e) => void save(e)} noValidate className="flex flex-col gap-2">
        <label htmlFor={inputId} className="text-[14px] text-ink2">{t("analysis.business.website.hint", "The product's web address. Leave it empty to remove it.")}</label>
        <div className="relative">
          <Globe size={16} aria-hidden className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink3" />
          <Input id={inputId} data-autofocus type="url" inputMode="url" value={value} maxLength={LIMITS.website} autoComplete="url"
            placeholder={t("analysis.business.website.placeholder", "www.example.com")} className="pl-11"
            aria-invalid={error ? true : undefined} aria-describedby={error ? `${inputId}-error` : undefined}
            onChange={(e) => { setValue(e.target.value); setError(null); }} />
        </div>
        {error && <p id={`${inputId}-error`} role="alert" className="text-[13px] text-danger">{error}</p>}
      </form>
    </Modal>
  );
}
