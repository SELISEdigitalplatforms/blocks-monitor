/** The promo film's scripted stories: the scripted answers, the chips, the files, the business analyst's questions and
 *  the first requirements, plus the few lines that depend on the product. They are told ONLY when asked for
 *  explicitly (?story=driver or ?story=webpilot, kept for the browser tab, or the recording mode ?rec=1 that films
 *  the default Driver Delivery App). Every other visit is the real office (script.ts buildRealScript, real.ts): the
 *  person's own words and files, saved to a real project. ?story=real (or any unknown id) forgets a kept story. */

import { filmModeEnabled } from "./filmMode";
import { t } from "@/madp/i18n";

export type StoryId = "driver" | "webpilot";

export interface StoryQuestion { q: string; chips: string[]; auto: string }
export interface Requirement { id: string; title: string; body: string }
/** the product's name as said in a line (the typed name up to the first dash or comma) */
type Lines = (name: string) => string;

export interface Story {
  id: StoryId;
  /** the visitor's name when nobody is signed in */
  visitor: string;
  /** the project's name */
  name: string;
  namePlaceholder: string;
  about: string;
  website: string;
  /** the website card: the site as it is today */
  site: { title: string; blurb: string; tint: [string, string]; ink: string };
  audience: { chips: string[]; auto: string };
  goal: { chips: string[]; auto: string };
  filesAsk: string;
  files: string[];
  /** said once the story's own files are read */
  filesRead: string;
  followups: StoryQuestion[];
  /** the first requirements, shaped by the answers to the follow-up questions */
  requirements: (followups: string[]) => Requirement[];
  /** github: where the code lives (MADP Factory by default, or the visitor's own GitHub, connected for real) */
  lines: { toEngineering: Lines; github: Lines; env: string };
}

const dr = {
  allRoute: () => t("studio.cinematic.story.driver.allRoute", "Yes, the whole route"),
  fewStops: () => t("studio.cinematic.story.driver.fewStops", "Only for a few stops"),
  photoEnough: () => t("studio.cinematic.story.driver.photoEnough", "Yes, a photo is enough"),
  alwaysSign: () => t("studio.cinematic.story.driver.alwaysSign", "Always ask for a signature"),
  liveStatus: () => t("studio.cinematic.story.driver.liveStatus", "Yes, live status"),
  notFirst: () => t("studio.cinematic.story.driver.notFirst", "Not in the first version"),
};

/* Every text a person sees is read when it is shown (getters), so it follows the chosen language; names, the website
 * and the file names stay as they are. */
