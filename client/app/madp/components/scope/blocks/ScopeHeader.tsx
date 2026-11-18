/** Header of the Blocks scope page: organisation · project, the title, the version line, Share and the screen preview. */
import { Eye, Share2 } from "lucide-react";
import { wizardEyebrow } from "../../intake/IntakeShared";
import { formatDateTime } from "@/madp/lib/dates";
import { Button, PageHeader } from "../../../ui/kit";
import { t, useT } from "@/madp/i18n";

export interface HeaderVersion { number: number; status: string; updatedAt?: string | null; lockedAt?: string | null; lockedByUserId?: string | null }

const pad = (n: number) => String(n).padStart(2, "0");
export const clockOf = (iso: string | null | undefined): string | null => {
  const d = iso ? new Date(iso) : null;
  return d && Number.isFinite(d.getTime()) ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : null;
};
export const dateOf = (iso: string | null | undefined): string | null => formatDateTime(iso) || null;

/** The scope's name in plain words: "Scope" for the first one (or while its number is not known), "Scope version 2"
 *  once it was unlocked and changed. Never a made-up number. */
export function scopeName(n: number | null | undefined): string {
  return typeof n === "number" && Number.isFinite(n) && n > 1 ? t("analysis.scope.header.versionN", "Scope version {n}", { n }) : t("analysis.scope.header.scope", "Scope");
}

/** "Scope version 2 · locked 20 Oct 2026, 09:25 by Name" (the date and the name when known). */
export function lockedLine(n: number | null | undefined, date: string | null, by: string | null): string {
  return `${scopeName(n)} · ${t("analysis.scope.header.locked", "locked")}${date ? ` ${date}` : ""}${by ? ` ${t("analysis.scope.header.byName", "by {name}", { name: by })}` : ""}`;
}

/** "Scope · draft · saved 14:02" or "Scope version 2 · locked 20 Oct 2026, 09:25 by Name" */
export function versionLine(v: HeaderVersion | null, memberName: (id: string) => string): string {
  if (!v) return t("analysis.scope.header.notSaved", "Scope · not saved yet");
  if (v.status === "locked") {
    const by = v.lockedByUserId ? memberName(v.lockedByUserId) : "";
    return lockedLine(v.number, dateOf(v.lockedAt), by || null);
  }
  const saved = clockOf(v.updatedAt);
  return `${scopeName(v.number)} · ${t("analysis.scope.header.draft", "draft")}${saved ? ` · ${t("analysis.scope.header.savedAt", "saved {time}", { time: saved })}` : ""}`;
}

export function ScopeHeader({ name, clientName, version, memberName, hasScreens, onShare, onPreview }: {
  name: string; clientName?: string; version: HeaderVersion | null; memberName: (id: string) => string;
  hasScreens: boolean; onShare: () => void; onPreview: () => void;
}) {
  const t = useT();
  return (
    <PageHeader eyebrow={wizardEyebrow(name, clientName)} title={name} subtitle={versionLine(version, memberName)}
      actions={<>
        <Button variant="ghost" icon={<Share2 size={16} strokeWidth={1.75} aria-hidden />} onClick={onShare}>{t("analysis.scope.header.share", "Share")}</Button>
        {hasScreens && <Button variant="ghost" icon={<Eye size={16} strokeWidth={1.75} aria-hidden />} onClick={onPreview}>{t("analysis.scope.header.preview", "Preview the screens")}</Button>}
      </>} />
  );
}
