/** Renders a wiki page's markdown subset with the design tokens (no typography plugin). */
import { Fragment, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ExternalLink, Info, TriangleAlert } from "lucide-react";
import { parseInline, parseMarkdown, type MdBlock, type MdInline } from "@/madp/data/wiki/markdown";
import { matchRanges } from "@/madp/data/wiki/search";
import { Label } from "@/madp/ui/kit";
import { cn } from "@/madp/lib/cn";
import { t } from "@/madp/i18n";

const LINK = "text-[rgb(var(--c-accent-text))] underline underline-offset-2";

function marked(text: string, highlight: string): ReactNode {
  const ranges = highlight ? matchRanges(text, highlight) : [];
  if (!ranges.length) return text;
  const out: ReactNode[] = [];
  let at = 0;
  ranges.forEach(([s, e], i) => {
    if (s > at) out.push(text.slice(at, s));
    out.push(<mark key={i} className="rounded-[4px] bg-accent-soft px-0.5 text-ink">{text.slice(s, e)}</mark>);
    at = e;
  });
  if (at < text.length) out.push(text.slice(at));
  return out;
}

function Inline({ text, highlight }: { text: string; highlight: string }) {
  const tokens: MdInline[] = useMemo(() => parseInline(text), [text]);
  return (
    <>
      {tokens.map((t, i) => {
        const body = marked(t.text, highlight);
        switch (t.type) {
          case "strong": return <strong key={i} className="font-medium text-ink">{body}</strong>;
          case "em": return <em key={i}>{body}</em>;
          case "code": return <code key={i} className="rounded bg-surface2 px-1 font-mono text-[0.9em]">{body}</code>;
          case "link": {
            if (t.href.startsWith("wiki:")) {
              const [slug, section] = t.href.slice(5).split("#");
              return <Link key={i} className={LINK} to={`?page=${slug}${section ? `&section=${section}` : ""}`}>{body}</Link>;
            }
            if (t.href.startsWith("https://")) {
              return (
                <a key={i} className={cn(LINK, "inline-flex items-center gap-1")} href={t.href} target="_blank" rel="noreferrer">
                  {body}<ExternalLink size={12} strokeWidth={1.75} aria-hidden />
                </a>
              );
            }
            return <Fragment key={i}>{body}</Fragment>;
          }
          default: return <Fragment key={i}>{body}</Fragment>;
        }
      })}
    </>
  );
}

function Block({ b, highlight, compact }: { b: MdBlock; highlight: string; compact: boolean }) {
  const gap = compact ? "mb-2" : "mb-4";
  switch (b.type) {
    case "heading":
      return b.level === 2
        ? <h2 id={`wiki-${b.id}`} className={cn("scroll-mt-6 mb-3 text-[20px] font-medium tracking-tight", compact ? "mt-4" : "mt-8")}><Inline text={b.text} highlight={highlight} /></h2>
        : <h3 className={cn("mb-2 text-[16px] font-medium", compact ? "mt-3" : "mt-6")}><Inline text={b.text} highlight={highlight} /></h3>;
    case "paragraph":
      return <p className={cn("text-[15px] leading-7 text-ink2", gap)}><Inline text={b.text} highlight={highlight} /></p>;
    case "list": {
      const Tag = b.ordered ? "ol" : "ul";
      return (
        <Tag className={cn(b.ordered ? "list-decimal" : "list-disc", "space-y-1.5 pl-5 text-[15px] leading-7 text-ink2", gap)}>
          {b.items.map((it, i) => <li key={i}><Inline text={it} highlight={highlight} /></li>)}
        </Tag>
      );
    }
    case "table":
      return (
        <div className={cn("overflow-x-auto rounded-block ring-1 ring-inset ring-line", gap)}>
          <table className="w-full text-left text-[14px]">
            <thead>
              <tr>{b.head.map((h, i) => <th key={i} className="bg-surface2 px-3 py-2 font-medium text-ink"><Inline text={h} highlight={highlight} /></th>)}</tr>
            </thead>
            <tbody>
              {b.rows.map((r, ri) => (
                <tr key={ri}>{r.map((c, ci) => <td key={ci} className="border-t border-line px-3 py-2 align-top text-ink2"><Inline text={c} highlight={highlight} /></td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "code":
      return (
        <div className={gap}>
          {b.lang && <Label>{b.lang}</Label>}
          <pre className="overflow-x-auto whitespace-pre rounded-block bg-surface2 p-4 font-mono text-[13px] leading-6 text-ink"><code>{marked(b.text, highlight)}</code></pre>
        </div>
      );
    case "callout": {
      const warn = b.tone === "warning";
      const Icon = warn ? TriangleAlert : Info;
      return (
        <div role="note" className={cn("flex gap-3 rounded-block px-4 py-3 text-[14px]", warn ? "bg-warning-soft text-ink" : "bg-accent-soft text-ink", gap)}>
          <Icon size={18} strokeWidth={1.75} className="mt-0.5 shrink-0" aria-hidden />
          <p className="min-w-0 leading-6"><strong className="sr-only">{warn ? t("wiki.markdown.warning", "Warning: ") : t("wiki.markdown.note", "Note: ")}</strong><Inline text={b.text} highlight={highlight} /></p>
        </div>
      );
    }
  }
}

export function Markdown({ md, highlight = "", flashSection = null, flashKey = 0, compact = false }: {
  md: string; highlight?: string; flashSection?: string | null; flashKey?: number; compact?: boolean;
}) {
  const [doneKey, setDoneKey] = useState(0);
  const sections = useMemo(() => {
    const blocks = parseMarkdown(md);
    const out: { id: string; blocks: MdBlock[] }[] = [{ id: "", blocks: [] }];
    for (const b of blocks) {
      if (b.type === "heading") out.push({ id: b.id, blocks: [b] });
      else out[out.length - 1].blocks.push(b);
    }
    return out.filter((s) => s.blocks.length > 0 || s.id !== "");
  }, [md]);
  return (
    <div className="max-w-[72ch]">
      {sections.map((s, i) => {
        const flashing = flashSection !== null && flashSection === s.id && flashKey > 0 && flashKey !== doneKey;
        return (
          <section key={`${s.id}-${i}${flashing ? `-${flashKey}` : ""}`} data-wiki-section={s.id}
            onAnimationEnd={flashing ? () => setDoneKey(flashKey) : undefined}
            className={cn("rounded-block", flashing && "wiki-flash")}>
            {s.blocks.map((b, j) => <Block key={j} b={b} highlight={highlight} compact={compact} />)}
          </section>
        );
      })}
    </div>
  );
}
