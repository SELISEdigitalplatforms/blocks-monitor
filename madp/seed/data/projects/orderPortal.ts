// Alpine Fresh AG · B2B Order Portal, at Scope (draft v1, second opinion open). Greenfield, repository not set up yet.
// Built from the blocks/seed/example-workspace scenario (its texts, numbering and refs), with the people of this seed:
// qa-a → Sandra Keller (engagement lead), qa-b → Marco Huber (QA and security). Files, screens, the second opinion,
// feedback and shares are added here.
import Clarifications from "../../../blocks/seed/example-workspace/Clarification.json";
import Decisions from "../../../blocks/seed/example-workspace/Decision.json";
import DocFolders from "../../../blocks/seed/example-workspace/DocFolder.json";
import DocNotes from "../../../blocks/seed/example-workspace/DocNote.json";
import Features from "../../../blocks/seed/example-workspace/Feature.json";
import Milestones from "../../../blocks/seed/example-workspace/Milestone.json";
import Objectives from "../../../blocks/seed/example-workspace/Objective.json";
import Projects from "../../../blocks/seed/example-workspace/Project.json";
import Requirements from "../../../blocks/seed/example-workspace/Requirement.json";
import ScopeVersions from "../../../blocks/seed/example-workspace/ScopeVersion.json";
import Stories from "../../../blocks/seed/example-workspace/Story.json";
import TechDecisions from "../../../blocks/seed/example-workspace/TechDecision.json";
import DesignBriefs from "../../../blocks/seed/example-workspace/DesignBrief.json";
import { hexOf } from "../../core/rng";
import type { ClarificationPlan, ProjectPlan, Ref, TechDecisionPlan } from "../../model";

const USERS: Record<string, string> = { "qa-a": "sandra", "qa-b": "marco" };
const who = (k: unknown): string => USERS[String(k)] ?? "sandra";
/** "DocNote:note-x" → "note:note-x" (the local refs of the seed). */
const local = (r: string): Ref => {
  const [schema, key] = r.split(":") as [string, string];
  const prefix: Record<string, string> = { DocNote: "note", DocFile: "file", Clarification: "clar", Decision: "dec" };
  return `${prefix[schema] ?? schema}:${key}`;
};

const P = Projects[0]!;
const JONAS: [string, string] = ["Jonas Meier", "jonas.meier@alpine-fresh.ch"];
const SANDRA: [string, string] = ["Sandra Keller", "sandra.keller@selisegroup.com"];

// Note times: the e-mails of 12–16 Oct and the call of 16 Oct, before the hand-over.
const NOTE_AT: Record<string, string> = {
  "note-email-thread": "-6d@17:20",
  "note-call-16-oct": "-6d@15:55",
  "note-whiteboard-flow": "-6d@16:05",
  "note-order-form": "-8d@10:40",
  "note-order-sheets": "-8d@10:55",
};

// The open fixture questions are settled before sanitization completed; one new question came up afterwards.
const CLAR_FIX: Record<string, Partial<ClarificationPlan>> = {
  "clar-sign-in": {
    status: "answered",
    a: "One login per person: the chef and the owner each sign in with their own e-mail under the same customer account (Jonas Meier, e-mail 19 Oct).",
    answeredBy: "sandra",
    answeredAt: "-4d@09:40",
  },
  "clar-delivery-windows": {
    status: "deferred",
    deferReason: "Delivery windows are kept for later: the feature is in the scope with priority Later, to be confirmed with the hotels first.",
  },
  "clar-languages": { at: "-1d@16:10" },
};

const TECH_FIX: Record<string, Partial<TechDecisionPlan>> = {
  "tech-mobile-performance": { nfr: { category: "performance", target: "Catalogue and order screens load in under 2 seconds on a 4G phone" } },
  "tech-erp-export": { system: "Alpine Fresh ERP (nightly CSV import)" },
};

const objective = Objectives[0]!;
const brief = DesignBriefs[0]!;
const scope = ScopeVersions[0]!;

