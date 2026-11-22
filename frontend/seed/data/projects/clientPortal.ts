// Lindenhof Treuhand AG · Client Document Portal, at Existing product analysis (sanitization of a brownfield project:
// the existing GitHub repository lindenhof-treuhand/klientenportal). Questions still open; the technical assist failed
// because MADP has no access to the repository yet.
import type { ProjectPlan } from "../../model";

const CLAUDIA: [string, string] = ["Claudia Imhof", "claudia.imhof@lindenhof-treuhand.ch"];
const RETO: [string, string] = ["Reto Arnold", "reto.arnold@selisegroup.com"];

export const CLIENT_PORTAL: ProjectPlan = {
  key: "client-portal",
  workspace: "lindenhof",
  name: "Client Document Portal",
  client: { name: "Lindenhof Treuhand AG", contact: "Claudia Imhof", industry: "Fiduciary and accounting", region: "Lucerne, Switzerland" },
  brief: "The existing client portal (receipts upload, annual statements) is slow and hard to use. Clients should upload receipts from the phone, see what is missing for their tax return and sign documents online.",
  stage: "sanitization",
  repo: { mode: "existing", owner: "lindenhof-treuhand", name: "klientenportal", branch: "main" },
  creator: "reto",
  assignee: "simon",
  assignedBy: "reto",
  lead: "simon",
  handedOverBy: "reto",
  days: { created: "-9d@08:50", handedOver: "-3d@10:05", updated: "-0d@10:12" },
  docs: {
    folders: [
      { key: "meetings", name: "Meetings", kind: "meeting", at: "-9d@08:55", by: "reto" },
      { key: "existing", name: "Existing portal", kind: "other", at: "-9d@08:56", by: "reto" },
      { key: "workshop", name: "Workshop 15 Oct", kind: "ideation", parent: "meetings", at: "-8d@13:00", by: "beat" },
    ],
    scratch: { body: "- 850 active clients, 70% upload at least once a year\n- Peak: February to April (tax returns)\n- Portal today: PHP 7.4 / Laravel 6, MySQL, hosted at Lindenhof's provider\n- E-signature: they already use a Swiss provider for mandates", at: "-9d@09:30", by: "reto" },
    notes: [
      {
        key: "kickoff",
        folder: "meetings",
        title: "Kick-off with Claudia Imhof and Beat Zimmermann",
        body: "Kick-off · Claudia Imhof (managing partner), Beat Zimmermann (IT and operations), Reto Arnold, Simon Gerber\n\n- The portal was built in 2019 by a local agency that no longer supports it.\n- Clients complain: upload from the phone fails for photos above 5 MB, the receipts list has no search.\n- Staff spend about 2 days per week chasing missing documents before tax deadlines.\n- Wish 1: a checklist per client of what is still missing for the tax return.\n- Wish 2: upload receipts from the phone camera, several at once.\n- Wish 3: sign the annual statement online instead of printing and scanning.\n- The portal must keep working during the change; clients must not need a new login.\n- Data must stay in Switzerland (professional secrecy).",
        at: "-8d@11:30",
        by: "reto",
      },
      {
        key: "workshop-notes",
        folder: "workshop",
        title: "Workshop notes: missing documents checklist",
        body: "## What a fiduciary asks for, per client type\n\n- Employed: salary statement, pillar 3a, health insurance premiums\n- Self-employed: bank statements, receipts, vehicle log\n- Property owners: mortgage interest, maintenance invoices\n\n## How staff work today\n\nExcel list per client, updated by hand. Reminder e-mails written one by one.\n\n## Agreed\n\nThe checklist is created from last year's documents; staff can add items.",
        at: "-7d@16:20",
        by: "beat",
      },
      {
        key: "portal-review",
        folder: "existing",
        title: "First look at the existing portal",
        body: "Simon's notes from a walkthrough with Beat (staging copy):\n\n- Laravel 6 app, server-rendered Blade views, jQuery on the upload page\n- Files stored on the provider's disk, no virus scan\n- Login: e-mail + password, password reset by staff only\n- 14 database tables; receipts are linked to a client and a tax year\n- No API; the accounting software (Abacus-like ERP) is filled by hand\n\nQuestion: rebuild the client front end and keep the data, or migrate everything?",
        at: "-4d@15:45",
        by: "simon",
      },
    ],
    files: [
      {
        key: "portal-screenshot",
        folder: "existing",
        at: "-4d@15:50",
        by: "simon",
        file: {
          type: "png",
          name: "Existing portal - receipts list.png",
          image: {
            type: "screen",
            device: "desktop",
            brand: "7a4b2a",
            app: "KLIENTENPORTAL",
            title: "Belege 2025",
            nav: ["Start", "Belege", "Dokumente", "Profil"],
            activeNav: 1,
            blocks: [
              { k: "table", head: ["Datei", "Datum", "Grosse", "Status"], rows: [["IMG_2231.jpg", "03.02.2026", "4.8 MB", "OK"], ["Lohnausweis.pdf", "11.02.2026", "220 KB", "OK"], ["IMG_2240.jpg", "-", "6.1 MB", "Fehler"], ["Krankenkasse.pdf", "02.03.2026", "180 KB", "OK"]] },
              { k: "button", text: "Datei hochladen" },
            ],
            mark: { x: 0.52, y: 0.27, r: 0.06 },
          },
        },
      },
      {
        key: "offer",
        folder: "meetings",
        at: "-6d@09:10",
        by: "reto",
        file: {
          type: "pdf",
          name: "Offer Client Document Portal phase 1.pdf",
          issued: "-6d",
          issuer: "SELISE",
          color: "1f3a5f",
          title: "Offer: Client Document Portal, phase 1",
          subtitle: "For Lindenhof Treuhand AG, Lucerne",
          meta: [["Offer number", "OF-2026-1184"], ["Valid until", "30 days"], ["Contact", "Reto Arnold"]],
          sections: [
            { heading: "Scope", paragraphs: ["Phase 1 renews the client-facing part of the existing portal: mobile upload, missing documents checklist and online signature of the annual statement. The existing data and logins are kept."] },
            { heading: "Approach", bullets: ["Existing product analysis of the current repository and database", "Requirements and scope confirmation with Lindenhof", "Delivery in milestones with a preview after each"] },
            { heading: "Price", table: { head: ["Item", "CHF"], widths: [0.7, 0.3], rows: [["Analysis and requirements", "6'800"], ["Delivery (3 milestones)", "28'400"], ["Total excl. VAT", "35'200"]] } },
          ],
        },
      },
      {
        key: "claudia-email",
        folder: "meetings",
        at: "-5d@08:30",
        by: "reto",
        file: {
          type: "eml",
          name: "RE Offer Client Document Portal.eml",
          from: CLAUDIA,
          to: [RETO],
          at: "-5d@07:55",
          subject: "RE: Offer Client Document Portal phase 1",
          body: "Dear Mr Arnold\n\nThank you for the offer. The partners agreed to start with phase 1.\n\nImportant for us: the portal must be available during the tax season (February to April), so no switch-over in that period. And our clients should keep their current login.\n\nMr Zimmermann will give your team access to the code.\n\nKind regards\nClaudia Imhof\nManaging partner, Lindenhof Treuhand AG",
        },
      },
    ],
  },
  sanitization: {
    clarifications: [
      { key: "keep-or-migrate", q: "Do we rebuild only the client front end on the existing database, or migrate the data into a new system?", status: "open", owner: "simon", at: "-3d@11:00", source: "note:portal-review" },
      { key: "file-size", q: "Up to which file size and which file types must clients be able to upload?", a: "Photos and PDFs up to 20 MB each, several at once; no Office files.", status: "answered", owner: "beat", answeredBy: "beat", answeredAt: "-2d@09:10", at: "-3d@11:00", source: "note:kickoff" },
      { key: "signature", q: "Which e-signature provider and which signature level (simple or qualified) are required for the annual statement?", status: "open", owner: "beat", at: "-3d@11:05", source: "note:kickoff" },
      { key: "hosting", q: "Where must the new parts be hosted so the data stays in Switzerland?", a: "Swiss data centre only; Lindenhof's provider or a Swiss cloud region are both fine.", status: "answered", owner: "reto", answeredBy: "beat", answeredAt: "-2d@09:20", at: "-3d@11:05", source: "file:claudia-email" },
      { key: "tax-season", q: "Can a switch-over happen in March?", status: "deferred", deferReason: "No switch-over between February and April (Claudia Imhof's e-mail); timing is planned with the milestones.", owner: "reto", at: "-3d@11:10", source: "file:claudia-email" },
      { key: "abacus", q: "Should receipts flow into the accounting software automatically, or stay a manual step in phase 1?", status: "open", owner: "simon", at: "-1d@10:40" },
    ],
    decisions: [
      { key: "keep-logins", title: "Clients keep their current login", statement: "Existing client accounts and passwords stay valid; nobody has to register again.", rationale: "Claudia Imhof's condition for phase 1; 850 clients cannot be re-onboarded before the tax season.", by: "reto", at: "-2d@11:00", source: "file:claudia-email" },
      { key: "swiss-hosting", title: "Data stays in Switzerland", statement: "All documents and data of the portal are stored in a Swiss data centre.", rationale: "Professional secrecy of the fiduciary.", by: "simon", at: "-2d@11:05", clar: "hosting" },
    ],
    tech: [
      { key: "existing-stack", area: "stack", title: "Keep the Laravel back end for phase 1", choice: "New mobile-first client front end; the Laravel 6 back end and MySQL data stay and get an API", rationale: "Keeps logins and data, lowest risk before the tax season.", alternatives: ["Full rebuild on SELISE Blocks", "Upgrade the Blade views only"], experts: ["simon"], status: "proposed", by: "simon", at: "-2d@14:00" },
      { key: "upload-limits", area: "nfr", title: "Upload of large phone photos", choice: "Client-side resizing to 3000 px and chunked upload up to 20 MB", rationale: "Most failed uploads today are phone photos above 5 MB.", alternatives: ["Raise the server limit only"], experts: ["simon"], status: "accepted", by: "simon", at: "-2d@14:10", nfr: { category: "performance", target: "A 20 MB upload succeeds on a 4G phone within 30 seconds" } },
      { key: "esign", area: "integration", title: "E-signature provider", choice: "Use Lindenhof's existing Swiss e-signature provider through its API", rationale: "Already contracted for mandates; clients know it.", alternatives: ["New provider", "Sign by scanning"], experts: ["beat"], status: "proposed", by: "simon", at: "-2d@14:20", system: "Swiss e-signature provider (existing contract)" },
    ],
    discussion: [
      { by: "reto", at: "-3d@10:10", text: "Handed over. Beat is getting us read access to the repository today." },
      { by: "beat", at: "-2d@08:45", text: "Access request is with our provider, they need a signed NDA first. Expect it on Monday." },
      { by: "simon", at: "-0d@10:05", text: "The technical analysis could not read the repository yet. I'll re-run it as soon as Beat confirms the access." },
    ],
    assistFailure: { at: "-0d@09:58", message: "The repository could not be read: MADP has no access to lindenhof-treuhand/klientenportal yet.", error: "engine.repoAccess" },
  },
  requirements: [
    { key: "mobile-upload", title: "Clients upload receipts from the phone", text: "Clients take photos or pick files on the phone and upload several receipts at once, up to 20 MB each.", category: "functional", priority: "must", criteria: ["Several files can be uploaded in one go", "Photos up to 20 MB upload on a 4G connection", "Each upload is assigned to a tax year"], sources: ["note:kickoff", "clar:file-size"] },
    { key: "missing-checklist", title: "Clients see what is still missing", text: "Each client sees a checklist of documents still missing for the tax return, created from last year's documents.", category: "functional", priority: "must", criteria: ["The checklist is created from the previous tax year", "Staff can add or remove items", "An uploaded document ticks its item"], sources: ["note:workshop-notes"] },
    { key: "online-signature", title: "Annual statements are signed online", text: "Clients sign the annual statement online with the existing e-signature provider.", category: "integration", priority: "must", criteria: ["The client is notified when a statement is ready to sign", "The signed document is stored with the client"], sources: ["note:kickoff"] },
    { key: "keep-login", title: "Existing logins keep working", text: "Clients sign in with their current e-mail and password.", category: "security", priority: "must", criteria: ["No client has to register again", "Password reset works without staff"], sources: ["dec:keep-logins"] },
    { key: "receipt-search", title: "Clients and staff search receipts", text: "Receipts can be found by name, date and tax year.", category: "functional", priority: "nice", criteria: ["Search by file name and date", "Filter by tax year"], sources: ["note:kickoff"] },
  ],
  objective: {
    statement: "Lindenhof's 850 clients upload receipts from their phone, see what is still missing for their tax return and sign the annual statement online, on the existing portal and with their current login.",
    criteria: ["Uploads from the phone succeed for files up to 20 MB", "Every client has a missing-documents checklist", "Annual statements are signed online"],
    highLevelMd: "## Users\n- About 850 clients of Lindenhof Treuhand (employed, self-employed, property owners)\n- Fiduciary staff who prepare tax returns\n\n## Main flows\n- Upload receipts from the phone\n- Check the missing-documents list\n- Sign the annual statement",
    architectureMd: "New mobile-first client front end on top of the existing Laravel back end, extended with an API; Swiss hosting; e-signature through the existing provider.",
  },
};
