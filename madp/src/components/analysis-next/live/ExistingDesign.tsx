/** "Screens and look & feel" of a live product documented from its code: the existing design system it was read from
 *  (DesignBrief.PrototypeJson, provider "existing-system": src/domain/liveProduct.ts parseExistingDesignSystem), shown
 *  as it is: the colour themes people can pick, the base colours, the typefaces, light and dark, the corner radii and
 *  the files it lives in. Nothing is designed or generated here: the product already has its look & feel. */
import type { ExistingDesignSystem } from "@/domain/liveProduct";
import { t, useT } from "@/i18n";

const LABEL = "text-[12px] font-medium uppercase tracking-wide text-ink3";

const words = (items: readonly string[]) =>
  items.length <= 1 ? items[0] ?? "" : t("analysis.live.listAnd", "{first} and {last}", { first: items.slice(0, -1).join(", "), last: items[items.length - 1]! });

/** "primary-hover" → "Primary hover". */
const tokenName = (token: string) => token.charAt(0).toUpperCase() + token.slice(1).replace(/-/g, " ");

function Swatch({ color, name, sub }: { color: string; name: string; sub?: string }) {
  return (
    <li className="flex min-w-0 items-center gap-2.5">
      <span aria-hidden className="h-7 w-7 shrink-0 rounded-full ring-1 ring-line" style={{ backgroundColor: color }} />
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-[13px] text-ink">{name}</span>
        <span className="num truncate text-[12px] text-ink3">{sub ?? color}</span>
      </span>
    </li>
  );
}

export function ExistingDesign({ system }: { system: ExistingDesignSystem }) {
  const t = useT();
  const colors = Object.entries(system.colors);
  const radius = Object.entries(system.radius);
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <p className="text-[14px] leading-6 text-ink2">
        {t("analysis.live.design.intro", "The product already has its look & feel: this is the design system it is built with, read from its code. Changes to it go through a change request.")}
      </p>
      {system.themes.length > 0 && (
        <section className="flex flex-col gap-2.5">
          <h4 className={LABEL}>{system.themes.length === 1 ? t("analysis.live.design.colourTheme", "Colour theme") : t("analysis.live.design.themesToPick", "{count} colour themes people can pick", { count: system.themes.length })}</h4>
          <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
            {system.themes.map((th) => <Swatch key={th.id || th.name} color={th.color} name={th.name} />)}
          </ul>
        </section>
      )}
      {colors.length > 0 && (
        <section className="flex flex-col gap-2.5">
          <h4 className={LABEL}>{t("analysis.live.design.baseColours", "Base colours")}</h4>
          <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
            {colors.slice(0, 18).map(([k, v]) => <Swatch key={k} color={v} name={tokenName(k)} />)}
          </ul>
        </section>
      )}
      <dl className="grid min-w-0 grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-[max-content_minmax(0,1fr)]">
        {system.fonts.length > 0 && (<><dt className="text-[13px] text-ink3">{t("analysis.live.design.typefaces", "Typefaces")}</dt><dd className="break-words text-[14px] text-ink">{words(system.fonts)}</dd></>)}
        {system.modes.length > 0 && (<><dt className="text-[13px] text-ink3">{t("analysis.live.design.modes", "Modes")}</dt><dd className="text-[14px] text-ink">{system.modes.length === 2 ? t("analysis.live.design.lightAndDark", "Light and dark") : system.modes[0] === "dark" ? t("analysis.live.design.dark", "Dark") : t("analysis.live.design.light", "Light")}</dd></>)}
        {radius.length > 0 && (<><dt className="text-[13px] text-ink3">{t("analysis.live.design.corners", "Corners")}</dt><dd className="break-words text-[14px] text-ink">{radius.map(([k, v]) => `${tokenName(k)} ${v}`).join(" · ")}</dd></>)}
        {system.files.length > 0 && (<><dt className="text-[13px] text-ink3">{t("analysis.live.design.whereItLives", "Where it lives")}</dt><dd className="min-w-0 break-words text-[13px] text-ink2"><span className="num">{system.files.slice(0, 4).join(", ")}</span>{system.files.length > 4 ? ` ${t("analysis.live.design.andMore", "and {count} more", { count: system.files.length - 4 })}` : ""}</dd></>)}
      </dl>
    </div>
  );
}
