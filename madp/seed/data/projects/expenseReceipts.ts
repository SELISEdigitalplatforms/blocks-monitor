// Lindenhof Treuhand AG · Expense Receipts App, PAUSED during sanitization (waiting for the new accounting software).
// Greenfield; the open questions and the draft requirements stay as they were when it was paused.
import type { ProjectPlan } from "../../model";

export const EXPENSE_RECEIPTS: ProjectPlan = {
  key: "expense-receipts",
  workspace: "lindenhof",
  name: "Expense Receipts App",
  client: { name: "Lindenhof Treuhand AG", contact: "Beat Zimmermann", industry: "Fiduciary and accounting", region: "Lucerne, Switzerland" },
  brief: "Small business clients photograph expense receipts on the go; the receipts are read, categorised and booked into their accounting without paper envelopes at the end of the quarter.",
  stage: "paused",
  resumeTo: "sanitization",
  repo: { mode: "new" },
  creator: "reto",
  assignee: "reto",
  lead: "reto",
  handedOverBy: "reto",
  days: { created: "-30d@10:00", handedOver: "-25d@09:30", stopped: "-19d@16:45", updated: "-19d@16:45" },
  docs: {
    folders: [{ key: "meetings", name: "Meetings", kind: "meeting", at: "-30d@10:05", by: "reto" }],
    scratch: { body: "- 300 small business clients, most send receipts quarterly in an envelope\n- Booking is done in the accounting software (to be replaced in 2027)\n- OCR of Swiss receipts: VAT number, amount, VAT rate", at: "-30d@10:30", by: "reto" },
    notes: [
      {
        key: "first-call",
        folder: "meetings",
        title: "First call: receipts from small business clients",
        body: "Call · Beat Zimmermann, Reto Arnold\n\n- Clients collect receipts in envelopes and bring them every quarter.\n- The team sorts and books about 9'000 receipts per quarter by hand.\n- Wish: clients photograph receipts; the app reads amount, date, VAT and suggests the account.\n- Booking interface depends on the accounting software. Lindenhof is evaluating a new one; decision expected in January.",
        at: "-28d@14:20",
        by: "reto",
      },
    ],
    files: [
      {
        key: "receipt-photo",
        folder: "meetings",
        at: "-27d@09:10",
        by: "beat",
        file: {
          type: "png",
          name: "Receipt from a client - Restaurant Krone.png",
          image: { type: "screen", device: "mobile", brand: "8a9a5b", app: "RECEIPT", title: "Restaurant Krone", blocks: [{ k: "list", items: [["2x Menu of the day", "39.00"], ["1x Mineral water", "4.50"], ["VAT 8.1%", "3.26"]] }, { k: "stats", items: [["Total CHF", "43.50"], ["Date", "07.10"]] }, { k: "note", text: "VAT no. CHE-123.456.789 MWST - thank you for your visit" }] },
        },
      },
    ],
  },
  sanitization: {
    clarifications: [
      { key: "accounting", q: "Into which accounting software are the receipts booked?", status: "open", owner: "beat", at: "-24d@10:00", source: "note:first-call" },
      { key: "volume", q: "How many receipts per month at peak?", a: "About 4'000 in the last month of each quarter.", status: "answered", owner: "reto", answeredBy: "beat", answeredAt: "-22d@11:30", at: "-24d@10:05", source: "note:first-call" },
      { key: "foreign", q: "Must receipts in euros and from abroad be handled?", status: "open", owner: "beat", at: "-24d@10:10" },
    ],
    decisions: [],
    tech: [
      { key: "ocr", area: "integration", title: "Reading receipts", choice: "OCR service with Swiss receipt support, results checked by the client before booking", rationale: "Amounts and VAT must be right; a person confirms each receipt.", alternatives: ["Manual entry only"], experts: ["simon"], status: "proposed", by: "simon", at: "-21d@15:00", system: "OCR service (to be chosen)" },
    ],
    discussion: [
      { by: "reto", at: "-19d@16:40", text: "Paused: the booking interface depends on the new accounting software, which Lindenhof chooses in January. We resume here then." },
      { by: "beat", at: "-19d@17:05", text: "Agreed. I'll let you know as soon as the decision is made." },
    ],
  },
  requirements: [
    { key: "photo-upload", title: "Clients photograph receipts", text: "Clients take a photo of a receipt in the app; several receipts can be captured in a row.", category: "functional", priority: "must", criteria: ["A receipt is captured in under 10 seconds", "Photos are kept with the booking"], sources: ["note:first-call"] },
    { key: "read-receipt", title: "The app reads amount, date and VAT", text: "Amount, date, VAT rate and VAT number are read from the photo and shown for confirmation.", category: "functional", priority: "must", criteria: ["Read values can be corrected before saving"], sources: ["note:first-call"] },
  ],
};
