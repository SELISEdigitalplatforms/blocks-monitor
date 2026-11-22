# Factory texts in several languages

- Every visible text: `const t = useT();` then `t("<module>.<area>.<name>", "English text", { params })`.
  Outside React components (helpers, constants): `import { t } from "@/i18n"` and call it at render time, not at module load.
- Modules (one UILM module each, in Blocks OS Localization): shell, auth, landing, pricing, platform, billing, build,
  changes, analysis, project, studio, team, assistant, wiki, settings, common.
- Bundled translations: `src/i18n/locales/<module>.de-CH.json` (nested by key path). English needs no file:
  the English in the call is the source. Swiss German conventions: "ss" instead of "ß", CHF amounts as 1'234.50,
  dates 10.11.2026, formal "Sie".
- `npm run i18n:push` (scripts/uilm-push.mjs) sends every module's keys (English + de-CH) to Blocks UILM.
- A module's German may be split into part files `src/i18n/locales/<module>-<part>.de-CH.json` (same nesting); the
  keys still belong to `<module>` (e.g. `common-language.de-CH.json` holds `common.language.*`).
- Modules and the UILM language codes live in `src/i18n/modules.ts` (English is `en-US` in UILM, German `de-CH`).

## At run time
- `LanguageSwitcher.tsx`: "EN" / "DE" in the top bar (beside the bell), the landing page bar, the sign-in card and
  Settings → You. The choice is kept in this browser (`mf.culture`) and, signed in, on the person's IAM profile
  (`POST /api/auth/language`; the session profile carries it back as `profile.language`). A choice made signed out wins
  at the next sign-in; otherwise the profile's language applies.
- `language.ts`: at start and on every switch the texts come from Blocks UILM through `GET /api/public/i18n/<culture>`
  (no sign-in; the server reads UILM with its service identity, keeps each module 5 minutes, limits per address).
  When that fails the bundled de-CH files and the English in the code are shown — never a key.
- `format.ts`: `formatNumber`, `formatMoney` (CHF/USD, `CHF 1'234.50` in de-CH), `formatPercent`, `formatDate`,
  `formatTime`, `formatDateTime` per language.

## Sending the texts to Blocks UILM
`npm run i18n:push` (dry run) shows per module the keys found in the code, the German available, what is missing and
what UILM would get; `npm run i18n:push -- --apply` sends it (adds the missing languages and modules first, then
English and de-CH per module, one UILM regeneration per push). Keys are only deleted with `--prune`. It uses the Blocks
CLI's login and the project in `frontend/blocks.json` (or `--project <tenantId>`); `--modules a,b` limits the run.
