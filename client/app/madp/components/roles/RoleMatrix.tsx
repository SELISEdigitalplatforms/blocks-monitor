import { Check } from "lucide-react";
import { useT } from "@/madp/i18n";

/** Editing (optional): a role whose key `editable` accepts shows a checkbox per permission; `onToggle` saves the change. */
export function RoleMatrix({ caption, roles, areas, labels, editable, onToggle, busy }: {
  caption: string;
  roles: readonly { key: string; name: string; permissions: readonly string[] }[];
  areas: readonly { key: string; name: string; permissions: readonly string[] }[];
  labels: Readonly<Record<string, string>>;
  editable?: (roleKey: string) => boolean;
  onToggle?: (roleKey: string, permission: string, next: boolean) => void;
  busy?: boolean;
}) {
  const t = useT();
  const cell = (r: { key: string; name: string; permissions: readonly string[] }, p: string, center: boolean) => {
    const held = r.permissions.includes(p);
    if (onToggle && editable?.(r.key)) {
      return (
        <input type="checkbox" checked={held} disabled={busy} aria-label={`${labels[p] ?? p}: ${r.name}`}
          onChange={(e) => onToggle(r.key, p, e.target.checked)}
          className={`h-4 w-4 accent-[rgb(var(--c-accent))] disabled:opacity-60${center ? " mx-auto block" : ""}`} />
      );
    }
    return held
      ? <span className="inline-flex items-center"><Check size={16} strokeWidth={1.75} aria-hidden="true" className={`text-success${center ? " mx-auto" : ""}`} /><span className="sr-only">{t("platform.roleMatrix.yes", "Yes")}</span></span>
      : <span className="inline-flex items-center"><span aria-hidden="true" className="text-ink3">–</span><span className="sr-only">{t("platform.roleMatrix.no", "No")}</span></span>;
  };
  return (
    <>
    <div className="hidden sm:block">
    <div role="region" aria-label={caption} tabIndex={0} className="w-full max-w-full min-w-0 overflow-x-auto rounded-block outline-none [contain:inline-size] focus-visible:ring-2 focus-visible:ring-accent/50">
      <table className="w-full min-w-[480px] border-collapse text-left text-[14px]">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className="px-3 py-2 text-[12px] font-medium uppercase tracking-wider text-ink3">{t("platform.roleMatrix.whatTheyCanDo", "What they can do")}</th>
            {roles.map((r) => (
              <th key={r.key} scope="col" className="px-3 py-2 text-center text-[13px] font-medium text-ink [overflow-wrap:anywhere]">{r.name}</th>
            ))}
          </tr>
        </thead>
        {areas.map((area) => (
          <tbody key={area.key}>
            <tr>
              <th scope="colgroup" colSpan={roles.length + 1} className="bg-surface2 px-3 py-2 text-[12px] font-medium uppercase tracking-wider text-ink2">{area.name}</th>
            </tr>
            {area.permissions.map((p) => (
              <tr key={p} className="border-b border-line">
                <th scope="row" className="px-3 py-2 font-normal text-ink [overflow-wrap:anywhere]">{labels[p] ?? p}</th>
                {roles.map((r) => (
                  <td key={r.key} className="px-3 py-2 text-center">{cell(r, p, true)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
    </div>
    <div role="group" aria-label={caption} className="flex flex-col gap-3 sm:hidden">
      {areas.map((area) => (
        <section key={area.key} className="flex flex-col gap-2">
          <h4 className="px-1 text-[12px] font-medium uppercase tracking-wider text-ink2">{area.name}</h4>
          {area.permissions.map((p) => (
            <dl key={p} className="rounded-block bg-surface2 p-3">
              <dt className="text-[14px] text-ink [overflow-wrap:anywhere]">{labels[p] ?? p}</dt>
              {roles.map((r) => (
                <dd key={r.key} className="mt-1 flex items-center justify-between gap-3 text-[13px] text-ink2">
                  <span className="min-w-0 [overflow-wrap:anywhere]">{r.name}</span>
                  {cell(r, p, false)}
                </dd>
              ))}
            </dl>
          ))}
        </section>
      ))}
    </div>
    </>
  );
}
