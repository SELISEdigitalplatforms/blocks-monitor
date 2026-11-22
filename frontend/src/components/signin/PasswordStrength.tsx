import { Check, Circle } from "lucide-react";
import { checkPassword } from "@/domain/signup";
import { passwordCheckLabel } from "@/blocks/account";
import { useT } from "@/i18n";

const TONE = ["", "bg-danger", "bg-warning", "bg-success"];

/** Live checklist of the new-password policy (src/domain/signup.ts); the server enforces the same rules. */
export function PasswordStrength({ password, id, email = "" }: { password: string; id: string; email?: string }) {
  const t = useT();
  const { checks } = checkPassword(password, email);
  const met = password ? checks.filter((c) => c.met).length : 0;
  return (
    <div className="mt-3">
      <div className="flex gap-1.5" aria-hidden="true">
        {[1, 2, 3].map((n) => (
          <span key={n} className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
            <span
              className={`block h-full w-full origin-left rounded-full transition-transform duration-200 motion-reduce:transition-none ${TONE[met]}`}
              style={{ transform: `scaleX(${met >= n ? 1 : 0})` }}
            />
          </span>
        ))}
      </div>
      <ul id={id} className="mt-2 grid grid-cols-1 gap-y-1">
        {checks.map((it) => {
          const ok = password !== "" && it.met;
          return (
            <li key={it.key} className={`flex items-center gap-2 text-[13px] ${ok ? "text-ink" : "text-ink2"}`}>
              {ok
                ? <Check size={14} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-success" />
                : <Circle size={14} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-ink3" />}
              <span>{passwordCheckLabel(it.key, it.label)}</span>
              <span className="sr-only">{ok ? t("auth.passwordStrength.met", "met") : t("auth.passwordStrength.notMet", "not met")}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
