import type { ChecklistArea } from "@/domain/roles";
import { t, useT } from "@/i18n";
import { permissionAreaName, permissionLabelText } from "./permissionText";

/** The checklist's reasons come from domain/roles in English; each known one has its own key. */
const REASON: Readonly<Record<string, () => string>> = {
  "You don't hold this permission, so you can't grant it.": () => t("platform.permissionChecklist.reason.notHeld", "You don't hold this permission, so you can't grant it."),
  "You don't hold this permission: once removed, you can't add it back.": () => t("platform.permissionChecklist.reason.keepOnly", "You don't hold this permission: once removed, you can't add it back."),
  "Only the super admin can grant this.": () => t("platform.permissionChecklist.reason.superAdminOnly", "Only the super admin can grant this."),
};

function reasonText(reason: string): string {
  return Object.prototype.hasOwnProperty.call(REASON, reason) ? REASON[reason]() : reason;
}

/** The permission's label in the current language; a key outside the catalogue keeps the label it came with. */
function itemLabel(item: { key: string; label: string }): string {
  const text = permissionLabelText(item.key);
  return text === item.key ? item.label : text;
}

function areaName(area: ChecklistArea): string {
  const scope = area.items.some((i) => i.key.startsWith("platform.")) ? "platform" : "workspace";
  return permissionAreaName(area, scope);
}

export function PermissionChecklist({ areas, onToggle, idPrefix, readOnly }: {
  areas: readonly ChecklistArea[]; onToggle: (key: string, checked: boolean) => void; idPrefix: string; readOnly?: boolean;
}) {
  const t = useT();
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {areas.map((area) => {
        const done = area.items.filter((i) => i.checked).length;
        const name = areaName(area);
        return (
          <fieldset key={area.key} className="min-w-0 rounded-block bg-surface2 p-4">
            <legend className="sr-only">{name}</legend>
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2" aria-hidden="true">
              <span className="text-[14px] font-medium text-ink [overflow-wrap:anywhere]">{name}</span>
              <span className="text-[12px] text-ink3">{t("platform.permissionChecklist.count", "{done} of {total}", { done, total: area.items.length })}</span>
            </div>
            <span className="sr-only">{t("platform.permissionChecklist.countSelected", "{done} of {total} selected", { done, total: area.items.length })}</span>
            <ul className="space-y-2.5">
              {area.items.map((item) => {
                const id = `${idPrefix}-${area.key}-${item.key}`;
                const reasonId = `${id}-reason`;
                const showReason = !readOnly && item.reason;
                return (
                  <li key={item.key} className="flex items-start gap-3">
                    <input id={id} type="checkbox" checked={item.checked} disabled={readOnly || item.disabled}
                      aria-describedby={showReason ? reasonId : undefined}
                      onChange={(e) => onToggle(item.key, e.target.checked)}
                      className="mt-1 h-4 w-4 shrink-0 accent-accent disabled:cursor-not-allowed disabled:opacity-60" />
                    <div className="min-w-0">
                      <label htmlFor={id} className="block cursor-pointer text-[14px] text-ink [overflow-wrap:anywhere]">
                        {itemLabel(item)} <span className="font-mono text-[12px] text-ink3">{item.key}</span>
                      </label>
                      {showReason && <p id={reasonId} className="mt-0.5 text-[12px] text-ink2 [overflow-wrap:anywhere]">{reasonText(item.reason ?? "")}</p>}
                    </div>
                  </li>
                );
              })}
            </ul>
          </fieldset>
        );
      })}
    </div>
  );
}
