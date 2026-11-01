import { registerTranslations } from "@seliseblocks/genesis-os/i18n";

// One English dictionary per module. German comes from the localization service.
const modules: Record<string, Record<string, string>> = {};

for (const [module, dictionary] of Object.entries(modules)) {
  registerTranslations(module, dictionary);
}
