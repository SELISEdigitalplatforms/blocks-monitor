// Talwerk Fluidsysteme GmbH · Spare Parts Webshop, at Board: scope v1 locked two working days ago, the board is planned
// (every ticket in Planned) and the stage / production approval rules are set. Greenfield, repository set up.
import { hexOf } from "../../core/rng";
import type { ProjectPlan } from "../../model";

const THOMAS: [string, string] = ["Thomas Berger", "thomas.berger@talwerk-fluid.de"];
const HEINZ: [string, string] = ["Heinz Gruber", "h.gruber@gruber-pumpenservice.at"];

export const SPARE_PARTS: ProjectPlan = {
  key: "spare-parts",
  workspace: "talwerk",
  name: "Spare Parts Webshop",
  client: { name: "Talwerk Fluidsysteme GmbH", contact: "Thomas Berger", industry: "Industrial pumps and fluid systems", region: "Mannheim, Germany" },
  brief: "Service partners and industrial customers order spare parts by e-mail with part numbers copied from PDF drawings. A webshop should find the right part from the pump's serial number, show the customer's price and availability and send the order straight to the ERP.",
  stage: "board",
  repo: { mode: "new", owner: "talwerk-fluid", name: "spare-parts-shop", visibility: "internal", branch: "main" },
  creator: "aylin",
  assignee: "luca",
  assignedBy: "aylin",
  lead: "luca",
  handedOverBy: "aylin",
  days: { created: "-24d@09:10", handedOver: "-18d@10:05", sanitized: "-13d@16:10", confirmed: "-6d@15:00", locked: "-2d@11:00", updated: "-2d@11:25" },
  docs: {
    folders: [
      { key: "workshops", name: "Workshops", kind: "meeting", at: "-24d@09:15", by: "aylin" },
      { key: "customer-input", name: "Customer input", kind: "other", at: "-24d@09:16", by: "aylin" },
      { key: "pricing", name: "Prices and ERP", kind: "other", at: "-23d@08:40", by: "aylin" },
    ],
    scratch: {
      body: "- 4'200 active part numbers, 1'100 B2B customers in DE, AT, CH\n- 60% of spare part orders arrive by e-mail, 30% by phone\n- About 1 in 6 e-mail orders has a wrong or outdated part number\n- Prices: customer-specific discounts in the ERP, net prices only\n- Thomas wants the shop live before the spring service season",
      at: "-24d@10:00",
      by: "aylin",
    },
    notes: [
      {
        key: "kickoff",
        folder: "workshops",
        title: "Kick-off with after-sales",
        body: "Workshop · Thomas Berger (Head of After-Sales), Katrin Vogel, Aylin Demir, Luca Bernasconi\n\n- Customers know their pump by the serial number on the type plate, not by the model code.\n- After-sales looks up the bill of materials for that serial number in the ERP and answers by e-mail - 10 to 20 minutes per request.\n- Wrong part numbers cause returns: about 9% of spare part shipments come back.\n- Wish: enter or scan the serial number, see the exploded view and the parts list of exactly that pump.\n- Prices: each customer has discount groups in the ERP; the shop must show the net price.\n- Availability: stock per warehouse (Mannheim, Linz); delivery time when not in stock.\n- Orders go into the ERP as sales orders; today they are typed in by two people.\n- Service partners order for their own customers and need several delivery addresses.",
        at: "-22d@14:30",
        by: "aylin",
      },
      {
        key: "ordering-today",
        folder: "customer-input",
        title: "How customers order spare parts today",
        body: "## Channels (last 12 months)\n\n| Channel | Share | Typical problem |\n| --- | --- | --- |\n| E-mail with part numbers | 60% | outdated numbers from old drawings |\n| Phone | 30% | long calls, no written record |\n| Field technicians | 10% | ordered on paper, typed in later |\n\n## Voices from service partners\n\n- \"I need the seal kit for a pump from 2014 and the drawing I have is from 2019.\"\n- \"Tell me the price before I order, not on the invoice.\"\n- \"I want to see if it is in stock in Linz.\"",
        at: "-21d@11:10",
        by: "aylin",
      },
      {
        key: "erp-notes",
        folder: "pricing",
        title: "ERP, prices and availability",
        body: "Notes from the call with IT (Stefan Brandt):\n\n- Bills of materials per serial number are in the ERP, linked to the production order.\n- Net price = list price minus the customer's discount group; the ERP has a price simulation service.\n- Stock per plant is available every 15 minutes through the integration platform.\n- Sales orders can be created through the same platform; order confirmations come back as events.\n- Test system available; production access only through the integration platform, never directly.",
        at: "-20d@09:45",
        by: "luca",
      },
    ],
    files: [
      {
        key: "price-list",
        folder: "pricing",
        at: "-23d@08:45",
        by: "aylin",
        file: {
          type: "pdf",
          name: "Spare parts price list 2026 excerpt.pdf",
          issued: "-120d",
          issuer: "Talwerk Fluidsysteme GmbH · After-Sales",
          color: "0f4c81",
          title: "Spare parts price list 2026 (excerpt)",
          subtitle: "List prices in EUR excluding VAT · valid from 1 January 2026",
          sections: [
            {
              heading: "Series TWK-C centrifugal pumps",
              table: {
                head: ["Part no.", "Description", "Fits", "List price EUR"],
                widths: [0.18, 0.44, 0.2, 0.18],
                rows: [
                  ["C-40-118", "Mechanical seal kit 40 mm", "TWK-C 40, 50", "186.00"],
                  ["C-40-122", "Impeller 160 mm, stainless", "TWK-C 40", "412.50"],
                  ["C-50-301", "Bearing set, motor side", "TWK-C 50, 65", "238.90"],
                  ["C-65-040", "Casing gasket set", "TWK-C 65", "54.20"],
                  ["C-80-215", "Shaft sleeve, hardened", "TWK-C 80", "167.00"],
                ],
              },
            },
            { heading: "Notes", bullets: ["Customer-specific discounts apply according to the discount group.", "Parts for pumps built before 2016 may differ; please give the serial number."] },
          ],
        },
      },
      {
        key: "partner-email",
        folder: "customer-input",
        at: "-21d@10:30",
        by: "aylin",
        file: {
          type: "eml",
          name: "Seal kit for TWK-C 50 serial 50-14-08812.eml",
          from: HEINZ,
          to: [["Talwerk After-Sales", "aftersales@talwerk-fluid.de"]],
          cc: [THOMAS],
          at: "-21d@07:50",
          subject: "Seal kit for TWK-C 50, serial 50-14-08812",
          body: "Good morning\n\nwe need a mechanical seal kit for the pump with serial number 50-14-08812 (customer: municipal waterworks). Our drawing shows part C-40-118, but the last kit you sent us did not fit.\n\nCould you please confirm the right part number, the price for us and whether it is in stock in Linz?\n\nThank you and best regards\nHeinz Gruber\nGruber Pumpenservice, Wels",
        },
      },
      {
        key: "workshop-board",
        folder: "workshops",
        at: "-22d@15:00",
        by: "luca",
        file: {
          type: "png",
          name: "Workshop order flow.png",
          image: {
            type: "whiteboard",
            title: "Spare parts order flow",
            boxes: [
              { x: 110, y: 260, w: 340, h: 150, label: "Serial number or scan" },
              { x: 560, y: 260, w: 400, h: 150, label: "Parts list of this pump" },
              { x: 1080, y: 260, w: 380, h: 150, label: "Net price + stock", color: "green" },
              { x: 1080, y: 640, w: 380, h: 150, label: "Order to ERP", color: "red" },
              { x: 560, y: 640, w: 400, h: 150, label: "Confirmation + tracking" },
            ],
            arrows: [[0, 1], [1, 2], [2, 3], [3, 4]],
            stickies: [
              { x: 160, y: 680, text: "Partners: many addresses" },
              { x: 160, y: 920, text: "Linz + Mannheim stock" },
            ],
          },
        },
      },
    ],
  },
  sanitization: {
    clarifications: [
      { key: "serial-coverage", q: "Do all pumps sold since 2010 have their bill of materials linked to the serial number in the ERP?", a: "Yes for pumps built since 2012; older ones are looked up by model code and need an after-sales check.", status: "answered", owner: "luca", answeredBy: "stefan", answeredAt: "-16d@10:20", at: "-17d@09:30", source: "note:erp-notes" },
      { key: "partner-addresses", q: "May service partners ship to their end customers' addresses directly?", a: "Yes, partners keep a list of delivery addresses; the invoice always goes to the partner.", status: "answered", owner: "aylin", answeredBy: "aylin", answeredAt: "-16d@14:05", at: "-17d@09:35", source: "note:kickoff" },
      { key: "payment", q: "Do customers pay by card in the shop, or on invoice as today?", a: "On invoice as today; payment terms come from the ERP.", status: "answered", owner: "aylin", answeredBy: "aylin", answeredAt: "-16d@14:10", at: "-17d@09:40" },
      { key: "returns", q: "Should returns be requested in the shop in the first version?", status: "deferred", deferReason: "Returns stay with after-sales by e-mail for now; to be reviewed after three months of shop orders.", owner: "aylin", at: "-17d@09:45", source: "note:kickoff" },
      { key: "languages", q: "Which languages must the shop offer at launch?", a: "German and English; Italian later for the partners in South Tyrol.", status: "answered", owner: "aylin", answeredBy: "aylin", answeredAt: "-15d@11:30", at: "-17d@09:50" },
    ],
    decisions: [
      { key: "net-prices", title: "Show net prices only", statement: "The shop shows each customer's net price from the ERP price simulation; no list prices.", rationale: "Customers asked to know the price before ordering; list prices only cause questions.", by: "aylin", at: "-15d@15:00", source: "note:ordering-today" },
      { key: "invoice", title: "Invoice payment only", statement: "Orders are paid on invoice with the customer's terms; no card payment in the first version.", rationale: "All shop customers are existing B2B accounts with credit limits.", by: "aylin", at: "-15d@15:05", clar: "payment" },
      { key: "integration-platform", title: "All ERP access through the integration platform", statement: "The shop reads bills of materials, prices and stock and writes sales orders only through Talwerk's integration platform.", rationale: "IT policy: no direct ERP access from internet-facing systems.", by: "stefan", at: "-15d@15:10", source: "note:erp-notes" },
    ],
    tech: [
      { key: "stack", area: "stack", title: "Web shop on SELISE Blocks", choice: "SELISE Blocks (IAM, Data Gateway, Storage) with a React web app", rationale: "Sign-in, data and files come ready; the team builds only the shop features.", alternatives: ["Standard e-commerce suite", "Own backend"], experts: ["stefan"], status: "accepted", by: "luca", at: "-15d@16:00" },
      { key: "erp-integration", area: "integration", title: "ERP integration", choice: "REST calls to the integration platform for BOM, price simulation, stock and sales orders; order confirmations as events", rationale: "Matches the IT policy and the platform's existing services.", alternatives: ["Nightly file exchange", "Direct ERP API"], experts: ["stefan"], status: "accepted", by: "luca", at: "-15d@16:05", system: "Talwerk integration platform (ERP services)" },
      { key: "search-speed", area: "nfr", title: "Fast part search", choice: "Parts lists cached per serial number for 24 hours; prices and stock always live", rationale: "Bills of materials rarely change; prices and stock must be current.", alternatives: ["Everything live from the ERP"], experts: ["stefan"], status: "accepted", by: "luca", at: "-15d@16:10", nfr: { category: "performance", target: "Parts list of a serial number shown in under 2 seconds" } },
      { key: "customer-isolation", area: "security", title: "Customer data stays separate", choice: "Every request is scoped to the signed-in customer's account; partners see only their own orders and addresses", rationale: "Net prices and order history are confidential between customers.", alternatives: [], experts: ["florian"], status: "accepted", by: "luca", at: "-15d@16:15" },
    ],
    discussion: [
      { by: "aylin", at: "-18d@10:20", text: "Handed over. Thomas Berger is the business owner; Heinz Gruber's e-mail shows the daily pain well." },
      { by: "luca", at: "-17d@11:00", text: "Questions are drafted. Stefan, could you check the serial number coverage in the ERP?" },
      { by: "stefan", at: "-16d@10:25", text: "Done, answered in the question. Pumps before 2012 need the model code." },
    ],
  },
  requirements: [
    { key: "serial-search", title: "Find parts by the pump's serial number", text: "A customer enters or scans the serial number from the type plate and sees the parts list of exactly that pump.", category: "functional", priority: "must", criteria: ["A valid serial number shows the parts list of that pump", "Pumps built before 2012 are found by model code with a hint to check with after-sales", "An unknown serial number shows a clear message and the after-sales contact"], sources: ["note:kickoff", "clar:serial-coverage"] },
    { key: "exploded-view", title: "Parts are shown on the exploded view", text: "Each parts list shows the exploded drawing with position numbers matching the list.", category: "ux", priority: "must", criteria: ["Position numbers on the drawing match the list", "Tapping a position highlights the part in the list"], sources: ["note:kickoff"] },
    { key: "net-price", title: "Customers see their net price", text: "Prices are the customer's net prices from the ERP price simulation.", category: "integration", priority: "must", criteria: ["The price shown equals the ERP price simulation for that customer", "No list prices are shown"], sources: ["dec:net-prices", "note:erp-notes"] },
    { key: "availability", title: "Stock per warehouse and delivery time", text: "Each part shows stock in Mannheim and Linz, or the delivery time when it is not in stock.", category: "functional", priority: "must", criteria: ["Stock per warehouse is at most 15 minutes old", "Parts without stock show the expected delivery time"], sources: ["note:kickoff", "file:partner-email"] },
    { key: "order-to-erp", title: "Orders reach the ERP as sales orders", text: "A submitted order is created as a sales order in the ERP through the integration platform, with the customer's payment terms.", category: "integration", priority: "must", criteria: ["Every submitted order appears as a sales order in the ERP", "The customer receives the order confirmation number"], sources: ["dec:integration-platform", "dec:invoice"] },
    { key: "delivery-addresses", title: "Partners ship to several addresses", text: "Service partners pick a delivery address from their list or add a new one; the invoice goes to the partner.", category: "functional", priority: "must", criteria: ["A partner can choose one of their delivery addresses", "The invoice address is always the partner's"], sources: ["clar:partner-addresses"] },
    { key: "order-status", title: "Customers follow their order", text: "Customers see the status of each order from confirmed to shipped, with the tracking link.", category: "functional", priority: "nice", criteria: ["Status follows the ERP confirmations", "Shipped orders show the carrier's tracking link"], sources: ["note:ordering-today"] },
  ],
  objective: {
    statement: "Talwerk's service partners and industrial customers find the right spare part from the pump's serial number, see their own price and stock, and order online straight into the ERP instead of by e-mail.",
    criteria: ["A customer finds the parts list of a pump by its serial number", "Prices and stock shown are the customer's live values", "Every shop order becomes an ERP sales order without retyping"],
    highLevelMd: "## Users\n- About 1'100 B2B customers and service partners in DE, AT, CH\n- After-sales staff at Talwerk\n\n## Main flows\n- Find the pump by serial number and pick parts on the exploded view\n- Check net price and stock, order on invoice\n- Follow the order until it ships",
    architectureMd: "React web shop on SELISE Blocks; bills of materials, price simulation, stock and sales orders through Talwerk's integration platform; parts lists cached per serial number.",
  },
  design: {
    mode: "describe",
    instructions: "Industrial and calm: Talwerk blue, lots of white, large part numbers. Desktop first for the office, but the serial number search must work on a phone in a plant room. Exploded view next to the parts list; net price and stock on every line.",
    brand: "0f4c81",
    app: "TALWERK PARTS",
    confirmedBy: "aylin",
    screens: [
      { key: "find-pump", name: "Find your pump", status: "accepted", image: { device: "desktop", title: "Find your pump", nav: ["Find parts", "My orders", "Addresses", "Account"], activeNav: 0, blocks: [{ k: "hero", title: "Serial number", text: "Type it from the type plate, e.g. 50-14-08812, or scan the QR code." }, { k: "field", label: "Serial number", value: "50-14-08812" }, { k: "button", text: "Show parts" }, { k: "list", items: [["TWK-C 50 - 50-14-08812", "Waterworks Wels"], ["TWK-C 65 - 65-17-01230", "Plant Linz"]] }] } },
      { key: "parts-list", name: "Parts list", status: "accepted", image: { device: "desktop", title: "TWK-C 50 - 50-14-08812", nav: ["Find parts", "My orders", "Addresses", "Account"], activeNav: 0, blocks: [{ k: "table", head: ["Pos.", "Part no.", "Description", "Net EUR", "Stock"], rows: [["12", "C-50-118", "Seal kit 50 mm", "158.10", "Linz 14"], ["14", "C-50-122", "Impeller 180 mm", "366.20", "3 days"], ["21", "C-50-301", "Bearing set", "203.10", "Mannheim 6"], ["30", "C-65-040", "Gasket set", "46.10", "Linz 40"]] }, { k: "button", text: "Add to cart" }] } },
      { key: "cart", name: "Cart and order", image: { device: "desktop", title: "Cart", nav: ["Find parts", "My orders", "Addresses", "Account"], activeNav: 0, blocks: [{ k: "list", items: [["C-50-118 Seal kit 50 mm", "2 x 158.10"], ["C-65-040 Gasket set", "1 x 46.10"]] }, { k: "field", label: "Deliver to", value: "Waterworks Wels, Plant 2" }, { k: "stats", items: [["Net total", "EUR 362.30"], ["Terms", "30 days"]] }, { k: "button", text: "Place order" }] } },
      { key: "order-status", name: "Order status (phone)", image: { device: "mobile", title: "Order 4500212", nav: ["Parts", "Orders", "Account"], activeNav: 1, blocks: [{ k: "steps", items: ["Confirmed", "Picked", "Shipped"], active: 1 }, { k: "card", title: "Picked in Linz", lines: ["2 items - ships today"], badge: "PICKED", tone: "info" }] } },
    ],
  },
  scope: {
    title: "Spare parts webshop, first version",
    summary: "Customers find parts by serial number on the exploded view, see net prices and stock, order on invoice into the ERP and follow their orders. Returns stay with after-sales for now.",
    features: [
      {
        key: "part-finder",
        title: "Part finder",
        description: "Find the pump by serial number or model code.",
        priority: "must",
        reqs: ["serial-search"],
        stories: [
          { key: "search-serial", title: "Search by serial number", actor: "service partner", text: "As a service partner I enter the serial number from the type plate so that I see the parts of exactly that pump.", criteria: ["A valid serial shows the pump and its parts list", "An unknown serial shows the after-sales contact"], hours: 6 },
          { key: "search-model", title: "Search older pumps by model code", actor: "service partner", text: "As a service partner I search pumps built before 2012 by model code so that I still find their parts.", criteria: ["Model code search lists the matching parts lists", "A hint asks to confirm with after-sales"], hours: 4 },
        ],
      },
      {
        key: "parts-catalogue",
        title: "Parts list and exploded view",
        description: "The parts list of a pump next to its exploded drawing.",
        priority: "must",
        reqs: ["exploded-view"],
        stories: [
          { key: "exploded-view", title: "Pick parts on the exploded view", actor: "customer", text: "As a customer I tap a position on the drawing so that the matching part is highlighted in the list.", criteria: ["Positions on the drawing match the list", "The highlighted part scrolls into view"], hours: 8 },
          { key: "part-details", title: "See part details", actor: "customer", text: "As a customer I open a part to see its description, weight and the pumps it fits.", criteria: ["Details show description, weight and fitting models"], hours: 3 },
        ],
      },
      {
        key: "customer-prices",
        title: "Net prices and stock",
        description: "The customer's net price and stock per warehouse on every line.",
        priority: "must",
        reqs: ["net-price", "availability"],
        stories: [
          { key: "net-price", title: "See my net price", actor: "customer", text: "As a customer I see my net price on every part so that I know the cost before ordering.", criteria: ["The price equals the ERP price simulation", "No list price is shown"], hours: 5 },
          { key: "stock", title: "See stock in Mannheim and Linz", actor: "customer", text: "As a customer I see the stock per warehouse or the delivery time.", criteria: ["Stock is at most 15 minutes old", "Parts out of stock show the delivery time"], hours: 4 },
        ],
      },
      {
        key: "checkout",
        title: "Cart and order",
        description: "Order on invoice to one of the partner's delivery addresses; the order becomes an ERP sales order.",
        priority: "must",
        reqs: ["order-to-erp", "delivery-addresses"],
        stories: [
          { key: "place-order", title: "Place an order on invoice", actor: "customer", text: "As a customer I place my cart as an order on invoice and receive the order number.", criteria: ["The order is created as an ERP sales order", "The confirmation shows the ERP order number"], hours: 8 },
          { key: "delivery-address", title: "Ship to one of my addresses", actor: "service partner", text: "As a service partner I choose the delivery address of my end customer.", criteria: ["Saved addresses can be picked", "A new address can be added during checkout"], hours: 4 },
        ],
      },
      {
        key: "order-tracking",
        title: "Order tracking",
        description: "Order status from confirmed to shipped with the tracking link.",
        priority: "nice",
        reqs: ["order-status"],
        stories: [
          { key: "order-list", title: "See my orders and their status", actor: "customer", text: "As a customer I see my orders with their current status.", criteria: ["Status follows the ERP confirmations", "Orders can be filtered by delivery address"], hours: 4 },
          { key: "tracking-link", title: "Follow the shipment", actor: "customer", text: "As a customer I open the carrier's tracking link of a shipped order.", criteria: ["Shipped orders show the tracking link"], hours: 2 },
        ],
      },
    ],
    milestones: [
      { name: "Find the right part", goal: "Customers find the parts of their pump by serial number.", features: ["part-finder", "parts-catalogue"], preview: "A partner enters 50-14-08812 and picks the seal kit on the exploded view." },
      { name: "Order at my price", goal: "Customers see net prices and stock and order into the ERP.", features: ["customer-prices", "checkout"], preview: "A partner orders the seal kit to his customer's address and gets the ERP order number." },
      { name: "Track my order", goal: "Customers follow their orders until they ship.", features: ["order-tracking"], preview: "A customer opens the tracking link of yesterday's order." },
    ],
    challenges: [
      { severity: "high", question: "What does the shop show when the integration platform does not answer the price simulation?", why: "Net prices are live only; without an answer the customer cannot order.", fix: "Show the part without price and offer 'request a quote', which goes to after-sales.", target: { type: "feature", key: "customer-prices" }, status: "accepted", by: "aylin", at: "-5d@10:20" },
      { severity: "medium", question: "Who may place orders for a service partner: every employee or only named buyers?", why: "Partners have technicians and buyers; the scope does not say who can order.", fix: "Every signed-in person of a partner can order; the partner's admin manages the people.", target: { type: "feature", key: "checkout" }, status: "answered", answer: "Every person of the partner can order; the order shows who placed it. Partner admins come later.", by: "aylin", at: "-5d@10:35" },
      { severity: "low", question: "Should the exploded view work offline in plant rooms without reception?", why: "Technicians sometimes look up parts in basements.", fix: "Cache the last 10 viewed parts lists on the device.", target: { type: "story", key: "exploded-view" }, status: "dismissed", answer: "Not needed for the first version: ordering always needs a connection.", by: "luca", at: "-4d@09:10" },
    ],
    feedback: [
      {
        target: "story:place-order",
        resolved: true,
        comments: [
          { by: "jan", at: "-5d@13:40", text: "For testing we need the ERP test system's order numbers to look different from production, otherwise after-sales will be confused." },
          { by: "luca", at: "-5d@14:15", text: "Agreed: the dev and stage environments point at the ERP test system, whose sales orders start with 49. Added as a note on the story." },
          { by: "jan", at: "-4d@08:30", text: "Perfect, thanks. Resolving." },
        ],
      },
    ],
  },
  links: [
    { item: "design.screen", screen: "parts-list", token: hexOf("spare-parts-parts-list-link", 43), by: "aylin", at: "-5d@16:00", days: 7, revoked: "-4d@09:30", views: 2 },
    { item: "scope", token: hexOf("spare-parts-scope-link", 43), by: "aylin", at: "-2d@11:40", days: 30, views: 1 },
  ],
  delivery: {
    builds: [],
    builtMilestones: 0,
    tasks: [
      { tag: "sso", title: "Sign-in with Talwerk customer accounts", milestone: 1, hours: 5, description: "Customers sign in with the accounts after-sales already manages; partner people are linked to their partner.", acceptance: ["Existing customer accounts can sign in", "People of a partner see only the partner's data"] },
      { tag: "ci", title: "Build pipeline and preview environment", milestone: 1, hours: 3, description: "Pipeline for the shop with a preview environment per milestone, connected to the ERP test system.", acceptance: ["Every milestone is deployed to its preview", "Previews use the ERP test system"] },
      { tag: "sec", title: "Security review of pricing data", milestone: 2, hours: 3, description: "Check that net prices and orders never leak across customers.", acceptance: ["A customer can never read another customer's prices or orders", "Findings are fixed or accepted by IT security"], feature: "customer-prices" },
    ],
    policies: [
      { env: "stage", note: "Architect and IT security approve every promotion to stage; QA is optional.", allRequired: false, by: "jan", at: "-2d@13:10", steps: [{ type: "architect", required: true, approvers: ["stefan"] }, { type: "security", required: true, approvers: ["florian"] }, { type: "qa", required: false, approvers: ["jan"] }] },
      { env: "production", note: "Every approver signs off before a version goes live for customers.", allRequired: true, by: "jan", at: "-2d@13:15", steps: [{ type: "architect", required: true, approvers: ["stefan"] }, { type: "security", required: true, approvers: ["florian"] }, { type: "qa", required: true, approvers: ["jan"] }] },
    ],
    urls: { dev: "https://parts.dev.talwerk-fluid.de" },
  },
};
