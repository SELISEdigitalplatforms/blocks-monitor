/** Home: the scope documents and screen designs other members shared with the signed-in member (real Blocks records),
 *  newest first. */
import { useNavigate } from "react-router-dom";
import { FileText, LayoutTemplate, Share2 } from "lucide-react";
import { useMemberName, useSharedWithMe } from "@/blocks/projects";
import { shareLabel, shareLink } from "@/domain/projects";
import { Button, Card } from "@/ui/kit";
import { relativeTime } from "./ProjectsView";
import { useT } from "@/i18n";

type Row = NonNullable<ReturnType<typeof useSharedWithMe>["data"]>[number];

function SharedBy({ row }: { row: Row }) {
  const t = useT();
  const by = (row.share as { sharedByUserId?: string }).sharedByUserId ?? "";
  const name = useMemberName(by);
  const when = relativeTime((row.share as { createdDate?: unknown }).createdDate);
  return <div className="break-words text-[13px] text-ink3">{[t("shell.home.sharedBy", "Shared by {name}", { name }), when].filter(Boolean).join(" · ")}</div>;
}

export function SharedWithYou({ className }: { className?: string }) {
  const t = useT();
  const navigate = useNavigate();
  const rows = useSharedWithMe().data ?? [];
  if (rows.length === 0) return null;
  return (
    <Card title={t("shell.home.sharedWithYou", "Shared with you")} icon={<Share2 size={18} strokeWidth={1.75} />} className={className}
      action={<span className="num text-[12px] text-ink3">{rows.length}</span>}>
      <ul className="flex flex-col gap-3">
        {rows.map((row) => {
          const { share, project } = row;
          const Icon = share.itemType === "scope" ? FileText : LayoutTemplate;
          return (
            <li key={`${share.projectId}:${share.itemType}:${share.itemRef}`} className="flex items-center gap-3 rounded-block bg-surface2 px-4 py-3">
              <Icon size={18} strokeWidth={1.75} className="shrink-0 text-ink2" aria-hidden />
              <div className="min-w-0 flex-1">
                {project ? (
                  <>
                    <div className="break-words text-[14px] font-medium">{shareLabel(share.itemType, project.name)}</div>
                    <SharedBy row={row} />
                  </>
                ) : (
                  <div className="break-words text-[14px] font-medium">{t("shell.home.itemGone", "This item no longer exists.")}</div>
                )}
              </div>
              {project && <Button size="sm" variant="ghost" onClick={() => navigate(shareLink(share))}>{t("common.actions.open", "Open")}</Button>}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
