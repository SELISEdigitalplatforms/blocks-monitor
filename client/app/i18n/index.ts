/**
 * i18n modules. English lives here (`<module>.en.json`); other languages come from the
 * localization service.
 *
 * - `monitor.shared` (17 keys): components/common, components/core, constants, hooks, utils, routes, layouts
 * - `monitor.monitors` (104 keys): pages/monitor, components/module/monitor, constants/monitor.constant.ts, constants/alert.constant.ts
 * - `monitor.alerts` (25 keys): components/module/alert, hooks/use-alerts.ts, models/alerts.model.ts
 * - `monitor.console` (10 keys): pages/incidents, components/module/incident
 * - `monitor.alert-recipients` (64 keys): pages/alert-recipients, components/module/alert-recipients
 * - `monitor.repos` (141 keys): pages/repos, components/module/repos
 * Total: 361 keys.
 */
import { registerTranslations } from "@seliseblocks/genesis-os/i18n";
import shared from "./monitor.shared.en.json";
import monitors from "./monitor.monitors.en.json";
import alerts from "./monitor.alerts.en.json";
import console from "./monitor.console.en.json";
import alert_recipients from "./monitor.alert-recipients.en.json";
import repos from "./monitor.repos.en.json";

// One English dictionary per module. German comes from the localization service.
const modules: Record<string, Record<string, string>> = {
  "monitor.shared": shared,
  "monitor.monitors": monitors,
  "monitor.alerts": alerts,
  "monitor.console": console,
  "monitor.alert-recipients": alert_recipients,
  "monitor.repos": repos,
};

for (const [module, dictionary] of Object.entries(modules)) {
  registerTranslations(module, dictionary);
}
