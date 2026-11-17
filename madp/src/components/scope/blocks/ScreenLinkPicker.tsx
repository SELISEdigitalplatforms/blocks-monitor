/** Which generated screens a feature shows on: a labelled checkbox list of the project's DesignScreen records. */
import { useId } from "react";
import { Label } from "@/ui/kit";
import type { DesignScreenRecord } from "../../../blocks/scope/records";
import { useT } from "@/i18n";

/** Up to 30 screen links per feature (SCOPE_LIMITS in src/domain/scope.ts). */
const MAX_LINKS = 30;

export function ScreenLinkPicker({ screens, value, editable, onChange }: {
  screens: DesignScreenRecord[];
  value: string[];
  editable: boolean;
  onChange: (next: string[]) => void;
}) {
  const t = useT();
  const uid = useId();
  const names = new Map(screens.map((s) => [s.id, s.name]));
  const linked = value.map((id) => names.get(id)).filter((n): n is string => Boolean(n));
  return (
    <fieldset>
      <legend><Label>{t("analysis.scope.summary.screens", "Screens")}</Label></legend>
      {screens.length === 0 ? (
        <p className="text-[13px] text-ink3">{t("analysis.scope.screenLinks.none", "No screens yet.")}</p>
      ) : !editable ? (
        <p className="text-[13px] text-ink2 [overflow-wrap:anywhere]">{linked.length > 0 ? linked.join(", ") : t("analysis.scope.screenLinks.noneLinked", "No screens linked.")}</p>
      ) : (
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {screens.map((s) => {
            const checked = value.includes(s.id);
            return (
              <li key={s.id}>
                <label htmlFor={`${uid}-${s.id}`} className="flex min-h-[32px] items-center gap-2 text-[14px] text-ink">
                  <input id={`${uid}-${s.id}`} type="checkbox" className="h-4 w-4 accent-[rgb(var(--c-accent))]" checked={checked}
                    disabled={!checked && value.length >= MAX_LINKS}
                    onChange={() => onChange(checked ? value.filter((x) => x !== s.id) : [...value, s.id])} />
                  <span className="min-w-0 [overflow-wrap:anywhere]">{s.name}</span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </fieldset>
  );
}
