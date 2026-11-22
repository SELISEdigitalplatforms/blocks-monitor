/** The way in, as a prompt: "What are you going to build today?" in your own words, then Start project. The guided start
 *  asks a few questions and the words become the project's description. Under the prompt, the six steps every project
 *  runs through. */
import { useId, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ArrowRight, BadgeCheck, MessageCircle } from "lucide-react";
import { ViewOnlyNote } from "@/components/workspace/ViewOnlyNote";
import { viewerTip } from "@/data/rbac";
import { useProjectsContext } from "@/blocks/projects";
import { useWorkspaces } from "@/blocks/workspaces/store";
import { can } from "@/domain/rbac";
import { Button, Card } from "@/ui/kit";
import { LifecycleRow } from "./parts";
import { openGuidedStart } from "@/components/guided/store";
import { useT } from "@/i18n";

/** the brief notes' limit, the same as the notes field on the Business step */
const BRIEF_MAX = 1200;

export function StartProjectCard({ className }: { className?: string }) {
  const t = useT();
  const fieldId = useId();
  const hintId = useId();
  const noteId = useId();
  const ctx = useProjectsContext();
  const canCreate = ctx.isSuperAdmin || can(ctx.permissions, "project.create");
  const ready = useWorkspaces((s) => s.ready);
  const area = useRef<HTMLTextAreaElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [words, setWords] = useState("");

  // the field grows with the text (up to its max height, then it scrolls)
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [words]);

  const start = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!ready || !canCreate) return;
    // The guided project start asks a few questions; the words become the project's description (its first note).
    openGuidedStart({ description: words.trim() });
  };
  // Enter starts, Shift+Enter adds a line (never while an input method is composing)
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    e.currentTarget.form?.requestSubmit();
  };

  return (
    <Card className={className}>
      <form ref={formRef} onSubmit={(e) => void start(e)}>
        <div className="flex items-center justify-between gap-3">
          <div className="text-[13px] text-ink3">{t("shell.dashboard.newProject", "New project")}</div>
        </div>
        <h2 className="mt-1 text-[24px] font-medium leading-tight tracking-[-0.02em]">
          <label htmlFor={fieldId}>{t("shell.home.start.question", "What are you going to build today?")}</label>
        </h2>

        <div className="mt-5 rounded-block bg-surface2 ring-accent/40 transition focus-within:ring-2 dark:ring-1 dark:ring-line dark:focus-within:ring-2 dark:focus-within:ring-accent/40">
          <textarea id={fieldId} ref={area} value={words} rows={3} maxLength={BRIEF_MAX} aria-describedby={hintId} disabled={!canCreate} title={ready && !canCreate ? viewerTip() : undefined}
            onChange={(e) => setWords(e.target.value)} onKeyDown={onKey}
            placeholder={t("shell.home.start.placeholder", "For example: an app where field technicians see the day's jobs and log their hours on site.")}
            className="block max-h-[280px] min-h-[120px] w-full resize-none overflow-y-auto bg-transparent px-5 pt-4 text-[16px] leading-relaxed text-ink outline-none placeholder:text-ink3" />
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-5 pb-4 pt-2">
            <p id={hintId} className="flex min-w-0 flex-1 basis-64 items-center gap-2 text-[13px] text-ink3">
              <MessageCircle size={16} strokeWidth={1.75} className="shrink-0" aria-hidden />
              {t("shell.home.start.hint", "In your own words is fine. Next come a few quick questions.")}
            </p>
            <Button type="submit" variant="primary" disabled={!ready || !canCreate} aria-busy={!ready || undefined} title={ready && !canCreate ? viewerTip() : undefined} aria-describedby={ready && !canCreate ? noteId : undefined} size="lg" className="w-full sm:w-auto" iconRight={<ArrowRight size={16} strokeWidth={2} />}>
              {t("shell.home.start.button", "Start project")}
            </Button>
          </div>
        </div>
        {ready && !canCreate && <ViewOnlyNote id={noteId} text={viewerTip()} />}

        <div className="mt-5 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <LifecycleRow />
          <p className="flex items-center gap-2 text-[13px] text-ink3">
            <BadgeCheck size={16} strokeWidth={1.75} className="shrink-0" aria-hidden />
            {t("shell.home.start.approve", "Your team does the work. You approve each step.")}
          </p>
        </div>
      </form>
    </Card>
  );
}
