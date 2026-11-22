// Talwerk Fluidsysteme GmbH · Trade Fair Lead App, ABANDONED at Business (the fair team chose the fair organiser's
// lead scanner instead). Greenfield, never handed over.
import type { ProjectPlan } from "../../model";

const MARTINA: [string, string] = ["Martina Lang", "martina.lang@talwerk-fluid.de"];
const KATRIN: [string, string] = ["Katrin Vogel", "katrin.vogel@talwerk-fluid.de"];

export const TRADE_FAIR: ProjectPlan = {
  key: "trade-fair-leads",
  workspace: "talwerk",
  name: "Trade Fair Lead App",
  client: { name: "Talwerk Fluidsysteme GmbH", contact: "Martina Lang", industry: "Industrial pumps and fluid systems", region: "Mannheim, Germany" },
  brief: "Sales staff at trade fairs capture visitor contacts and their pump requirements on a tablet; leads go straight to the CRM with a follow-up task.",
  stage: "abandoned",
  resumeTo: "business",
  repo: { mode: "new" },
  creator: "katrin",
  lead: "katrin",
  days: { created: "-34d@13:00", stopped: "-27d@11:10", updated: "-27d@11:10" },
  docs: {
    folders: [{ key: "fair", name: "Hannover fair", kind: "event", at: "-34d@13:05", by: "katrin" }],
    notes: [
      {
        key: "fair-wishes",
        folder: "fair",
        title: "What the fair team wants",
        body: "- Scan the visitor badge, add the pump type and the application (water, chemicals, food)\n- Photo of a business card when there is no badge\n- Lead in the CRM the same evening with a follow-up task for the regional sales rep\n- About 600 contacts per fair, 4 fairs a year",
        at: "-33d@10:20",
        by: "katrin",
      },
      {
        key: "decision",
        folder: "fair",
        title: "Decision: organiser's lead scanner for this year",
        body: "The fair team will use the organiser's lead scanner for the next fairs: it reads the badges directly and exports to the CRM. No own app this year; to be reviewed after the spring fair.",
        at: "-27d@11:00",
        by: "katrin",
      },
    ],
    files: [
      {
        key: "martina-mail",
        folder: "fair",
        at: "-27d@10:50",
        by: "katrin",
        file: {
          type: "eml",
          name: "Lead scanner from the organiser.eml",
          from: MARTINA,
          to: [KATRIN],
          at: "-27d@10:15",
          subject: "Lead scanner from the organiser",
          body: "Hi Katrin\n\nThe organiser now offers a lead scanner for exhibitors that reads the badges and exports straight into our CRM, for 390 euros per fair. For this year that is enough for us. Let's put the app on hold.\n\nMartina",
        },
      },
    ],
  },
};