export const ORDER_PORTAL: ProjectPlan = {
  key: "order-portal",
  workspace: "alpine-fresh",
  name: P.Name,
  client: { name: P.ClientName, contact: P.ClientContact, industry: P.ClientIndustry, region: P.ClientRegion },
  brief: P.Brief,
  stage: "scope",
  repo: { mode: "new" },
  creator: "sandra",
  assignee: "sandra",
  lead: "sandra",
  handedOverBy: "elena",
  days: { created: "-10d@09:05", handedOver: "-5d@11:15", sanitized: "-3d@16:20", confirmed: "-1d@14:05", updated: "-0d@08:55" },
  docs: {
    folders: DocFolders.map((f, i) => ({ key: f.$key, name: f.Name, kind: f.Kind as "meeting" | "other", at: `-10d@09:${10 + i}`, by: "elena" })),
    scratch: { body: DocNotes.find((n) => n.IsScratchPad)!.BodyMd, at: "-9d@08:30", by: "sandra" },
    notes: DocNotes.filter((n) => !n.IsScratchPad).map((n) => ({
      key: n.$key,
      folder: (n.$ref as { FolderId?: string }).FolderId?.split(":")[1],
      title: n.Title,
      body: n.BodyMd.replace(/Petra Huber/g, "Petra Wyss"),
      at: NOTE_AT[n.$key] ?? "-7d@10:00",
      by: n.$key === "note-email-thread" || n.$key.startsWith("note-order") ? "elena" : "sandra",
    })),
    files: [
      {
        key: "order-form-pdf",
        folder: "folder-customer-documents",
        at: "-8d@10:35",
        by: "elena",
        file: {
          type: "pdf",
          name: "Alpine Fresh order form 2026.pdf",
          issued: "-60d",
          issuer: "Alpine Fresh AG",
          color: "2f7d4f",
          title: "Order form",
          subtitle: "Fresh food wholesale · Hardturmstrasse 120 · 8005 Zurich · order desk +41 44 512 30 40",
          meta: [["Customer number", ""], ["Customer name", ""], ["Delivery address", ""], ["Delivery day", ""], ["Ordered by", ""]],
          sections: [
            { heading: "Articles", table: { head: ["Art. no.", "Article", "Unit", "Quantity", "Comment"], widths: [0.14, 0.4, 0.12, 0.14, 0.2], rows: Array.from({ length: 12 }, () => ["", "", "", "", ""]) } },
            {
              heading: "Ordering rules",
              bullets: [
                "Order cut-off: 18:00. Orders received after 18:00 are delivered on the next possible delivery day.",
                "Delivery days per route: Zurich City Mon, Wed, Fri · Winterthur Tue, Thu.",
                "Minimum order value: CHF 150.00 per delivery. Below that, a delivery fee of CHF 25.00 applies.",
                "Changes to a sent order are possible until 18:00 by phone to the order desk.",
                "Prices according to your personal price list, excluding VAT.",
              ],
            },
          ],
        },
      },
      {
        key: "order-sheet-seeblick",
        folder: "folder-customer-documents",
        at: "-8d@10:50",
        by: "elena",
        file: {
          type: "text",
          name: "Order 14 Oct Hotel Seeblick.csv",
          mime: "text/csv",
          text: [
            "Art. no.;Article;Unit;Qty;Price CHF;Delivery",
            "10021;Cherry tomatoes;kg;10;8.20;Wed Zurich City",
            "10102;Fresh herbs mix;box;4;6.90;Wed Zurich City",
            "20114;Whole milk 1 l;piece;120;1.40;Wed Zurich City",
            "20871;Greek yoghurt 1 kg;piece;18;5.60;Wed Zurich City",
            "50033;Croissants, frozen (60);box;3;39.00;Wed Zurich City",
            ";Note: delivery before 7:00 please (breakfast);;;;",
          ].join("\r\n"),
        },
      },
      {
        key: "first-email",
        folder: "folder-correspondence",
        at: "-10d@09:20",
        by: "sandra",
        file: {
          type: "eml",
          name: "Online ordering for our customers.eml",
          from: JONAS,
          to: [SANDRA],
          at: "-10d@08:40",
          subject: "Online ordering for our customers",
          body: "Hello,\n\nThank you for the good conversation at the Gastro fair. As promised, here is a short summary of where we stand.\n\nAbout 180 business customers order from us: restaurants, hotels, delis and small shops. Today they fill in our Excel order sheet and email it to our order desk, around 350 orders a week.\n\nOur order desk retypes every sheet into our ERP. That is roughly 25 hours a week, and every week a few orders go wrong.\n\nWe would like our customers to order online instead. Can you help us with that?\n\nBest regards,\nJonas Meier\nHead of Operations, Alpine Fresh AG, Zurich",
        },
      },
      {
        key: "whiteboard-photo",
        folder: "folder-meetings",
        at: "-6d@16:00",
        by: "sandra",
        file: {
          type: "png",
          name: "Whiteboard order flow 16 Oct.png",
          image: {
            type: "whiteboard",
            title: "Order flow - Alpine Fresh",
            boxes: [
              { x: 110, y: 260, w: 330, h: 150, label: "Customer logs in" },
              { x: 560, y: 260, w: 400, h: 150, label: "Picks items / repeat last" },
              { x: 1080, y: 260, w: 380, h: 150, label: "Sends before 18:00", color: "red" },
              { x: 1080, y: 620, w: 380, h: 150, label: "Confirmation e-mail" },
              { x: 560, y: 620, w: 400, h: 150, label: "Order desk checks" },
              { x: 110, y: 620, w: 330, h: 190, label: "Status: received picked on the way delivered", color: "green" },
            ],
            arrows: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5]],
            stickies: [
              { x: 160, y: 900, text: "MOBILE!!" },
              { x: 520, y: 900, text: "Min. order CHF 150" },
              { x: 880, y: 900, text: "ERP export 18:30" },
            ],
          },
        },
      },
    ],
  },
  sanitization: {
    clarifications: Clarifications.map((q) => ({
      key: q.$key,
      q: q.Question,
      a: q.Answer || undefined,
      status: q.Status as ClarificationPlan["status"],
      owner: who((q.$user as Record<string, unknown>).OwnerUserId),
      at: "-5d@14:30",
      answeredBy: q.Status === "answered" ? who((q.$user as Record<string, unknown>).AnsweredByUserId) : undefined,
      answeredAt: q.Status === "answered" ? "-4d@11:20" : undefined,
      source: (q.$ref as { SourceRef?: string }).SourceRef ? local((q.$ref as { SourceRef: string }).SourceRef) : undefined,
      ...CLAR_FIX[q.$key],
    })),
    decisions: Decisions.map((d) => ({
      key: d.$key,
      title: d.Title,
      statement: d.Statement,
      rationale: d.Rationale,
      by: "sandra",
      at: "-4d@15:00",
      source: (d.$ref as { SourceRef?: string }).SourceRef ? local((d.$ref as { SourceRef: string }).SourceRef) : undefined,
    })),
    tech: TechDecisions.map((d) => ({
      key: d.$key,
      area: d.Area as TechDecisionPlan["area"],
      title: d.Title,
      choice: d.Choice,
      rationale: d.Rationale,
      alternatives: d.Alternatives,
      experts: ["marco"],
      status: d.Status as TechDecisionPlan["status"],
      by: "sandra",
      at: "-4d@16:10",
      ...TECH_FIX[d.$key],
    })),
    discussion: [
      { by: "elena", at: "-5d@11:40", text: "Handed over. The call notes of 16 Oct have the most context; the order sheets show how customers really order." },
      { by: "sandra", at: "-5d@13:05", text: "Thanks. I'll ask Jonas about sign-in per person before we draft requirements." },
    ],
  },
  requirements: Requirements.map((r) => ({
    key: r.Key,
    title: r.Title,
    text: r.Text,
    category: r.Category as "functional",
    priority: r.Priority as "must",
    criteria: r.AcceptanceCriteria,
    sources: ((r.$ref as { SourceRefs?: string[] }).SourceRefs ?? []).map(local),
    status: r.Status === "assumed" ? "assumed" : undefined,
  })),
  objective: { statement: objective.Statement, criteria: objective.AcceptanceCriteria, highLevelMd: objective.HighLevelMd, architectureMd: objective.ArchitectureMd },
  suggestions: [
    { key: "favourites-list", source: "engine", title: "Favourites list per customer", text: "Customers who order the same articles every week could keep a favourites list next to the repeat order.", status: "open", at: "-3d@16:40" },
    { key: "out-of-stock-alerts", source: "engine", title: "Tell customers about out-of-stock articles", text: "When the order desk removes an article from an order, the customer gets a short note with the reason.", status: "accepted", at: "-3d@16:40", decidedBy: "sandra", decidedAt: "-2d@09:15" },
  ],
  design: {
    mode: brief.Mode as "describe",
    instructions: brief.Instructions,
    brand: "2f7d4f",
    app: "ALPINE FRESH",
    confirmedBy: "sandra",
    screens: [
      { key: "sign-in", name: "Sign in", image: { device: "mobile", title: "Sign in", blocks: [{ k: "hero", title: "Welcome back", text: "Order fresh produce for your kitchen." }, { k: "field", label: "E-mail", value: "chef@lindenhof-rest.ch" }, { k: "field", label: "Password", value: "********" }, { k: "button", text: "Sign in" }, { k: "note", text: "Orders close at 18:00 for the next delivery day." }] } },
      { key: "catalogue", name: "My catalogue", image: { device: "mobile", title: "Catalogue", nav: ["Home", "Catalogue", "Orders", "Account"], activeNav: 1, blocks: [{ k: "field", label: "Search", value: "tomatoes" }, { k: "list", items: [["Cherry tomatoes kg", "8.40"], ["Iceberg lettuce", "1.35"], ["Whole milk 1 l", "1.45"], ["Butter 1 kg", "11.90"], ["Arborio rice 5 kg", "17.50"]] }, { k: "note", text: "Your prices, excluding VAT." }] } },
      { key: "order", name: "Order", image: { device: "mobile", title: "New order", nav: ["Home", "Catalogue", "Orders", "Account"], activeNav: 2, blocks: [{ k: "card", title: "Delivery Tue - Winterthur", lines: ["Order before 18:00 today"], badge: "CUT-OFF 18:00", tone: "warn" }, { k: "list", items: [["Cherry tomatoes", "6 kg"], ["Whole milk 1 l", "40"], ["Butter 1 kg", "6"]] }, { k: "stats", items: [["Total", "CHF 412.50"], ["Fee", "CHF 0"]] }, { k: "button", text: "Send order" }] } },
      { key: "repeat-order", name: "Repeat order", status: "accepted", image: { device: "mobile", title: "Repeat order", nav: ["Home", "Catalogue", "Orders", "Account"], activeNav: 0, blocks: [{ k: "hero", title: "Good evening", text: "Your last order is ready to repeat." }, { k: "card", title: "Order of Tue 20 Oct", lines: ["14 articles - CHF 398.20"], badge: "DELIVERED", tone: "ok" }, { k: "button", text: "Repeat this order" }, { k: "button", text: "Start a new order", secondary: true }] } },
      { key: "order-status", name: "Order status", image: { device: "mobile", title: "Order 4711", nav: ["Home", "Catalogue", "Orders", "Account"], activeNav: 2, blocks: [{ k: "steps", items: ["Received", "Picked", "On way", "Done"], active: 2 }, { k: "card", title: "On the way", lines: ["Truck left Hardturm at 05:40", "Expected 06:30 - 07:00"], badge: "ON THE WAY", tone: "info" }, { k: "map", pins: 3 }] } },
      { key: "order-desk", name: "Order desk", status: "changes-requested", image: { device: "desktop", title: "Orders for Tuesday", nav: ["Orders", "Customers", "Price lists", "ERP export"], activeNav: 0, blocks: [{ k: "stats", items: [["Orders", "61"], ["Changed", "4"], ["Below minimum", "3"], ["Cut-off", "18:00"]] }, { k: "table", head: ["Order", "Customer", "Route", "Total", "Status"], rows: [["4711", "Restaurant Lindenhof", "Winterthur", "412.50", "Received"], ["4712", "Hotel Seeblick", "Zurich City", "1'208.00", "Changed"], ["4713", "Deli Fontana", "Zurich City", "164.30", "Received"], ["4714", "Cafe Rosengarten", "Winterthur", "138.90", "Fee CHF 25"]] }] } },
    ],
  },
  scope: {
    title: scope.Title,
    summary: scope.Summary,
    features: Features.map((f) => ({
      key: f.Key,
      title: f.Title,
      description: f.Description,
      priority: f.Priority as "must",
      reqs: f.RequirementRefs.map((r) => r.replace("requirement:", "")),
      stories: Stories.filter((s) => s.FeatureRef === `feature:${f.Key}`).map((s) => ({
        key: s.Key,
        title: s.Title,
        actor: s.ActorRole,
        text: s.Text,
        criteria: s.AcceptanceCriteria,
        hours: s.EstimateHours,
      })),
    })),
    milestones: Milestones.map((m) => ({ name: m.Name, goal: m.Goal, features: m.FeatureRefs.map((r) => r.replace("feature:", "")), preview: m.PreviewPoint })),
    challenges: [
      {
        severity: "high",
        question: "What happens to an order sent at 17:59 that the order desk changes at 18:05?",
        why: "The cut-off and the order desk changes both use 18:00; a late change could miss the 18:30 ERP export or be refused.",
        fix: "Let the order desk change orders until 18:15 and run the export at 18:30, after the last change.",
        target: { type: "feature", key: "order-desk" },
      },
      {
        severity: "medium",
        question: "Who sees an order when a customer has several logins?",
        why: "Sign-in is one login per person; the scope does not say whether the chef sees the owner's orders.",
        fix: "Every person of a customer sees all orders of that customer; only the owner sees invoices later.",
        target: { type: "feature", key: "repeat-order" },
      },
      {
        severity: "low",
        question: "Should the confirmation e-mail include the delivery fee line?",
        why: "Orders below CHF 150 carry a CHF 25 fee; customers may question it if the e-mail does not show it.",
        fix: "Show the fee as its own line in the confirmation e-mail.",
        target: { type: "feature", key: "order-confirmation" },
        status: "accepted",
        by: "sandra",
        at: "-0d@08:50",
      },
    ],
    feedback: [
      {
        target: "feature:repeat-order",
        comments: [
          {
            by: "jonas",
            at: "-1d@19:45",
            text: "Very good. Our chefs will love it. Could the repeat button also be on the home screen right after sign-in? See the circle.",
            files: [
              {
                type: "png",
                name: "repeat button on home.png",
                image: { type: "screen", device: "mobile", brand: "2f7d4f", app: "ALPINE FRESH", title: "Home", nav: ["Home", "Catalogue", "Orders", "Account"], blocks: [{ k: "hero", title: "Good evening", text: "Delivery Tue - order before 18:00" }, { k: "button", text: "Repeat last order" }, { k: "list", items: [["Order 4702", "Tue"], ["Order 4688", "Fri"]] }], mark: { x: 0.5, y: 0.33, r: 0.28 } },
              },
            ],
          },
          { by: "sandra", at: "-0d@08:40", text: "Yes, that is the plan: it is the first thing on the home screen. I'll add it to the story's acceptance criteria." },
        ],
      },
      {
        target: "screen:order-desk",
        comments: [
          { by: "petra", at: "-1d@08:10", text: "We need the route in the first column, we work route by route in the morning. And please show changed orders in a colour." },
          { by: "anna", at: "-1d@10:25", text: "Noted, I'll move the route first and mark changed orders. New version will follow with the next generation." },
        ],
      },
    ],
  },
  shares: [
    { item: "scope", by: "sandra", with: "jonas", at: "-1d@14:20" },
    { item: "screens", by: "anna", with: "petra", at: "-1d@14:30" },
  ],
  links: [{ item: "scope", token: hexOf("order-portal-scope-link", 43), by: "sandra", at: "-1d@14:25", days: 7, views: 3 }],
};