export const DRIVER: Story = {
  id: "driver",
  visitor: "Sandra",
  name: "Driver Delivery App",
  get namePlaceholder() { return t("studio.cinematic.story.namePlaceholder", "e.g. {name}", { name: "Driver Delivery App" }); },
  get about() {
    return t("studio.cinematic.story.driver.about", "Our drivers work from printed route lists and paper delivery notes. A phone app should show the route of the day, record proof of delivery with photo and signature, check the temperature of chilled goods and update the delivery status customers see in the order portal.");
  },
  website: "alpine-fresh.ch",
  site: { title: "Alpine Fresh AG", get blurb() { return t("studio.cinematic.story.driver.siteBlurb", "Fresh food wholesale for restaurants and shops in and around Zurich."); }, tint: ["#e9f6ee", "#d4ecdc"], ink: "#2f7d4f" },
  audience: {
    get chips() {
      return [t("studio.cinematic.story.driver.drivers", "Delivery drivers"), t("studio.cinematic.story.driver.customers", "Our customers"), t("studio.cinematic.story.driver.dispatch", "Dispatch office"), t("studio.cinematic.story.driver.fieldTeams", "Field teams")];
    },
    get auto() { return t("studio.cinematic.story.driver.audienceAuto", "Delivery drivers, our customers and the dispatch office"); },
  },
  goal: {
    get chips() {
      return [t("studio.cinematic.story.driver.saveTime", "Save time"), t("studio.cinematic.story.driver.fewerDisputes", "Fewer disputes"), t("studio.cinematic.story.driver.happierCustomers", "Happier customers"), t("studio.cinematic.story.driver.replacePaper", "Replace paper")];
    },
    get auto() { return t("studio.cinematic.story.driver.goalAuto", "Replace paper and end delivery disputes"); },
  },
  get filesAsk() { return t("studio.cinematic.story.driver.filesAsk", "Do you have any files for us? Templates, notes, lists. Just drop them here."); },
  files: ["Delivery note template.pdf", "Ride-along notes.docx", "Route list Winterthur.xlsx"],
  get filesRead() { return t("studio.cinematic.story.driver.filesRead", "Got them. Your delivery note, the Winterthur route with 17 stops, and the ride-along notes."); },
  get followups() {
    return [
      {
        q: t("studio.cinematic.story.driver.offlineQ", "Cold stores and basements often have no signal. Should the app keep working offline for a whole route?"),
        chips: [dr.allRoute(), dr.fewStops()],
        auto: dr.allRoute(),
      },
      {
        q: t("studio.cinematic.story.driver.photoQ", "When nobody is there to sign, is a photo of the goods enough as proof?"),
        chips: [dr.photoEnough(), dr.alwaysSign()],
        auto: dr.photoEnough(),
      },
      {
        q: t("studio.cinematic.story.driver.statusQ", "And should your customers see the delivery status live in the order portal?"),
        chips: [dr.liveStatus(), dr.notFirst()],
        auto: dr.liveStatus(),
      },
    ];
  },
  requirements: (f) => [
    { id: "R1", title: t("studio.cinematic.story.driver.r1Title", "Route of the day"), body: t("studio.cinematic.story.driver.r1Body", "Drivers see today's stops in order, with address and goods.") },
    {
      id: "R2",
      title: t("studio.cinematic.story.driver.r2Title", "Proof of delivery"),
      body: f[1] === dr.alwaysSign() || f[1]?.startsWith("Always")
        ? t("studio.cinematic.story.driver.r2BodySign", "Customers sign on the phone at every stop.")
        : t("studio.cinematic.story.driver.r2Body", "A signature on the phone, or a photo when nobody signs."),
    },
    { id: "R3", title: t("studio.cinematic.story.driver.r3Title", "Chilled goods"), body: t("studio.cinematic.story.driver.r3Body", "The core temperature is recorded at stops with chilled goods.") },
    {
      id: "R4",
      title: f[0] === dr.fewStops() || f[0]?.startsWith("Only") ? t("studio.cinematic.story.driver.r4TitleShort", "Short offline stretches") : t("studio.cinematic.story.driver.r4Title", "Works without signal"),
      body: t("studio.cinematic.story.driver.r4Body", "Everything is saved on the phone and sent in order later."),
    },
    {
      id: "R5",
      title: t("studio.cinematic.story.driver.r5Title", "Live delivery status"),
      body: f[2] === dr.notFirst() || f[2]?.startsWith("Not")
        ? t("studio.cinematic.story.driver.r5BodyLater", "Status updates follow in a later version.")
        : t("studio.cinematic.story.driver.r5Body", "Customers see 'on the way' and 'delivered' in the order portal."),
    },
  ],
  lines: {
    toEngineering: () => t("studio.cinematic.script.toEngineering", "Now let's set up where your code will live. Engineering is right next door."),
    github: () => t("studio.cinematic.script.codeHome", "This is where your software will live. MADP Factory keeps the code safe for you, or you can connect your own GitHub."),
    get env() { return t("studio.cinematic.story.driver.env", "And where should it run first?"); },
  },
};

const wp = {
  citedSources: () => t("studio.cinematic.story.webpilot.citedSources", "Mentions and cited sources"),
  mentionsOnly: () => t("studio.cinematic.story.webpilot.mentionsOnly", "Mentions only"),
  worldwide: () => t("studio.cinematic.story.webpilot.worldwide", "Yes, worldwide"),
  europe: () => t("studio.cinematic.story.webpilot.europe", "Only Europe"),
  days30: () => t("studio.cinematic.story.webpilot.days30", "30 days before expiry"),
  days14: () => t("studio.cinematic.story.webpilot.days14", "14 days before expiry"),
};

