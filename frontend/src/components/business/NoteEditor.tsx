/** One business note: title + markdown, serialised autosave, stale-save handling. */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createAutosaver, statusLabel, type Autosaver } from "./useAutosave";
import { adoptStoredNote } from "./noteSync";
import { Banner, Button, Input, Tabs, Textarea } from "@/ui/kit";
import { Markdown } from "@/components/wiki/Markdown";
import { useDocNoteBody } from "@/blocks/projects/docReads";
import { useSaveNote } from "@/blocks/projects/docMutations";
import { messageFor, messageKeyOf } from "@/blocks/projects/messages";
import { FunctionError } from "@/blocks/fn";
import { NOTE_BODY_MAX, NOTE_TITLE_MAX, SCRATCH_TITLE } from "../../domain/docs";
import { NOTE_ICON, SCRATCH_ICON } from "./icons";
import { useT } from "@/i18n";

export interface NoteEditorProps {
  projectId: string;
  noteId: string | null;
  scratch: boolean;
  folderId: string;
  canEdit: boolean;
  editReason: string | null;
  onCreated: (noteId: string) => void;
  /** Opens on Preview (a document to read, e.g. the Project brief) instead of Write. */
  initialMode?: "write" | "preview";
}

const grouped = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
const IDLE = { status: "idle", savedAt: null, unsaved: false } as const;
const noop = () => () => undefined;

