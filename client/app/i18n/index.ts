import { registerTranslations } from "@seliseblocks/genesis-os/i18n";
import shared from "./monitor.shared.en.json";
import monitors from "./monitor.monitors.en.json";

// One English dictionary per module. German comes from the localization service.
const modules: Record<string, Record<string, string>> = {
  "monitor.shared": shared,
  "monitor.monitors": monitors,
};

for (const [module, dictionary] of Object.entries(modules)) {
  registerTranslations(module, dictionary);
}
