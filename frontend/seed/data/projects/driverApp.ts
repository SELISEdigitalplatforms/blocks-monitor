// Alpine Fresh AG · Driver Delivery App, at Build: milestone 1 built with its preview, milestone 2 building right now
// (its build.run is running, tickets spread over the agents' columns), milestone 3 planned. Greenfield, repository set up.
import type { ProjectPlan } from "../../model";

const BRUNO: [string, string] = ["Bruno Kälin", "bruno.kaelin@alpine-fresh.ch"];
const LUCA: [string, string] = ["Luca Bernasconi", "luca.bernasconi@selisegroup.com"];
const SANDRA: [string, string] = ["Sandra Keller", "sandra.keller@selisegroup.com"];

export const DRIVER_APP: ProjectPlan = {
  key: "driver-app",
  workspace: "alpine-fresh",
  name: "Driver Delivery App",
  client: { name: "Alpine Fresh AG", contact: "Bruno Kälin", industry: "Food wholesale", region: "Zurich, Switzerland" },
  brief: "Drivers work from printed route lists and paper delivery notes. A phone app should show the route of the day, record proof of delivery with photo and signature, check the temperature of chilled goods and update the delivery status customers see in the order portal.",
  stage: "build",
  repo: { mode: "new", owner: "alpine-fresh", name: "driver-delivery-app", visibility: "private", branch: "main" },
  creator: "sandra",
  assignee: "luca",
  assignedBy: "sandra",
  lead: "luca",
  handedOverBy: "sandra",
  days: { created: "-22d@08:40", handedOver: "-18d@14:00", sanitized: "-14d@15:30", confirmed: "-9d@11:00", locked: "-6d@10:30", updated: "-0d@09:10" },
  docs: {
    folders: [
      { key: "meetings", name: "Meetings", kind: "meeting", at: "-22d@08:45", by: "sandra" },
      { key: "ride-along", name: "Ride-along", kind: "event", at: "-21d@07:30", by: "luca" },
      { key: "documents", name: "Delivery documents", kind: "other", at: "-22d@08:46", by: "sandra" },
    ],
    scratch: {
      body: "- 14 trucks, 22 drivers, two routes per truck and day\n- About 180 stops a day, first stops from 05:30\n- Chilled goods: core temperature must be logged (HACCP)\n- Status in the order portal: received - picked - on the way - delivered\n- Drivers use company Android phones (rugged, gloves!)",
      at: "-22d@09:30",
      by: "sandra",
    },
    notes: [
      {
        key: "logistics-call",
        folder: "meetings",
        title: "Call with logistics: how a delivery day works",
        body: "Call · Bruno Kälin (Head of Logistics), Sandra Keller, Luca Bernasconi\n\n- Routes are planned the evening before in the ERP and printed at 04:45.\n- The driver gets a paper list of stops and a folder of delivery notes; customers sign on paper.\n- Signed notes come back in the evening and are scanned by the office the next day.\n- Disputes ('we never got the butter') take days, because the signed note is somewhere in a folder.\n- Chilled goods: the driver measures the core temperature at the first and last stop and writes it on the note.\n- Customers call the office to ask where the truck is; the order portal will show the status, the app must feed it.\n- Partial deliveries happen daily (item missing or refused); today the note is corrected by hand.",
        at: "-21d@13:20",
        by: "sandra",
      },
      {
        key: "ride-along-notes",
        folder: "ride-along",
        title: "Ride-along on the Winterthur route",
        body: "Luca, 05:15-11:40, truck 7, driver Dario\n\n1. Loading: Dario checks the list against the pallets, two crates missing - noted on paper.\n2. 17 stops; at 6 of them nobody signs, goods are left at the back door with a photo on his private phone.\n3. Temperature measured at stop 1 and 17 only.\n4. Every stop takes 2-3 minutes of paperwork.\n\nIdeas: big buttons (gloves), works without signal in basements and cold stores, photo as proof when nobody signs.",
        at: "-20d@12:30",
        by: "luca",
      },
      {
        key: "status-mapping",
        folder: "documents",
        title: "Delivery status for the order portal",
        body: "The order portal shows: received → picked → on the way → delivered.\n\n- on the way: when the driver starts the route\n- delivered: when proof of delivery is captured at the stop\n- partial: delivered with a note of missing or refused items\n\nThe app sends status changes as soon as it has a signal; nothing may be lost when offline.",
        at: "-19d@10:00",
        by: "luca",
      },
    ],
    files: [
      {
        key: "delivery-note",
        folder: "documents",
        at: "-21d@14:00",
        by: "sandra",
        file: {
          type: "pdf",
          name: "Delivery note template.pdf",
          issued: "-200d",
          issuer: "Alpine Fresh AG",
          color: "2f7d4f",
          title: "Delivery note",
          subtitle: "Alpine Fresh AG · Hardturmstrasse 120 · 8005 Zurich",
          meta: [["Delivery note no.", "LS-"], ["Customer", ""], ["Route / stop", ""], ["Driver", ""]],
          sections: [
            { heading: "Delivered goods", table: { head: ["Art. no.", "Article", "Ordered", "Delivered", "Remark"], widths: [0.14, 0.38, 0.14, 0.14, 0.2], rows: Array.from({ length: 10 }, () => ["", "", "", "", ""]) } },
            { heading: "Chilled goods", paragraphs: ["Core temperature at delivery: ______ °C (dairy 2-5 °C, meat 0-4 °C)"] },
            { heading: "Receipt", paragraphs: ["Goods received in good order. Name and signature of the customer: ____________________"] },
          ],
        },
      },
      {
        key: "bruno-email",
        folder: "meetings",
        at: "-19d@08:15",
        by: "sandra",
        file: {
          type: "eml",
          name: "Driver app - phones and routes.eml",
          from: BRUNO,
          to: [SANDRA],
          cc: [LUCA],
          at: "-19d@07:40",
          subject: "Driver app - phones and routes",
          body: "Hi Sandra, hi Luca\n\nas promised:\n- Our drivers have rugged Android phones (model from 2024), all with a camera and NFC.\n- Routes are exported from the ERP at 04:30 as a file; we can also offer it through an interface.\n- In the cold store in Winterthur and at about 15 customers there is no mobile signal.\n\nThanks for coming along on the route, Dario liked your ideas.\n\nBruno Kälin\nHead of Logistics, Alpine Fresh AG",
        },
      },
      {
        key: "route-sketch",
        folder: "ride-along",
        at: "-20d@12:40",
        by: "luca",
        file: {
          type: "png",
          name: "Stop flow sketch.png",
          image: {
            type: "whiteboard",
            title: "One stop, step by step",
            boxes: [
              { x: 110, y: 260, w: 330, h: 150, label: "Arrive at stop" },
              { x: 560, y: 260, w: 380, h: 150, label: "Check goods / partial" },
              { x: 1060, y: 260, w: 400, h: 150, label: "Temperature (chilled)", color: "red" },
              { x: 1060, y: 640, w: 400, h: 150, label: "Signature or photo", color: "green" },
              { x: 560, y: 640, w: 380, h: 150, label: "Status delivered" },
            ],
            arrows: [[0, 1], [1, 2], [2, 3], [3, 4]],
            stickies: [{ x: 160, y: 700, text: "No signal? Queue it" }, { x: 160, y: 940, text: "Big buttons - gloves" }],
          },
        },
      },
    ],
  },
  sanitization: {
    clarifications: [
      { key: "route-source", q: "Where does the app get the route of the day: the 04:30 export file or an interface?", a: "From the route interface Bruno offered; the file stays as a fallback.", status: "answered", owner: "luca", answeredBy: "luca", answeredAt: "-16d@10:40", at: "-17d@09:00", source: "file:bruno-email" },
      { key: "no-signature", q: "Is a photo enough as proof when nobody is there to sign?", a: "Yes, a photo of the goods at the agreed drop-off place with time and position (Jonas Meier).", status: "answered", owner: "sandra", answeredBy: "sandra", answeredAt: "-16d@14:20", at: "-17d@09:05", source: "note:ride-along-notes" },
      { key: "temperature-rule", q: "At which stops must the core temperature be measured?", a: "At every stop with chilled goods; values outside the range need a remark and a photo.", status: "answered", owner: "sandra", answeredBy: "sandra", answeredAt: "-16d@14:30", at: "-17d@09:10", source: "note:logistics-call" },
      { key: "offline", q: "How long must the app work without signal?", a: "A whole route (up to 6 hours); everything is sent when the phone is back online.", status: "answered", owner: "luca", answeredBy: "luca", answeredAt: "-15d@09:15", at: "-17d@09:15", source: "file:bruno-email" },
      { key: "returns-pickup", q: "Should drivers also record empties and returns (crates, pallets)?", status: "deferred", deferReason: "Empties are counted at the depot for now; possible extension after the first version.", owner: "sandra", at: "-17d@09:20" },
    ],
    decisions: [
      { key: "photo-proof", title: "Photo is valid proof of delivery", statement: "When nobody signs, a photo of the goods at the drop-off place with time and position is the proof of delivery.", rationale: "About a third of early-morning stops are unattended.", by: "sandra", at: "-15d@11:00", clar: "no-signature" },
      { key: "offline-first", title: "Offline first", statement: "Every action in the app works without signal and is synchronised later, in order.", rationale: "Cold stores and basements have no signal; nothing may be lost.", by: "luca", at: "-15d@11:05", clar: "offline" },
      { key: "portal-status", title: "The app feeds the order portal's delivery status", statement: "Starting a route sets 'on the way'; proof of delivery sets 'delivered' or 'partial'.", rationale: "Customers stop calling the office when they see the status.", by: "sandra", at: "-15d@11:10", source: "note:status-mapping" },
    ],
    tech: [
      { key: "stack", area: "stack", title: "Progressive web app on SELISE Blocks", choice: "Installable web app (PWA) on SELISE Blocks with offline storage on the phone", rationale: "No app store roll-out on company phones; the same platform as the order portal.", alternatives: ["Native Android app", "Cross-platform framework"], experts: ["marco"], status: "accepted", by: "luca", at: "-15d@14:00" },
      { key: "route-interface", area: "integration", title: "Route interface", choice: "Read the routes of the day from the ERP route interface at 04:45; the export file is the fallback", rationale: "Always current, and the fallback keeps the morning safe.", alternatives: ["Export file only"], experts: ["marco"], status: "accepted", by: "luca", at: "-15d@14:05", system: "Alpine Fresh ERP route interface" },
      { key: "sync", area: "nfr", title: "Reliable sync", choice: "Local queue of status changes with retries; server accepts each change once (idempotent)", rationale: "Changes recorded offline must arrive exactly once and in order.", alternatives: ["Send immediately, warn on failure"], experts: ["marco"], status: "accepted", by: "luca", at: "-15d@14:10", nfr: { category: "availability", target: "No status change is lost on a 6-hour route without signal" } },
      { key: "photos", area: "data", title: "Delivery photos", choice: "Photos resized to 1600 px, stored 13 months with the delivery note", rationale: "Enough to settle disputes; keeps storage small.", alternatives: ["Original photos"], experts: ["marco"], status: "accepted", by: "luca", at: "-15d@14:15" },
    ],
    discussion: [
      { by: "sandra", at: "-18d@14:10", text: "Handed over. Luca's ride-along notes are gold - please read them first." },
      { by: "marco", at: "-17d@10:30", text: "From QA: we will need a few rugged phones to test the camera and the offline queue. Bruno said we can borrow two." },
    ],
  },
  requirements: [
    { key: "route-of-day", title: "Drivers see the route of the day", text: "The driver signs in and sees the stops of today's route in order, with address, customer notes and the goods per stop.", category: "functional", priority: "must", criteria: ["The route is available from 04:45", "Stops are shown in delivery order with address and notes", "The goods of each stop are listed"], sources: ["note:logistics-call", "clar:route-source"] },
    { key: "proof-signature", title: "Customers sign on the phone", text: "At each stop the customer signs on the driver's phone; the signature is stored with the delivery note.", category: "functional", priority: "must", criteria: ["The signature is captured on the phone", "The signed delivery note can be found by order number"], sources: ["note:logistics-call"] },
    { key: "proof-photo", title: "Photo proof when nobody signs", text: "When nobody is there, the driver takes a photo of the goods at the drop-off place; time and position are stored.", category: "functional", priority: "must", criteria: ["A photo can replace the signature", "Time and position are stored with the photo"], sources: ["dec:photo-proof"] },
    { key: "partial-delivery", title: "Partial deliveries are recorded", text: "The driver marks missing or refused items at the stop; the delivery note and the order portal show the difference.", category: "functional", priority: "must", criteria: ["Items can be marked missing or refused with a reason", "The order portal shows 'partial'"], sources: ["note:status-mapping"] },
    { key: "temperature", title: "Core temperature of chilled goods", text: "At stops with chilled goods the driver records the core temperature; values outside the range need a remark and a photo.", category: "functional", priority: "must", criteria: ["Chilled stops ask for the temperature", "Out-of-range values require a remark and a photo"], sources: ["clar:temperature-rule"] },
    { key: "offline", title: "Works a whole route without signal", text: "All actions work offline and are synchronised in order when the phone is back online.", category: "nfr", priority: "must", criteria: ["A 6-hour route can be driven without signal", "No action is lost or applied twice"], sources: ["dec:offline-first"] },
    { key: "status-to-portal", title: "Delivery status reaches the order portal", text: "Starting the route and each proof of delivery update the status customers see in the order portal.", category: "integration", priority: "must", criteria: ["'On the way' appears when the route starts", "'Delivered' or 'partial' appears after proof of delivery"], sources: ["dec:portal-status"] },
    { key: "dispatch-overview", title: "Dispatch sees the progress of every truck", text: "The office sees per route how many stops are done and any problems.", category: "functional", priority: "nice", criteria: ["Each route shows done and open stops", "Problems (partial, temperature) are highlighted"], sources: ["note:logistics-call"] },
  ],
  objective: {
    statement: "Alpine Fresh's 22 drivers deliver without paper: they follow the route of the day on their phone, record proof of delivery with signature or photo and the temperature of chilled goods, and customers see the delivery status in the order portal as it happens.",
    criteria: ["Drivers work the whole route on the phone, also without signal", "Every stop has a signature or photo as proof", "Customers see 'on the way' and 'delivered' in the order portal"],
    highLevelMd: "## Users\n- 22 drivers on 14 trucks\n- Dispatch in the Zurich office\n- Customers, through the order portal's delivery status\n\n## Main flows\n- Start the route, drive stop by stop\n- Proof of delivery: signature or photo, partial deliveries, temperature\n- Status to the order portal",
    architectureMd: "Installable web app (PWA) on SELISE Blocks with an offline queue on the phone; routes from the ERP route interface; status changes to the order portal's delivery status; photos in Storage.",
  },
  design: {
    mode: "describe",
    instructions: "For drivers wearing gloves in a cold truck at 5 in the morning: very large buttons, high contrast, one decision per screen, Alpine Fresh green. Always show whether the phone is offline and how many changes wait to be sent.",
    brand: "2f7d4f",
    app: "ALPINE DRIVER",
    confirmedBy: "sandra",
    screens: [
      { key: "route", name: "Route of the day", status: "accepted", image: { device: "mobile", title: "Route Winterthur 1", nav: ["Route", "Stop", "Sync"], activeNav: 0, blocks: [{ k: "stats", items: [["Stops", "17"], ["Done", "5"], ["Waiting", "2"]] }, { k: "list", items: [["6 Restaurant Lindenhof", "06:10"], ["7 Hotel Krone", "06:25"], ["8 Deli Fontana", "06:40"], ["9 Cafe Rosengarten", "06:55"]] }, { k: "button", text: "Next stop" }] } },
      { key: "stop", name: "Stop", status: "accepted", image: { device: "mobile", title: "Stop 6 - Lindenhof", nav: ["Route", "Stop", "Sync"], activeNav: 1, blocks: [{ k: "card", title: "Back door, code 4471", lines: ["Chilled goods - measure temperature"], badge: "CHILLED", tone: "info" }, { k: "list", items: [["Cherry tomatoes", "6 kg"], ["Whole milk 1 l", "40"], ["Butter 1 kg", "6"]] }, { k: "button", text: "Deliver" }, { k: "button", text: "Item missing or refused", secondary: true }] } },
      { key: "proof", name: "Proof of delivery", image: { device: "mobile", title: "Proof of delivery", nav: ["Route", "Stop", "Sync"], activeNav: 1, blocks: [{ k: "card", title: "Customer signs here", lines: ["", "", ""] }, { k: "button", text: "Confirm signature" }, { k: "button", text: "Nobody there - take photo", secondary: true }] } },
      { key: "temperature", name: "Temperature check", status: "changes-requested", image: { device: "mobile", title: "Temperature", nav: ["Route", "Stop", "Sync"], activeNav: 1, blocks: [{ k: "field", label: "Core temperature dairy", value: "4.2 C" }, { k: "card", title: "Within range", lines: ["Dairy 2-5 C"], badge: "OK", tone: "ok" }, { k: "button", text: "Save" }] } },
    ],
  },
  scope: {
    title: "Driver app, first version",
    summary: "Drivers follow the route of the day, record proof of delivery with signature or photo, partial deliveries and temperatures, offline first, and the order portal shows the delivery status. Dispatch gets a simple overview at the end.",
    features: [
      {
        key: "route-of-day",
        title: "Route of the day",
        description: "Today's stops in order, with goods and notes, from the ERP route interface.",
        priority: "must",
        reqs: ["route-of-day"],
        stories: [
          { key: "see-route", title: "See today's stops in order", actor: "driver", text: "As a driver I see today's stops in delivery order so that I can plan the route.", criteria: ["Stops appear from 04:45", "Each stop shows address, notes and goods"], hours: 6 },
          { key: "start-route", title: "Start the route", actor: "driver", text: "As a driver I start the route when I leave the depot so that customers see 'on the way'.", criteria: ["Starting sets 'on the way' for all orders of the route"], hours: 3 },
        ],
      },
      {
        key: "proof-of-delivery",
        title: "Proof of delivery",
        description: "Signature or photo at each stop, partial deliveries with reasons.",
        priority: "must",
        reqs: ["proof-signature", "proof-photo", "partial-delivery"],
        stories: [
          { key: "sign", title: "Customer signs on the phone", actor: "driver", text: "As a driver I let the customer sign on my phone so that the delivery is confirmed.", criteria: ["The signature is stored with the delivery note", "The stop is marked delivered"], hours: 5 },
          { key: "photo-proof", title: "Take a photo when nobody signs", actor: "driver", text: "As a driver I take a photo of the goods when nobody is there so that the delivery is still proven.", criteria: ["Photo with time and position", "The stop is marked delivered"], hours: 4 },
          { key: "partial", title: "Mark missing or refused items", actor: "driver", text: "As a driver I mark items that are missing or refused so that the customer is invoiced correctly.", criteria: ["Each item can be marked with a reason", "The order shows 'partial'"], hours: 5 },
        ],
      },
      {
        key: "temperature-check",
        title: "Temperature check",
        description: "Core temperature of chilled goods with range check.",
        priority: "must",
        reqs: ["temperature"],
        stories: [
          { key: "record-temperature", title: "Record the core temperature", actor: "driver", text: "As a driver I record the core temperature at stops with chilled goods.", criteria: ["Chilled stops ask for the temperature", "The value is stored with the delivery note"], hours: 3 },
          { key: "out-of-range", title: "Handle out-of-range values", actor: "driver", text: "As a driver I add a remark and a photo when the temperature is out of range.", criteria: ["Out-of-range values require a remark and a photo", "Dispatch sees the problem"], hours: 3 },
        ],
      },
      {
        key: "status-sync",
        title: "Offline sync and portal status",
        description: "Offline queue and delivery status to the order portal.",
        priority: "must",
        reqs: ["offline", "status-to-portal"],
        stories: [
          { key: "offline-queue", title: "Work without signal", actor: "driver", text: "As a driver I keep working without signal and the app sends everything later.", criteria: ["All actions work offline", "Queued changes are sent once, in order"], hours: 8 },
          { key: "portal-status", title: "Customers see the delivery status", actor: "customer", text: "As a customer I see in the order portal when my order is on the way and delivered.", criteria: ["Status changes appear within a minute of being sent"], hours: 4 },
        ],
      },
      {
        key: "dispatch-view",
        title: "Dispatch overview",
        description: "Progress of every route for the office.",
        priority: "nice",
        reqs: ["dispatch-overview"],
        stories: [
          { key: "routes-progress", title: "See every route's progress", actor: "dispatcher", text: "As a dispatcher I see done and open stops per route.", criteria: ["Each route shows done and open stops"], hours: 4 },
          { key: "problems", title: "See delivery problems", actor: "dispatcher", text: "As a dispatcher I see partial deliveries and temperature problems as they happen.", criteria: ["Problems are highlighted with the stop and the driver"], hours: 3 },
        ],
      },
    ],
    milestones: [
      { name: "Route of the day", goal: "Drivers see and start today's route on the phone.", features: ["route-of-day"], preview: "A driver signs in at 04:50, sees the 17 stops of Winterthur 1 and starts the route." },
      { name: "Proof of delivery", goal: "Every stop ends with signature or photo, partial deliveries and temperatures.", features: ["proof-of-delivery", "temperature-check"], preview: "At stop 6 the chef signs, one crate of butter is refused and the milk is at 4.2 °C." },
      { name: "Live status", goal: "The order portal and dispatch see deliveries as they happen, also after offline stretches.", features: ["status-sync", "dispatch-view"], preview: "A delivery recorded in the cold store shows as delivered in the order portal once the truck is outside." },
    ],
    challenges: [
      { severity: "high", question: "What happens when two drivers have the same route on their phone?", why: "Phones are shared between shifts; two devices could deliver the same stop.", fix: "A route can be started on one phone only; a second phone sees it read-only.", target: { type: "feature", key: "route-of-day" }, status: "accepted", by: "luca", at: "-8d@10:15" },
      { severity: "medium", question: "Is a photo without a visible house number enough proof?", why: "Disputes are settled with the photo; the place must be recognisable.", fix: "Ask for the drop-off place in the photo and store the position.", target: { type: "story", key: "photo-proof" }, status: "answered", answer: "Position and time are stored with the photo; drivers are trained to include the door.", by: "sandra", at: "-8d@10:40" },
    ],
    feedback: [
      {
        target: "story:partial",
        resolved: true,
        comments: [
          { by: "petra", at: "-8d@08:05", text: "Refused items must show up on the invoice correction the same day, otherwise the customer gets a reminder for goods he never took." },
          { by: "luca", at: "-8d@09:20", text: "Good point - the partial status goes to the order portal immediately, and the order desk sees the correction there. Added to the acceptance criteria." },
        ],
      },
    ],
  },
  delivery: {
    builds: ["-3d@09:30"],
    builtMilestones: 1,
    current: { progress: 0.45 },
    tasks: [
      { tag: "ci", title: "Build pipeline and preview environment", milestone: 1, hours: 3, description: "Pipeline with a preview per milestone, installable on the test phones.", acceptance: ["Every milestone is deployed to its preview", "The preview can be installed on Android phones"] },
      { tag: "offline-store", title: "Offline storage on the phone", milestone: 2, hours: 4, description: "Local storage of routes, proofs and photos so every stop works without signal.", acceptance: ["Route and proofs survive a restart of the phone", "Photos are kept until they are sent"] },
      { tag: "sec", title: "Security review of photos and signatures", milestone: 3, hours: 3, description: "Photos and signatures are personal data: check storage, access and retention.", acceptance: ["Only Alpine Fresh staff can open photos and signatures", "Retention of 13 months is enforced"] },
    ],
    ticketComments: [
      { ticket: "r1.0", by: "marco", text: "Tested on the rugged phone with gloves: the stop list scrolls fine, but the font could be one size bigger.", after: 6 },
      { ticket: "r2.0", by: "petra", text: "Please make sure the signature also works with a pen, some of our chefs have floury hands.", after: 0 },
    ],
    urls: { dev: "https://driver.dev.alpine-fresh.ch" },
  },
  chat: [
    {
      role: "qa",
      messages: [
        { from: "marco", at: "-1d@15:10", text: "How do you test the offline queue for milestone 2?" },
        { from: "agent", at: "-1d@15:11", text: "Each proof is recorded with the network switched off, then the phone goes back online and the test checks that every status arrives once and in order. I also replay the same queue twice to make sure nothing is applied twice." },
      ],
    },
    {
      role: "dev",
      messages: [
        { from: "luca", at: "-0d@09:05", text: "Which camera resolution do you use for the photo proof?" },
        { from: "agent", at: "-0d@09:06", text: "Photos are taken at the phone's resolution and resized to 1600 px on the phone before they are queued, as decided in the tech decision on delivery photos. That keeps a route with 60 photos under 30 MB." },
      ],
    },
  ],
};
