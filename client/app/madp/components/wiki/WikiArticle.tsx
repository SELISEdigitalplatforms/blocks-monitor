/** One wiki page: title, meta line, actions, content and sources. Also renders the hidden print copy. */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, FileCheck2, FileDown, FileText, History, Layers, Link2, ListChecks, PanelsTopLeft, PenLine, Pencil, Rocket, Scale, ShieldCheck, Trash2, Wrench } from "lucide-react";
import { Button, Card, Chip } from "@/madp/ui/kit";
import { cspNonce } from "@/madp/lib/cspNonce";
import { type WikiPage } from "@/madp/data/wiki/types";
import { wikiGroupLabel } from "./groupLabel";
import { canDeletePage, canRetitlePage } from "@/madp/domain/wiki";
import { formatWhen } from "./useWiki";
import { Markdown } from "./Markdown";
import { WIKI_PRINT_CLASS, WIKI_PRINT_CSS, usePrintPrep } from "./print";
import { useT } from "@/madp/i18n";

const KIND_ICON: Record<string, ReactNode> = {
  brief: <FileText size={12} strokeWidth={1.75} />, requirement: <FileText size={12} strokeWidth={1.75} />,
  feature: <ListChecks size={12} strokeWidth={1.75} />, story: <ListChecks size={12} strokeWidth={1.75} />,
  screen: <PanelsTopLeft size={12} strokeWidth={1.75} />, slice: <Layers size={12} strokeWidth={1.75} />,
  artifact: <FileCheck2 size={12} strokeWidth={1.75} />, gate: <ShieldCheck size={12} strokeWidth={1.75} />,
  release: <Rocket size={12} strokeWidth={1.75} />, change: <History size={12} strokeWidth={1.75} />,
  fix: <Wrench size={12} strokeWidth={1.75} />, decision: <Scale size={12} strokeWidth={1.75} />,
};

function groupLabel(group: string): string {
  return wikiGroupLabel(group);
}

export function WikiArticle({ page, projectId, projectName, highlight, flashSection, flashKey, canEdit, onEdit, onHistory, onRename, onDelete }: {
  page: WikiPage; projectId: string; projectName: string; highlight: string; flashSection: string | null; flashKey: number;
  canEdit: boolean; onEdit: () => void; onHistory: () => void; onRename?: () => void; onDelete?: () => void;
}) {
  const t = useT();
  const [copy, setCopy] = useState<"idle" | "ok" | "fail">("idle");
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  usePrintPrep(`${projectName} – ${page.title}`);

  const meta = [
    page.updatedWithVersion && t("wiki.article.updatedWith", "Updated with {version}", { version: page.updatedWithVersion }),
    formatWhen(page.updatedAt),
    page.origin === "factory" ? t("wiki.article.byTeamShort", "written by your team") : t("wiki.article.byPersonShort", "written by a person"),
  ].filter(Boolean).join(" · ");
  const written = page.origin === "factory"
    ? t("wiki.article.byTeam", "Written by your team from the project's records.")
    : t("wiki.article.byPerson", "Written by a person on this project.");

  const copyLink = async () => {
    let ok = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(`${location.origin}/p/${projectId}/wiki?page=${page.slug}`);
        ok = true;
      }
    } catch { ok = false; }
    setCopy(ok ? "ok" : "fail");
    window.clearTimeout(timer.current);
    if (ok) timer.current = window.setTimeout(() => setCopy("idle"), 2000);
  };

  return (
    <>
      <Card bodyClassName="pt-6">
        <div className="text-[13px] text-ink3">{groupLabel(page.group)}</div>
        <h2 className="mt-1 text-[26px] font-medium leading-tight tracking-[-0.02em]">{page.title}</h2>
        <p className="mt-1 text-[13px] text-ink3">{meta}</p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button size="sm" variant="ghost" icon={<Link2 size={14} strokeWidth={1.75} />} onClick={copyLink}>{t("wiki.article.copyLink", "Copy link to page")}</Button>
          <Button size="sm" variant="ghost" icon={<FileDown size={14} strokeWidth={1.75} />} onClick={() => window.print()}>{t("wiki.article.downloadPdf", "Download page as PDF")}</Button>
          <Button size="sm" variant="ghost" icon={<History size={14} strokeWidth={1.75} />} onClick={onHistory}>{t("wiki.article.history", "History")}</Button>
          {canEdit && <Button size="sm" variant="ghost" icon={<PenLine size={14} strokeWidth={1.75} />} onClick={onEdit}>{t("wiki.article.edit", "Edit page")}</Button>}
          {canEdit && onRename && canRetitlePage(page.origin) && <Button size="sm" variant="ghost" icon={<Pencil size={14} strokeWidth={1.75} />} onClick={onRename}>{t("wiki.article.rename", "Rename")}</Button>}
          {canEdit && onDelete && canDeletePage(page.origin) && <Button size="sm" variant="ghost" icon={<Trash2 size={14} strokeWidth={1.75} />} onClick={onDelete}>{t("wiki.article.delete", "Delete page")}</Button>}
          <span role="status" className="inline-flex items-center gap-1.5 text-[13px] text-ink2">
            {copy === "ok" && <><Check size={14} strokeWidth={1.75} aria-hidden />{t("wiki.article.linkCopied", "Link copied")}</>}
            {copy === "fail" && t("wiki.article.linkCopyFailed", "The link could not be copied")}
          </span>
        </div>
        <hr className="my-5 border-line" />
        <Markdown md={page.bodyMd} highlight={highlight} flashSection={flashSection} flashKey={flashKey} />
        <h3 className="mb-2 mt-8 text-[16px] font-medium">{t("wiki.article.sources", "Sources")}</h3>
        {page.sources.length ? (
          <ul className="flex flex-wrap gap-2">
            {page.sources.map((s, i) => (
              <li key={i}><Chip icon={KIND_ICON[s.kind]} title={s.ref}>{s.label}</Chip></li>
            ))}
          </ul>
        ) : <p className="text-[14px] text-ink2">{written}</p>}
      </Card>
      {createPortal(
        <div className={WIKI_PRINT_CLASS} aria-hidden>
          <style nonce={cspNonce()}>{WIKI_PRINT_CSS}</style>
          <div className="text-[12px] font-medium uppercase tracking-wider text-ink3">{t("wiki.article.printEyebrow", "{project} · Wiki", { project: projectName })}</div>
          <h1 className="mt-1 text-[28px] font-medium leading-tight tracking-[-0.02em]">{page.title}</h1>
          <p className="mb-4 mt-1 text-[13px] text-ink3">{meta}</p>
          <Markdown md={page.bodyMd} />
          <h3 className="mb-2 mt-8 text-[16px] font-medium">{t("wiki.article.sources", "Sources")}</h3>
          {page.sources.length ? (
            <ul className="list-disc pl-5 text-[14px] text-ink2">{page.sources.map((s, i) => <li key={i}>{s.label}</li>)}</ul>
          ) : <p className="text-[14px] text-ink2">{written}</p>}
        </div>,
        document.body)}
    </>
  );
}
