// Talwerk Fluidsysteme GmbH · Supplier Onboarding Portal, at Business. BROWNFIELD: extends the existing purchasing
// portal in talwerk-fluid/supplier-portal (branch main); the repository is named, hand-over not done yet.
import type { ProjectPlan } from "../../model";

const NADINE: [string, string] = ["Nadine Kraus", "nadine.kraus@talwerk-fluid.de"];
const STEFAN: [string, string] = ["Stefan Brandt", "stefan.brandt@talwerk-fluid.de"];

export const SUPPLIER_ONBOARDING: ProjectPlan = {
  key: "supplier-onboarding",
  workspace: "talwerk",
  name: "Supplier Onboarding Portal",
  client: { name: "Talwerk Fluidsysteme GmbH", contact: "Nadine Kraus", industry: "Industrial pumps and fluid systems", region: "Mannheim, Germany" },
  brief: "New suppliers register themselves in the existing purchasing portal, upload certificates and bank details, and purchasing approves them in one place instead of by e-mail and Excel.",
  stage: "business",
  repo: { mode: "existing", owner: "talwerk-fluid", name: "supplier-portal", branch: "main" },
  creator: "stefan",
  assignee: "stefan",
  lead: "stefan",
  days: { created: "-4d@08:40", updated: "-0d@08:25" },
  docs: {
    folders: [
      { key: "purchasing", name: "Purchasing", kind: "meeting", at: "-4d@08:45", by: "stefan" },
      { key: "portal-today", name: "Purchasing portal today", kind: "other", at: "-4d@08:46", by: "stefan" },
    ],
    scratch: { body: "- About 60 new suppliers a year, 1'200 active\n- Existing portal: orders and invoices, Java/Spring + Angular, own data centre\n- Onboarding today: 9 e-mails on average per supplier, 3 weeks\n- Compliance needs ISO 9001 and REACH declarations", at: "-4d@09:00", by: "stefan" },
    notes: [
      {
        key: "purchasing-call",
        folder: "purchasing",
        title: "Call with purchasing (Nadine Kraus)",
        body: "Call · Nadine Kraus (Head of Purchasing), Stefan Brandt\n\n- Onboarding a supplier takes about 3 weeks; most time goes into chasing documents.\n- Documents: company register extract, ISO 9001, REACH and RoHS declarations, bank details form, code of conduct signature.\n- Bank details are checked by finance with a call-back (fraud risk).\n- Wish: suppliers register in the portal they already use for orders, see what is missing, and purchasing approves in one place.\n- Must stay in our data centre; the portal team (2 developers) maintains the existing code.",
        at: "-3d@14:30",
        by: "stefan",
      },
      {
        key: "repo-notes",
        folder: "portal-today",
        title: "Existing purchasing portal: what is there",
        body: "Repository talwerk-fluid/supplier-portal (branch main)\n\n- Spring Boot 3 back end, Angular 16 front end, PostgreSQL\n- Supplier accounts exist already (orders, invoices), created by purchasing by hand\n- No document upload yet; files are e-mailed and saved in SharePoint\n- CI on the internal GitLab runner, deployments every second Tuesday",
        at: "-2d@10:15",
        by: "stefan",
      },
    ],
    files: [
      {
        key: "checklist",
        folder: "purchasing",
        at: "-3d@14:40",
        by: "stefan",
        file: {
          type: "pdf",
          name: "Supplier onboarding checklist.pdf",
          issued: "-90d",
          issuer: "Talwerk Fluidsysteme GmbH · Purchasing",
          color: "1d4ed8",
          title: "Supplier onboarding checklist",
          subtitle: "Purchasing procedure P-07, revision 4",
          sections: [
            { heading: "Documents", table: { head: ["Document", "Required for", "Valid"], widths: [0.5, 0.3, 0.2], rows: [["Company register extract", "All", "< 6 months"], ["ISO 9001 certificate", "Production parts", "Until expiry"], ["REACH / RoHS declaration", "Materials", "Yearly"], ["Bank details form", "All", "-"], ["Code of conduct", "All", "-"]] } },
            { heading: "Approval", bullets: ["Purchasing checks completeness", "Quality approves production-part suppliers", "Finance confirms bank details by call-back"] },
          ],
        },
      },
      {
        key: "nadine-mail",
        folder: "purchasing",
        at: "-2d@09:00",
        by: "stefan",
        file: {
          type: "eml",
          name: "Supplier onboarding - next steps.eml",
          from: NADINE,
          to: [STEFAN],
          at: "-2d@08:35",
          subject: "Supplier onboarding - next steps",
          body: "Hi Stefan\n\nThanks for the call. Our onboarding checklist is attached to your notes. Two additions:\n\n- Suppliers from outside the EU also need a customs declaration.\n- Quality wants a reminder 60 days before an ISO certificate expires.\n\nCan we look at a first version before the supplier day in February?\n\nNadine",
        },
      },
    ],
  },
};