export const WEBPILOT: Story = {
  id: "webpilot",
  visitor: "Lea",
  name: "WebPilot",
  get namePlaceholder() { return t("studio.cinematic.story.namePlaceholder", "e.g. {name}", { name: "WebPilot" }); },
  get about() {
    return t("studio.cinematic.story.webpilot.about", "WebPilot watches the SEO of our customers' websites and e-mails them when it drops. Customers now want one place for everything that makes a site production-ready: SEO, visibility in AI search, DNS propagation, SSL certificates and performance, with alerts within minutes. We rebuild it without breaking anything for the 2,400 sites already registered.");
  },
  website: "webpilot.selise.ch",
  site: { title: "WebPilot", get blurb() { return t("studio.cinematic.story.webpilot.siteBlurb", "Monitors the SEO of your websites and alerts you when it drops."); }, tint: ["#e8f1fb", "#d2e4f6"], ink: "#0066b2" },
  audience: {
    get chips() {
      return [t("studio.cinematic.story.webpilot.owners", "Website owners"), t("studio.cinematic.story.webpilot.agencies", "Agencies"), t("studio.cinematic.story.webpilot.marketing", "Marketing teams"), t("studio.cinematic.story.webpilot.developers", "Developers")];
    },
    get auto() { return t("studio.cinematic.story.webpilot.owners", "Website owners"); },
  },
  goal: {
    get chips() {
      return [t("studio.cinematic.story.webpilot.readinessScore", "One readiness score"), t("studio.cinematic.story.webpilot.fewerSurprises", "Fewer surprises"), t("studio.cinematic.story.webpilot.fasterFixes", "Faster fixes"), t("studio.cinematic.story.webpilot.growTraffic", "Grow traffic")];
    },
    get auto() { return t("studio.cinematic.story.webpilot.readinessScore", "One readiness score"); },
  },
  get filesAsk() { return t("studio.cinematic.story.webpilot.filesAsk", "Do you have any files for us? A roadmap, customer requests, the alerts you send today. Just drop them here."); },
  files: ["WebPilot 2.0 roadmap.pdf", "Customer requests Q3.csv", "Current alert e-mail.eml"],
  get filesRead() { return t("studio.cinematic.story.webpilot.filesRead", "Got them. Your 2.0 roadmap, the customer requests from Q3 and the alert e-mail you send today."); },
  get followups() {
    return [
      {
        q: t("studio.cinematic.story.webpilot.aiSearchQ", "For AI search, should WebPilot track only how often a site is mentioned, or also which sources the assistants cite?"),
        chips: [wp.citedSources(), wp.mentionsOnly()],
        auto: wp.citedSources(),
      },
      {
        q: t("studio.cinematic.story.webpilot.dnsQ", "DNS changes take time to spread. Should we check propagation from several regions and alert when they disagree?"),
        chips: [wp.worldwide(), wp.europe()],
        auto: wp.worldwide(),
      },
      {
        q: t("studio.cinematic.story.webpilot.sslQ", "When should the first SSL alert go out?"),
        chips: [wp.days30(), wp.days14()],
        auto: wp.days30(),
      },
    ];
  },
  requirements: (f) => {
    const mentionsOnly = f[0] === wp.mentionsOnly() || f[0] === "Mentions only";
    const europe = f[1] === wp.europe() || f[1] === "Only Europe";
    const days = f[2] === wp.days14() || f[2] === "14 days before expiry" ? 14 : 30;
    return [
      { id: "R1", title: t("studio.cinematic.story.webpilot.r1Title", "Readiness score"), body: t("studio.cinematic.story.webpilot.r1Body", "One Production readiness score per site.") },
      { id: "R2", title: t("studio.cinematic.story.webpilot.r2Title", "Search visibility"), body: mentionsOnly ? t("studio.cinematic.story.webpilot.r2BodyMentions", "SEO and GEO visibility, counting mentions in AI search.") : t("studio.cinematic.story.webpilot.r2Body", "SEO and GEO visibility.") },
      { id: "R3", title: t("studio.cinematic.story.webpilot.r3Title", "DNS propagation"), body: europe ? t("studio.cinematic.story.webpilot.r3BodyEurope", "DNS propagation from several regions in Europe.") : t("studio.cinematic.story.webpilot.r3Body", "DNS propagation from several regions.") },
      { id: "R4", title: t("studio.cinematic.story.webpilot.r4Title", "SSL certificates"), body: t("studio.cinematic.story.webpilot.r4Body", "SSL certificate watch, with the first alert {days} days ahead.", { days }) },
      { id: "R5", title: t("studio.cinematic.story.webpilot.r5Title", "Performance"), body: t("studio.cinematic.story.webpilot.r5Body", "Core Web Vitals per page.") },
      { id: "R6", title: t("studio.cinematic.story.webpilot.r6Title", "Alerts in minutes"), body: t("studio.cinematic.story.webpilot.r6Body", "Alerts within minutes, by e-mail and in the app.") },
      { id: "R7", title: t("studio.cinematic.story.webpilot.r7Title", "Nothing lost"), body: t("studio.cinematic.story.webpilot.r7Body", "Every existing site, user and alert history kept.") },
    ];
  },
  lines: {
    toEngineering: (name) => t("studio.cinematic.story.webpilot.toEngineering", "Now let's decide where the new code of {name} lives. Engineering is right next door.", { name: name || t("studio.cinematic.script.it", "it") }),
    github: () => t("studio.cinematic.story.webpilot.github", "MADP Factory keeps the new code safe for you, or you can connect your own GitHub."),
    get env() { return t("studio.cinematic.story.webpilot.env", "And where should the new version run first?"); },
  },
};

