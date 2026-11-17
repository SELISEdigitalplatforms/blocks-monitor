// The Requirements document's other lists for every seeded project that reached Goals & requirements: the key
// workflows (who does what, step by step), what is not included and the constraints (RequirementExtra rows; rules in
// src/domain/requirementsExtras.ts). The product manager's draft wrote them with the requirements; `by` marks an item a
// person added later. Keyed by project key.
import type { ConstraintKind } from "../../src/domain/setupDetails";
import type { P } from "../model";

export interface ExtrasSeed {
  workflows: { title: string; who: string; steps: string[]; by?: P }[];
  exclusions: { text: string; by?: P }[];
  constraints: { kind: ConstraintKind; text: string; by?: P }[];
}

export const EXTRAS_SEED: Readonly<Record<string, ExtrasSeed>> = {
  "payroll-self-service": {
    workflows: [
      {
        title: "Report the month's hours and absences", who: "HR contact at the employer",
        steps: [
          "Open the month in the portal",
          "Enter hours, overtime, holidays and sick days per employee, or upload the CSV template",
          "Check the totals and submit by the 15th",
          "Lindenhof's payroll team sees the report and starts the payroll run",
        ],
      },
      {
        title: "Report a new hire or a leaver", who: "HR contact at the employer",
        steps: ["Choose new hire or leaver", "Enter name, start or last working day, salary and AHV number", "Submit; the payroll team confirms the change"],
      },
      {
        title: "Get the monthly payslip", who: "Employee",
        steps: ["Gets a notice that the new payslip is ready", "Signs in with e-mail or mobile number", "Opens or downloads the payslip as PDF"],
      },
    ],
    exclusions: [
      { text: "The payroll calculation itself: it stays in the certified payroll software" },
      { text: "Time tracking with clock-in terminals: hours are reported per month" },
      { text: "A native app for the app stores: the portal works in the browser on phones" },
    ],
    constraints: [
      { kind: "deadline", text: "Live for the January 2027 payroll run, so employers report December hours in the portal" },
      { kind: "compliance", text: "Swiss data protection (revDSG): salary data stays in Switzerland and each employer sees only its own staff" },
      { kind: "languages", text: "German and French from the start, Italian later" },
      { kind: "integrations", text: "Export of the month in the payroll software's import format; no live connection" },
    ],
  },
  "order-portal": {
    workflows: [
      {
        title: "Place tomorrow's order", who: "Restaurant buyer",
        steps: ["Opens last week's order or the favourites", "Changes quantities and adds articles", "Sends the order before the 10:00 cut-off", "Gets the order confirmation by e-mail"],
      },
      {
        title: "Check and release the morning's orders", who: "Order desk at Alpine Fresh",
        steps: ["Sees every order that came in overnight", "Clears questions about missing articles with the customer", "Releases the orders to the warehouse at 10:00"],
      },
    ],
    exclusions: [
      { text: "Online payment: customers keep paying by invoice" },
      { text: "Delivery tracking: the driver app shows it to customers later" },
    ],
    constraints: [
      { kind: "deadline", text: "Live before the spring menu change in March" },
      { kind: "integrations", text: "Orders go straight into the ERP; prices and stock come from it" },
      { kind: "languages", text: "German, French and Italian" },
    ],
  },
  "driver-app": {
    workflows: [
      {
        title: "Drive the day's tour", who: "Driver",
        steps: ["Opens the route of the day on the phone", "Checks the temperature of the chilled goods before leaving", "Follows the stops in order"],
      },
      {
        title: "Hand over a delivery", who: "Driver",
        steps: ["Marks the stop as arrived", "Takes a photo of the goods and gets the customer's signature", "The customer sees the delivery as done in the order portal"],
      },
    ],
    exclusions: [
      { text: "Route planning: tours are still planned in the dispatch system" },
      { text: "Fuel and vehicle logs" },
    ],
    constraints: [
      { kind: "integrations", text: "Delivery status goes to the order portal; tours come from the dispatch system" },
      { kind: "other", text: "Works offline in dead spots and sends everything once the network is back" },
    ],
  },
  "spare-parts": {
    workflows: [
      {
        title: "Order a spare part by serial number", who: "Service partner",
        steps: ["Enters the pump's serial number", "Picks the part from the exploded drawing", "Sees the own price and the availability", "Places the order, which goes straight to the ERP"],
      },
    ],
    exclusions: [
      { text: "Repairs and service bookings: they stay with the service portal" },
      { text: "Sales to private customers" },
    ],
    constraints: [
      { kind: "integrations", text: "Customer prices, stock and orders from and to the ERP" },
      { kind: "languages", text: "German and English" },
      { kind: "budget", text: "About EUR 120 000 for the first version" },
    ],
  },
  "service-portal": {
    workflows: [
      {
        title: "Report a service visit on site", who: "Service technician",
        steps: ["Opens the visit on the phone", "Records the work done and the parts used", "Gets the customer's signature", "The PDF service report goes to the customer and to invoicing"],
      },
    ],
    exclusions: [
      { text: "Visit planning: it stays as it works in the portal today" },
    ],
    constraints: [
      { kind: "compliance", text: "GDPR: customer signatures and personal data stay in the EU" },
      { kind: "integrations", text: "Parts used and hours go to invoicing in the ERP" },
    ],
  },
};
