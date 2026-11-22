/** The words of the visit: one continuous conversation, place by place.
 *  - buildRealScript: the real office (the default). The person is greeted by name (they are signed in), and the
 *    project's name, the idea, the website, who it is for, what matters and the files are theirs; the visit's store
 *    saves each to a real project as it is given (real.ts). Chips are the guided start's own neutral ones.
 *  - buildScript(story): the promo film's scripted story (stories.ts), only when asked for explicitly. */
import { EMPTY_ANSWERS, GOAL_CHIPS, LIMITS, USER_CHIPS, toCreateArgs } from "../../../domain/guidedStart";
import { repoSlug } from "../../../domain/projectType";
import { t } from "../../../i18n";
import type { StageId } from "./places";
import type { Story } from "./stories";

export type Speaker = "assistant" | "pm";
export type AskKind = "text" | "chips" | "files" | "github" | "confirm";
/** the rich card shown above the composer */
export type CardKind = "website" | "files" | "github" | "summary" | "requirements";

/** Where the code lives: MADP Factory keeps it (the default), or a new private repository in the GitHub account the
 *  visitor really connected. "" until chosen. */
export type CodeHome = "" | "factory" | "github";

export interface Answers {
  visitor: string;
  name: string;
  about: string;
  website: string;
  audience: string;
  goal: string;
  files: string[];
  code: CodeHome;
  /** "owner/name" of the new GitHub repository (code = "github"), else "". */
  repo: string;
  env: string;
  followups: string[];
}

export interface Ask {
  kind: AskKind;
  placeholder?: string;
  chips?: string[];
  /** chips + free text allowed */
  freeText?: boolean;
  /** "add": a chip is added to the typed answer (several can be picked; Send answers); default: a chip answers */
  chipMode?: "answer" | "add";
  multiline?: boolean;
  /** the longest answer the project keeps */
  maxLength?: number;
}

export interface Node {
  id: string;
  stage: StageId;
  speaker: Speaker;
  say: (a: Answers) => string[];
  /** lines said while walking here from the previous place (shown as captions) */
  walkTalk?: (a: Answers) => string[];
  /** the business analyst walks in before this node */
  pmJoins?: boolean;
  card?: CardKind;
  ask?: Ask;
  /** story mode: the scripted answer the promo film gives ("" = this node asks nothing) */
  scripted: string | string[];
  apply?: (a: Answers, value: string | string[]) => Partial<Answers>;
  /** a typed answer that can't be kept: what the guide says instead (the question stays open) */
  check?: (value: string) => string | null;
}

const short = (s: string) => s.split(/[—,–]/)[0].trim();

/** The code-home answer: "factory", or "github:<login>" of the account the visitor connected for real. */
export const GITHUB_ANSWER = "github:";
export function codeAnswer(a: Answers, value: string): Partial<Answers> {
  if (value.startsWith(GITHUB_ANSWER) && value.length > GITHUB_ANSWER.length) {
    return { code: "github", repo: `${value.slice(GITHUB_ANSWER.length)}/${repoSlug(a.name)}` };
  }
  return { code: "factory", repo: "" };
}

/** The project.create arguments at launch: MADP Factory keeps the code, unless the visitor connected GitHub for real
 *  (then a new private repository in that account, created with the project). */
export function createArgsOf(a: Answers, githubLogin: string | null) {
  const login = a.code === "github" ? githubLogin : null;
  return toCreateArgs(
    { ...EMPTY_ANSWERS, kind: "new", name: a.name, description: a.about, goal: a.goal, users: a.audience, repoChoice: login ? "create" : "factory" },
    login,
  );
}

/** What the visitor's choice reads as in the transcript. */
export function codeAnswerText(value: string): string {
  return value.startsWith(GITHUB_ANSWER)
    ? t("studio.cinematic.script.useGithubAs", "Use GitHub as @{login}", { login: value.slice(GITHUB_ANSWER.length) })
    : t("studio.cinematic.script.keepInFactory", "Keep the code in MADP Factory");
}
const first = (s: string) => s.trim().split(/\s+/)[0] ?? "";

/** The "Not yet" chip (no website yet), in the language shown; an answer is "not yet" in English or as shown. */
export const notYet = () => t("studio.cinematic.script.notYet", "Not yet");
export const isNotYet = (v: unknown) => v === "Not yet" || v === notYet();
const startBuilding = () => t("studio.cinematic.script.startBuilding", "Start building");
const letsGo = () => t("studio.cinematic.script.letsGo", "Let's go");

