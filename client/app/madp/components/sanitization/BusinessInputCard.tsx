/** The project's Business notes and files, beside the step; items created after the hand-over are marked. */
import { FileText, Folder } from "lucide-react";
import { Link } from "react-router-dom";
import { isNewSinceHandOver, useBusinessRefs } from "@/madp/blocks/sanitization/hooks";
import { Card, Chip } from "@/madp/ui/kit";
import { LoadError } from "./shared";
import { useT } from "@/madp/i18n";

export function BusinessInputCard({ workspaceId, projectId, handedOverAt }: { workspaceId: string; projectId: string; handedOverAt: string | null }) {
  const t = useT();
  const q = useBusinessRefs({ workspaceId, projectId });
  const folders = new Map(q.refs.filter((r) => r.type === "folder").map((r) => [r.id, r.title]));
  const refs = q.refs.filter((r) => r.type !== "folder").map((r) => ({ ...r, folder: (r.folderId && folders.get(r.folderId)) || "" }));
  return (
    <Card title={t("settings.sanitization.material.title", "Your material")} icon={<FileText size={18} strokeWidth={1.75} />}>
      {q.isError ? <LoadError onRetry={() => void q.refetch()} />
        : q.isLoading ? <p role="status" className="text-[14px] text-ink2">{t("settings.sanitization.material.loading", "Loading the Business input…")}</p>
        : refs.length === 0 ? <p className="text-[14px] text-ink2">{t("settings.sanitization.material.empty", "No notes or files in Business yet.")}</p>
        : (
          <ul className="flex min-w-0 flex-col gap-3">
            {refs.map((r) => (
              <li key={r.id} className="min-w-0">
                <Link to={`/p/${projectId}/business?item=${r.id}`}
                  className="break-words rounded-md text-[14px] font-medium text-ink outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent/50">
                  {r.title}
                </Link>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                  {r.folder && (
                    <span className="inline-flex min-w-0 items-center gap-1 text-[12px] text-ink3">
                      <Folder size={12} strokeWidth={1.75} /><span className="break-words">{r.folder}</span>
                    </span>
                  )}
                  {isNewSinceHandOver(r.createdAt, handedOverAt) && <Chip tone="accent">{t("settings.sanitization.material.newSinceStart", "New since the analysis started")}</Chip>}
                </div>
              </li>
            ))}
          </ul>
        )}
    </Card>
  );
}
