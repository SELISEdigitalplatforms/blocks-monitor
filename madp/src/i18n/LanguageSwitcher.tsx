/** The language switch: "EN" / "DE" side by side in one small pill (the SELISE website's pattern), the chosen one
 *  marked. One component for the app's top bar, the landing page's bar, the sign-in and sign-up card and Settings → You;
 *  `tone` matches the surface it sits on. Choosing a language applies it at once (texts from Blocks UILM, the bundled
 *  German as the fallback), keeps it in this browser and, for a signed-in person, in their profile. */
import { cn } from "@/lib/cn";
import { CULTURES, useCulture, useT, type Culture } from "./index";
import { chooseLanguage } from "./language";

export type SwitcherTone = "bar" | "glass" | "plain" | "auth" | "card";

/** Each language names itself in its own language (never translated). */
const OWN_NAME: Record<Culture, string> = { en: "English", "de-CH": "Deutsch (Schweiz)" };

const BOX: Record<SwitcherTone, string> = {
  // the app's top bar: the bar's 48 px pills on the surface fill
  bar: "h-12 bg-surface p-1 dark:ring-1 dark:ring-line",
  // the landing page's bar while it lies over the hero
  glass: "lp-nav-glass h-11 bg-ink/[0.06] p-1 ring-1 ring-ink/10",
  // the landing page's frosted bar
  plain: "h-11 bg-surface2 p-1 ring-1 ring-line",
  // the sign-in and sign-up card's top row
  auth: "h-9 bg-surface2 p-0.5 dark:ring-1 dark:ring-line",
  // inside a card (Settings → You)
  card: "h-10 bg-surface2 p-1 dark:ring-1 dark:ring-line",
};

export function LanguageSwitcher({ tone = "bar", className }: { tone?: SwitcherTone; className?: string }) {
  const t = useT();
  const current = useCulture();
  return (
    <div role="group" aria-label={t("common.language.label", "Language")} className={cn("inline-flex shrink-0 items-center gap-0.5 rounded-full", BOX[tone], className)}>
      {CULTURES.map((c) => {
        const active = c.id === current;
        return (
          <button key={c.id} type="button" lang={c.id} aria-pressed={active} aria-label={OWN_NAME[c.id]} title={OWN_NAME[c.id]}
            onClick={() => { if (!active) void chooseLanguage(c.id); }}
            className={cn("grid h-full min-w-[36px] place-items-center rounded-full px-2 text-[13px] font-semibold tracking-wide outline-none transition focus-visible:ring-2 focus-visible:ring-accent/50",
              active ? "bg-accent-soft text-[rgb(var(--c-accent-text))]" : "text-ink2 hover:bg-ink/[0.06] hover:text-ink")}>
            {c.short}
          </button>
        );
      })}
    </div>
  );
}

/** Settings → You: the language as the person's preference (kept in their profile; the top bar's switch is the same). */
export function LanguagePreference() {
  const t = useT();
  return (
    <div className="mt-5 flex flex-col gap-3 border-t border-line pt-4 sm:flex-row sm:items-center">
      <div className="min-w-0">
        <div className="text-[14px] font-medium">{t("common.language.label", "Language")}</div>
        <div className="text-[13px] text-ink3">{t("common.language.hint", "The Factory's language for you, on every device you sign in on.")}</div>
      </div>
      <LanguageSwitcher tone="card" className="sm:ml-auto" />
    </div>
  );
}