export const STORIES: Record<StoryId, Story> = { driver: DRIVER, webpilot: WEBPILOT };

const KEY = "madp.journey.story";
const isStoryId = (v: string | null): v is StoryId => v !== null && Object.prototype.hasOwnProperty.call(STORIES, v);

/** The story of this visit, or null for the real office: ?story=<id> (remembered for the tab; an unknown id such as
 *  ?story=real clears it), else the tab's kept story, else the default story only in recording mode (?rec), else none.
 *  Always none (and a kept story is forgotten) unless the film mode is on (./filmMode.ts: a development build only). */
export function pickStory(search: string = window.location.search, enabled: boolean = filmModeEnabled()): Story | null {
  if (!enabled) {
    try {
      sessionStorage.removeItem(KEY);
    } catch {
      // storage blocked: nothing was kept either
    }
    return null;
  }
  const params = new URLSearchParams(search);
  const asked = params.get("story");
  let id: string | null = asked;
  try {
    if (asked !== null) {
      if (isStoryId(asked)) sessionStorage.setItem(KEY, asked);
      else sessionStorage.removeItem(KEY);
    } else id = sessionStorage.getItem(KEY);
  } catch {
    // storage blocked: the URL alone decides
  }
  if (isStoryId(id)) return STORIES[id];
  return asked === null && params.has("rec") ? DRIVER : null;
}

/** The count words, each key written out in full (read at call time, so they follow the chosen language). */
const COUNT: readonly (() => string)[] = [
  () => t("studio.cinematic.count.n0", "no"), () => t("studio.cinematic.count.n1", "one"),
  () => t("studio.cinematic.count.n2", "two"), () => t("studio.cinematic.count.n3", "three"),
  () => t("studio.cinematic.count.n4", "four"), () => t("studio.cinematic.count.n5", "five"),
  () => t("studio.cinematic.count.n6", "six"), () => t("studio.cinematic.count.n7", "seven"),
  () => t("studio.cinematic.count.n8", "eight"), () => t("studio.cinematic.count.n9", "nine"),
  () => t("studio.cinematic.count.n10", "ten"),
];
/** A count said as a word ("three"), the number itself above ten. */
export function countWord(n: number): string {
  const w = Number.isInteger(n) && n >= 0 ? COUNT[n] : undefined;
  return w ? w() : String(n);
}
const sameNames = (a: string[], b: string[]) =>
  a.length === b.length && [...a].map((x) => x.toLowerCase()).sort().join("\n") === [...b].map((x) => x.toLowerCase()).sort().join("\n");

/** The line once files are read: the story's own files by what they hold, any others plainly. */
export function filesReadLine(story: Story, names: string[]): string {
  if (sameNames(names, story.files)) return story.filesRead;
  return names.length === 1
    ? t("studio.cinematic.script.readOne", "Got it. I've read it.")
    : t("studio.cinematic.script.readAll", "Got them. I've read all {count}.", { count: countWord(names.length) });
}