export function buildScript(story: Story): Node[] {
  const env = {
    preview: () => t("studio.cinematic.script.envPreview", "Private preview"),
    stage: () => t("studio.cinematic.script.envStage", "Shared stage"),
    live: () => t("studio.cinematic.script.envLive", "Live"),
  };
  return [
    /* Reception */
    {
      id: "visitor",
      stage: "reception",
      speaker: "assistant",
      say: () => [
        t("studio.cinematic.script.storyWelcome", "Good morning, and welcome to SELISE. I'm the MADP Assistant."),
        t("studio.cinematic.script.storyAskVisitor", "May I have your name?"),
      ],
      ask: { kind: "text", get placeholder() { return t("studio.cinematic.script.yourName", "Your name"); } },
      get scripted() { return story.visitor; },
      apply: (_a, v) => ({ visitor: String(v) }),
    },
    {
      id: "name",
      stage: "reception",
      speaker: "assistant",
      say: (a) => [first(a.visitor)
        ? t("studio.cinematic.script.storyAskName", "Lovely to meet you, {name}. So, what are we building today? Give it a name.", { name: first(a.visitor) })
        : t("studio.cinematic.script.storyAskNameAnon", "Lovely to meet you, and welcome. So, what are we building today? Give it a name.")],
      ask: { kind: "text", get placeholder() { return story.namePlaceholder; } },
      get scripted() { return story.name; },
      apply: (_a, v) => ({ name: String(v) }),
    },
    /* Meeting room: one discovery conversation */
    {
      id: "about",
      stage: "meeting",
      speaker: "assistant",
      walkTalk: (a) => [
        t("studio.cinematic.script.toMeeting", "{name}. Come with me, the meeting room is just over here.", { name: short(a.name) || t("studio.cinematic.script.great", "Great") }),
        t("studio.cinematic.script.haveASeat", "Have a seat. I'll put our notes up on the screen as we talk."),
      ],
      say: () => [t("studio.cinematic.script.askAbout", "Tell me what it's about. Who has the problem today, and what should change?")],
      ask: { kind: "text", get placeholder() { return t("studio.cinematic.script.fewSentences", "A few sentences are plenty"); }, multiline: true },
      get scripted() { return story.about; },
      apply: (_a, v) => ({ about: String(v) }),
    },
    {
      id: "website",
      stage: "meeting",
      speaker: "assistant",
      say: () => [t("studio.cinematic.script.storyAskWebsite", "That's clear. Do you already have a website I can look at?")],
      ask: {
        kind: "chips",
        get chips() { return [notYet()]; },
        freeText: true,
        get placeholder() { return t("studio.cinematic.script.pasteLink", "Paste the link (optional)"); },
      },
      get scripted() { return story.website; },
      apply: (_a, v) => ({ website: isNotYet(String(v)) ? "" : String(v).replace(/^https?:\/\//, "") }),
    },
    {
      id: "audience",
      stage: "meeting",
      speaker: "assistant",
      say: (a) => [a.website
        ? t("studio.cinematic.script.storyPinnedSite", "Got it, I've pinned your site. Who will use the app?")
        : t("studio.cinematic.script.noProblemWho", "No problem. Who will use the app?")],
      ask: { kind: "chips", get chips() { return story.audience.chips; }, freeText: true, get placeholder() { return t("studio.cinematic.script.orDescribe", "Or describe them"); } },
      get scripted() { return story.audience.auto; },
      apply: (_a, v) => ({ audience: String(v) }),
    },
    {
      id: "goal",
      stage: "meeting",
      speaker: "assistant",
      say: () => [t("studio.cinematic.script.storyAskGoal", "And what's the main goal for you?")],
      ask: { kind: "chips", get chips() { return story.goal.chips; }, freeText: true, get placeholder() { return t("studio.cinematic.script.orYourWords", "Or in your words"); } },
      get scripted() { return story.goal.auto; },
      apply: (_a, v) => ({ goal: String(v) }),
    },
    {
      id: "files",
      stage: "meeting",
      speaker: "assistant",
      say: () => [story.filesAsk],
      ask: { kind: "files" },
      card: "files",
      scripted: story.files,
      apply: (_a, v) => ({ files: Array.isArray(v) ? v : [] }),
    },
    {
      id: "summary",
      stage: "meeting",
      speaker: "pm",
      pmJoins: true,
      say: (a) => [
        t("studio.cinematic.script.analystHello", "Hello {name}, I'm your business analyst. I've been following along.", { name: first(a.visitor) || t("studio.cinematic.script.there", "there") }),
        t("studio.cinematic.script.storyUnderstood", "Here's what we understood about {name}.", { name: short(a.name) || t("studio.cinematic.script.yourProduct", "your product") }),
      ],
      card: "summary",
      scripted: "",
    },
    ...story.followups.map<Node>((_f, i) => ({
      id: `f${i}`,
      stage: "meeting",
      speaker: "pm",
      say: () => {
        const q = story.followups[i].q;
        return [i === 0 ? t("studio.cinematic.script.threeQuestions", "Three quick questions. {question}", { question: q }) : q];
      },
      ask: { kind: "chips", get chips() { return story.followups[i].chips; } },
      get scripted() { return story.followups[i].auto; },
      apply: (a, v) => ({ followups: [...a.followups.slice(0, i), String(v)] }),
    })),
    /* Engineering */
    {
      id: "github",
      stage: "engineering",
      speaker: "assistant",
      walkTalk: (a) => [story.lines.toEngineering(short(a.name))],
      say: (a) => [story.lines.github(short(a.name))],
      ask: { kind: "github" },
      card: "github",
      // the story keeps the code in MADP Factory; GitHub is the visitor's own choice, connected for real
      scripted: "factory",
      apply: (a, v) => codeAnswer(a, String(v)),
    },
    {
      id: "env",
      stage: "engineering",
      speaker: "assistant",
      say: (a) => [
        a.code === "github"
          ? t("studio.cinematic.script.repoOnStart", "Connected. I'll create the private repository {repo} for you when we start.", { repo: a.repo })
          : t("studio.cinematic.script.factoryKeeps", "Done. MADP Factory keeps the code of {name} safe, and you can connect GitHub any time later.", { name: short(a.name) || t("studio.cinematic.script.yourProduct", "your product") }),
        story.lines.env,
      ],
      ask: { kind: "chips", get chips() { return [env.preview(), env.stage(), env.live()]; } },
      get scripted() { return env.preview(); },
      apply: (_a, v) => ({ env: String(v) }),
    },
    /* Build floor */
    {
      id: "launch",
      stage: "buildfloor",
      speaker: "assistant",
      walkTalk: () => [t("studio.cinematic.script.letMeShow", "Perfect. Let me show you where it gets built.")],
      say: (a) => [t("studio.cinematic.script.storyStartBuilding", "This is the build floor. Your team is ready. Shall we start building {name}?", { name: short(a.name) || t("studio.cinematic.script.it", "it") })],
      ask: { kind: "confirm", get chips() { return [startBuilding()]; } },
      get scripted() { return startBuilding(); },
    },
  ];
}

/** "Good morning" / "Good afternoon" / "Good evening" by the visitor's own clock. */
export function greeting(now: Date = new Date()): string {
  const h = now.getHours();
  return h < 12 ? t("studio.cinematic.script.goodMorning", "Good morning")
    : h < 18 ? t("studio.cinematic.script.goodAfternoon", "Good afternoon")
    : t("studio.cinematic.script.goodEvening", "Good evening");
}

/** The real office: every answer is the person's own and is saved to their project as it is given (the store and
 *  real.ts do the saving; nothing here is canned content). Every text is read when it is shown (the language can change). */
export function buildRealScript(opts: { checkName: (v: string) => string | null; checkWebsite: (v: string) => string | null }): Node[] {
  const named = (a: Answers) => short(a.name) || a.name.trim() || t("studio.cinematic.script.yourProject", "your project");
  return [
    /* Reception: they are signed in, so the guide knows their name */
    {
      id: "name",
      stage: "reception",
      speaker: "assistant",
      say: (a) => [
        first(a.visitor)
          ? t("studio.cinematic.script.welcomeNamed", "{greeting}, {name}. Welcome to SELISE, I'm the MADP Assistant.", { greeting: greeting(), name: first(a.visitor) })
          : t("studio.cinematic.script.welcome", "{greeting}. Welcome to SELISE, I'm the MADP Assistant.", { greeting: greeting() }),
        t("studio.cinematic.script.askName", "What are we building today? Give it a name."),
      ],
      ask: { kind: "text", get placeholder() { return t("studio.cinematic.script.projectName", "The project's name"); }, maxLength: 80 },
      scripted: "",
      check: opts.checkName,
      apply: (_a, v) => ({ name: String(v).trim() }),
    },
    /* Meeting room: one discovery conversation */
    {
      id: "about",
      stage: "meeting",
      speaker: "assistant",
      walkTalk: (a) => [
        t("studio.cinematic.script.toMeeting", "{name}. Come with me, the meeting room is just over here.", { name: named(a) }),
        t("studio.cinematic.script.haveASeat", "Have a seat. I'll put our notes up on the screen as we talk."),
      ],
      say: () => [t("studio.cinematic.script.askAbout", "Tell me what it's about. Who has the problem today, and what should change?")],
      ask: { kind: "text", get placeholder() { return t("studio.cinematic.script.ownWords", "In your own words. A few sentences are plenty"); }, multiline: true, maxLength: LIMITS.description },
      scripted: "",
      check: (v) => (v.trim().length < 3 ? t("studio.cinematic.script.tellMore", "Tell me a little more, a sentence or two is enough.") : null),
      apply: (_a, v) => ({ about: String(v).trim() }),
    },
    {
      id: "website",
      stage: "meeting",
      speaker: "assistant",
      say: () => [t("studio.cinematic.script.askWebsite", "Thank you. Do you already have a website?")],
      ask: {
        kind: "chips",
        get chips() { return [notYet()]; },
        freeText: true,
        get placeholder() { return t("studio.cinematic.script.pasteAddress", "Paste the address (optional)"); },
        maxLength: LIMITS.website,
      },
      get scripted() { return notYet(); },
      check: (v) => (isNotYet(v) ? null : opts.checkWebsite(v)),
      apply: () => ({}),
    },
    {
      id: "audience",
      stage: "meeting",
      speaker: "assistant",
      say: (a) => [a.website
        ? t("studio.cinematic.script.notedWho", "Thanks, I've noted it. Who will use the app?")
        : t("studio.cinematic.script.noProblemWho", "No problem. Who will use the app?")],
      ask: { kind: "chips", chips: [...USER_CHIPS], chipMode: "add", freeText: true, multiline: true, get placeholder() { return t("studio.cinematic.script.pickOrDescribe", "Pick above, or describe them"); }, maxLength: LIMITS.users },
      scripted: "",
      apply: (_a, v) => ({ audience: String(v).trim() }),
    },
    {
      id: "goal",
      stage: "meeting",
      speaker: "assistant",
      say: () => [t("studio.cinematic.script.askGoal", "And what matters most to you? What should it achieve?")],
      ask: { kind: "chips", chips: [...GOAL_CHIPS], chipMode: "add", freeText: true, multiline: true, get placeholder() { return t("studio.cinematic.script.pickOrSay", "Pick above, or say it in your words"); }, maxLength: LIMITS.goal },
      scripted: "",
      apply: (_a, v) => ({ goal: String(v).trim() }),
    },
    {
      id: "files",
      stage: "meeting",
      speaker: "assistant",
      say: () => [t("studio.cinematic.script.askFiles", "Do you have any files for us? Briefs, notes, lists. Just drop them here.")],
      ask: { kind: "files" },
      card: "files",
      scripted: [],
    },
    {
      id: "summary",
      stage: "meeting",
      speaker: "pm",
      pmJoins: true,
      say: (a) => [
        first(a.visitor)
          ? t("studio.cinematic.script.analystHello", "Hello {name}, I'm your business analyst. I've been following along.", { name: first(a.visitor) })
          : t("studio.cinematic.script.analystHelloAnon", "Hello, I'm your business analyst. I've been following along."),
        t("studio.cinematic.script.toldUs", "Here's what you told us about {name}.", { name: named(a) }),
      ],
      card: "summary",
      scripted: "",
    },
    /* Engineering */
    {
      id: "github",
      stage: "engineering",
      speaker: "assistant",
      walkTalk: () => [t("studio.cinematic.script.toEngineering", "Now let's set up where your code will live. Engineering is right next door.")],
      say: () => [t("studio.cinematic.script.codeHome", "This is where your software will live. MADP Factory keeps the code safe for you, or you can connect your own GitHub.")],
      ask: { kind: "github" },
      card: "github",
      scripted: "factory",
      apply: (a, v) => codeAnswer(a, String(v)),
    },
    /* Build floor */
    {
      id: "launch",
      stage: "buildfloor",
      speaker: "assistant",
      walkTalk: () => [t("studio.cinematic.script.letMeShow", "Perfect. Let me show you where it gets built.")],
      say: (a) => [
        t("studio.cinematic.script.teamReady", "This is the build floor. Your team is ready for {name}.", { name: named(a) }),
        t("studio.cinematic.script.startAnalysis", "We start with the analysis of everything you shared. I'll take you to Project setup."),
      ],
      ask: { kind: "confirm", get chips() { return [letsGo()]; } },
      get scripted() { return letsGo(); },
    },
  ];
}