export function NoteEditor({ projectId, noteId, scratch, folderId, canEdit, editReason, onCreated, initialMode = "write" }: NoteEditorProps) {
  const t = useT();
  const q = useDocNoteBody(noteId);
  const { run } = useSaveNote();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [mode, setMode] = useState<"write" | "preview">(initialMode);
  const root = useRef<HTMLDivElement>(null);
  const [stale, setStale] = useState<{ updatedAt?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saver, setSaver] = useState<Autosaver | null>(null);

  // live values read by the save closure
  const live = useRef({ title: "", body: "", noteId: noteId as string | null, updatedAt: undefined as string | undefined });
  const loadedFor = useRef<string | null>(null);
  const created = useRef<string | null>(null);
  const props = useRef({ projectId, scratch, folderId, onCreated, run });
  props.current = { projectId, scratch, folderId, onCreated, run };
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  // one autosaver per mount: it keeps serving the note this editor creates; unmounting flushes it
  useEffect(() => {
    const s = createAutosaver({
      save: async () => {
        const p = props.current;
        const l = live.current;
        const hadId = l.noteId;
        try {
          const rec = await p.run({
            projectId: p.projectId,
            ...(hadId && !p.scratch ? { noteId: hadId } : {}),
            folderId: p.scratch ? "" : p.folderId,
            title: p.scratch ? SCRATCH_TITLE : l.title,
            bodyMd: l.body,
            ...(l.updatedAt ? { expectedUpdatedAt: l.updatedAt } : {}),
            ...(p.scratch ? { scratch: true } : {}),
          });
          l.updatedAt = rec.lastUpdatedDate;
          if (mounted.current) setError(null);
          if (!hadId) {
            l.noteId = rec.id;
            created.current = rec.id;
            p.onCreated(rec.id);
          }
        } catch (e) {
          if (messageKeyOf(e) === "note.stale") {
            const u = e instanceof FunctionError ? e.params?.updatedAt : undefined;
            if (mounted.current) setStale({ updatedAt: typeof u === "string" ? u : undefined });
          } else if (mounted.current) setError(messageFor(e));
          throw e;
        }
      },
    });
    setSaver(s);
    return () => { s.flush(); s.dispose(); };
  }, []);

  // load the stored text when the note opens
  useEffect(() => {
    const l = live.current;
    if (noteId === null) {
      if (loadedFor.current !== null || l.noteId !== null) { l.title = ""; l.body = ""; l.noteId = null; l.updatedAt = undefined; setTitle(""); setBody(""); }
      loadedFor.current = null; setStale(null); setError(null);
      return;
    }
    const d = q.data;
    if (loadedFor.current === noteId) {
      // the stored note changed while it is open (not by this editor): show it, unless there are edits of our own
      if (d && d.id === noteId && d.bodyMd !== null && saver && adoptStoredNote({ editorUpdatedAt: l.updatedAt, storedUpdatedAt: d.lastUpdatedDate, autosave: saver.getStatus() })) {
        l.updatedAt = d.lastUpdatedDate; l.title = d.title ?? ""; l.body = d.bodyMd ?? "";
        setTitle(d.title ?? ""); setBody(d.bodyMd ?? ""); setStale(null);
      }
      return;
    }
    if (created.current === noteId) { loadedFor.current = noteId; l.noteId = noteId; return; } // we just made it: keep the text
    if (!d) return;
    loadedFor.current = noteId; l.noteId = noteId; l.updatedAt = d.lastUpdatedDate; l.title = d.title ?? ""; l.body = d.bodyMd ?? "";
    setTitle(d.title ?? ""); setBody(d.bodyMd ?? ""); setStale(null); setError(null);
  }, [noteId, q.data, saver]);

  const snap = useSyncExternalStore(saver ? saver.subscribe : noop, saver ? saver.getStatus : () => IDLE, () => IDLE);

  useEffect(() => {
    if (!snap.unsaved) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [snap.unsaved]);

  const loading = noteId !== null && loadedFor.current !== noteId && created.current !== noteId && q.isLoading;
  const readOnly = !canEdit || loading;

  const onTitle = (v: string) => { live.current.title = v; setTitle(v); saver?.edit(); };
  const onBody = (v: string) => { live.current.body = v; setBody(v); saver?.edit(); };

  const loadTheirs = useCallback(async () => {
    const r = await q.refetch();
    const d = r.data;
    if (!d) { setError(t("analysis.business.note.loadTheirsFailed", "Couldn't load their version.")); return; }
    const l = live.current;
    l.title = d.title ?? ""; l.body = d.bodyMd ?? ""; l.updatedAt = d.lastUpdatedDate;
    setTitle(d.title ?? ""); setBody(d.bodyMd ?? ""); setStale(null); saver?.discard();
  }, [q, saver]);
  const keepMine = () => {
    if (stale?.updatedAt) live.current.updatedAt = stale.updatedAt;
    setStale(null);
    saver?.retry();
  };

  const Icon = scratch ? SCRATCH_ICON : NOTE_ICON;
  const label = statusLabel(snap);

  return (
    <div ref={root} className="flex min-w-0 flex-col gap-4">
      {stale && (
        <Banner tone="warning" title={t("analysis.business.note.changedElsewhere", "Someone else changed this note.")}
          action={<div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => void loadTheirs()}>{t("analysis.business.note.loadTheirs", "Load their version")}</Button>
            <Button size="sm" variant="ghost" onClick={keepMine}>{t("analysis.business.note.keepMine", "Keep mine")}</Button>
          </div>} />
      )}
      {!canEdit && editReason && <p className="text-[13px] text-ink2">{editReason}</p>}
      {scratch ? (
        <div className="flex items-center gap-2 text-[16px] font-medium text-ink"><Icon size={18} strokeWidth={1.75} aria-hidden />{t("analysis.business.scratchPad", "Scratch pad")}</div>
      ) : (
        <Input aria-label={t("analysis.business.rename.noteTitle", "Note title")} placeholder={t("analysis.business.untitledNote", "Untitled note")} maxLength={NOTE_TITLE_MAX} value={title}
          readOnly={readOnly} onChange={(e) => onTitle(e.target.value)} onBlur={() => saver?.flush()} />
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs label={t("analysis.business.note.view", "Note view")} value={mode} onChange={setMode}
          tabs={[{ value: "write", label: t("analysis.business.note.write", "Write") }, { value: "preview", label: t("analysis.business.note.preview", "Preview") }]} />
      </div>
      {mode === "write" ? (
        <Textarea aria-label={t("analysis.business.note.text", "Note text (markdown)")} className="min-h-[320px] font-mono" maxLength={NOTE_BODY_MAX} value={body}
          readOnly={readOnly} onChange={(e) => onBody(e.target.value)} onBlur={() => saver?.flush()} />
      ) : (
        <div className="min-h-[320px] rounded-block bg-surface2 px-4 py-3">
          {body.trim() ? <Markdown md={body} /> : <p className="text-[14px] text-ink3">{t("analysis.business.note.nothingToPreview", "Nothing to preview yet.")}</p>}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 text-[13px] text-ink2">
        <div role="status" aria-live="polite" className="flex items-center gap-3">
          <span>{label}</span>
          {snap.status === "failed" && !stale && <Button size="sm" variant="ghost" onClick={() => saver?.retry()}>{t("analysis.business.retry", "Retry")}</Button>}
          {error && <span className="text-danger">{error}</span>}
        </div>
        <span>{grouped(body.length)} / {grouped(NOTE_BODY_MAX)}</span>
      </div>
    </div>
  );
}
