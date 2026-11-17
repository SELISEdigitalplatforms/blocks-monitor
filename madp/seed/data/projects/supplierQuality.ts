// Alpine Fresh AG · Supplier Quality Portal, at Business (material still coming in, not handed over). Greenfield.
import type { ProjectPlan } from "../../model";

const MARKUS: [string, string] = ["Markus Steiner", "markus.steiner@alpine-fresh.ch"];
const ELENA: [string, string] = ["Elena Frei", "elena.frei@selisegroup.com"];

export const SUPPLIER_QUALITY: ProjectPlan = {
  key: "supplier-quality",
  workspace: "alpine-fresh",
  name: "Supplier Quality Portal",
  client: { name: "Alpine Fresh AG", contact: "Markus Steiner", industry: "Food wholesale", region: "Zurich, Switzerland" },
  brief: "Suppliers upload certificates and delivery temperature logs; quality assurance sees expiring certificates and failed deliveries at a glance instead of in shared folders.",
  stage: "business",
  repo: { mode: "new" },
  creator: "elena",
  assignee: "elena",
  lead: "elena",
  days: { created: "-3d@10:20", updated: "-0d@09:30" },
  docs: {
    folders: [
      { key: "meetings", name: "Meetings", kind: "meeting", at: "-3d@10:25", by: "elena" },
      { key: "supplier-docs", name: "Supplier documents", kind: "other", at: "-3d@10:26", by: "elena" },
    ],
    scratch: {
      body: "- About 140 active suppliers, 25 of them deliver chilled goods daily\n- Certificates: IFS, BRC, organic (Bio Suisse) - expiry dates matter\n- Temperature logs today come as PDF printouts from the drivers\n- Markus wants a first look before the supplier day on 12 Nov",
      at: "-3d@11:00",
      by: "elena",
    },
    notes: [
      {
        key: "kickoff-call",
        folder: "meetings",
        title: "Kick-off call with quality assurance",
        body: "Call · Markus Steiner (Head of Quality Assurance), Elena Frei\n\n- Today: certificates arrive by e-mail and are filed by hand in a shared folder. Nobody notices when one expires.\n- Last audit found 6 expired certificates; one supplier was blocked for two weeks.\n- Chilled deliveries: drivers print the temperature log; QA checks a sample on Fridays.\n- Wish: suppliers upload themselves, QA gets a list of what expires in the next 30 days.\n- Failed deliveries (too warm) should be visible per supplier with the photo of the log.\n- Open: do suppliers need their own login, or a link per upload?\n- Budget not discussed yet; Markus will check with Jonas.",
        at: "-2d@14:40",
        by: "elena",
      },
      {
        key: "audit-findings",
        folder: "supplier-docs",
        title: "Findings of the spring audit (summary)",
        body: "## Audit April (external)\n\n- 6 supplier certificates expired at the time of the audit\n- 2 suppliers without a valid organic certificate for labelled products\n- Temperature logs incomplete for 9 of 120 sampled deliveries\n\n**Auditor's recommendation:** central register of certificates with reminders 60 and 30 days before expiry.",
        at: "-2d@15:10",
        by: "elena",
      },
    ],
    files: [
      {
        key: "audit-checklist",
        folder: "supplier-docs",
        at: "-2d@15:05",
        by: "elena",
        file: {
          type: "pdf",
          name: "Supplier audit checklist.pdf",
          issued: "-40d",
          issuer: "Alpine Fresh AG · Quality Assurance",
          color: "2f7d4f",
          title: "Supplier audit checklist",
          subtitle: "Internal checklist for incoming goods and supplier approval, version 3.2",
          sections: [
            { heading: "Certificates", bullets: ["IFS Food or BRCGS certificate valid on the delivery date", "Organic certificate (Bio Suisse) for every organic article", "Liability insurance confirmation, renewed yearly"] },
            { heading: "Chilled deliveries", bullets: ["Core temperature at arrival 2-5 °C for dairy, 0-4 °C for meat", "Temperature log of the whole transport attached", "Deliveries out of range are refused and photographed"] },
            { heading: "Escalation", paragraphs: ["Two refused deliveries within 30 days lead to a supplier review with purchasing and quality assurance."] },
          ],
        },
      },
      {
        key: "markus-email",
        folder: "meetings",
        at: "-1d@08:55",
        by: "elena",
        file: {
          type: "eml",
          name: "Certificates and temperature logs.eml",
          from: MARKUS,
          to: [ELENA],
          at: "-1d@08:20",
          subject: "Certificates and temperature logs",
          body: "Hi Elena\n\nThanks for the call. Attached on our side is the audit checklist we use. Two more points:\n\n1. Some suppliers have several sites, each with its own certificate.\n2. For meat we need to keep the temperature logs for 2 years.\n\nCan you tell me what you need from us for the next step?\n\nKind regards\nMarkus Steiner\nHead of Quality Assurance, Alpine Fresh AG",
        },
      },
    ],
  },
};
