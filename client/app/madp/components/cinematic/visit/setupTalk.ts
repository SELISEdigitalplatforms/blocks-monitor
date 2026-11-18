/** Project Setup in the office: the MADP Assistant asks the guided start's questions in the dialog's order (what kind of
 *  product, its name, its description, a live product's website, where the code lives, create), then the Project setup
 *  page's two last items (Material, Start project analysis). It is a conversation, not a form: any real answer is
 *  taken as it is (short answers are answers), "later" / "not sure" set a question aside and the conversation moves on,
 *  "yes" / "ok" confirm where something is to be confirmed, and nothing is ever refused in a loop. The writes are the
 *  app's own ops (`SetupOps`, wired by useSetupOps): project.create with the guided start's arguments, the Share
 *  window's upload pipeline into "Client documents", business.handOver.
 *  No React here: the ops and the stores are passed in (unit-tested with fake ops). */
import { t } from "@/madp/i18n";
import { checkWebsite, codeHomeOf, LIMITS, suggestedRepoName, validateStep, type StartAnswers } from "@/madp/domain/guidedStart";
import { PROJECT_NAME_MAX } from "@/madp/domain/projects";
import { greeting } from "../journey/script";
import type { ComposerSpec, Reply, Who } from "./chat";
import type { SetupAsk, SetupDraft } from "./flow";
import { ackFor, quotable } from "./acks";
import { intentOf } from "./intent";
import type { UploadRow } from "./store";

/** The writes Project Setup makes (the app's own ops behind them). */
export interface SetupOps {
  /** project.create with the guided start's arguments (toCreateArgs); answers the new project's id */
  create: (answers: StartAnswers, githubLogin: string | null, requestId: string) => Promise<string>;
  /** the Share window's pipeline into "Client documents"; each file's progress through `onRow` */
  upload: (projectId: string, files: File[], onRow: (index: number, row: Partial<UploadRow>) => void) => Promise<{ filed: number; failed: { name: string; message: string }[] }>;
  /** business.handOver (a hand-over that already happened counts as done), then the brief is built, as the Start project
   *  analysis window does */
  handOver: (projectId: string) => Promise<void>;
  newRequestId: () => string;
  /** a failed op in plain words (the app's messageFor) */
  message: (e: unknown) => string;
  /** opens the file chooser (a typed "yes" to "do you have files?") */
  pickFiles?: () => void;
}

/** The two stores the talk writes to (the zustand stores in the app, plain objects in the tests). */
export interface SetupDeps {
  ops: SetupOps;
  chat: { say: (who: Who, text: string, o?: { key?: string; tone?: "error" }) => Promise<void>; you: (text: string) => void; whileBusy: <T>(who: Who, label: string | null, work: () => Promise<T>) => Promise<T> };
  visit: {
    get: () => { draft: SetupDraft; projectId: string | null; createRequest: string | null };
    setDraft: (patch: Partial<StartAnswers>, flags?: Partial<Omit<SetupDraft, "answers">>) => void;
    setProject: (id: string) => void;
    setCreateRequest: (id: string | null) => void;
    passMaterial: () => void;
    setUploads: (rows: UploadRow[] | ((rows: UploadRow[]) => UploadRow[])) => void;
    openWhere: (open: boolean) => void;
  };
  githubLogin: string | null;
}

const A: Who = "assistant";
const first = (s: string) => s.trim().split(/\s+/)[0] ?? "";
/** characters a project name may not hold (the server's own rule: control and direction characters) */
const UNSAFE = /[\u0000-\u001F\u007F‪-‮⁦-⁩]/g;

/** What the assistant says and offers at a step (the input's callbacks are added by the component). */
export interface SetupPrompt {
  /** said once per visit and step */
  key: string;
  lines: string[];
  composer: Omit<ComposerSpec, "onReply" | "onSend" | "onFiles">;
  files?: boolean;
}

/** Where the code lives, in words. */
export function whereWords(a: StartAnswers, login: string | null): string {
  if (a.kind === "existing") return a.appUrl.trim() ? t("studio.office.visit.where.liveAt", "It runs at {url}", { url: a.appUrl.trim() }) : t("studio.office.visit.setup.liveDetails", "The live product's details");
  const home = codeHomeOf(a);
  if (home === "factory") return t("studio.office.visit.setup.inFactory", "the code kept in MADP Factory");
  if (home === "create") return t("studio.office.visit.setup.inNewRepo", "a new private repository, {repo}", { repo: `${login ?? "GitHub"}/${suggestedRepoName(a)}` });
  return a.repo ? t("studio.office.visit.setup.inRepo", "the code in {repo}", { repo: `${a.repo.owner}/${a.repo.name}` }) : t("studio.office.visit.setup.inFactory", "the code kept in MADP Factory");
}

export function setupPrompt(ask: SetupAsk, c: {
  draft: SetupDraft; visitor: string; projectName: string; handOverBlocked: string | null; resumed: boolean;
  /** the product is live already (the draft's kind, or the project's type) */
  existing: boolean;
  githubLogin?: string | null;
}): SetupPrompt {
  const a = c.draft.answers;
  const name = a.name.trim() || c.projectName;
  const field = (o: Partial<ComposerSpec> = {}): SetupPrompt["composer"] => ({ mode: "text", label: t("studio.office.visit.composer.label", "Your answer"), ...o });
  switch (ask) {
    case "kind":
      return {
        key: "setup:kind",
        lines: [
          t("studio.office.visit.setup.hello", "{greeting}{name}. Welcome to SELISE, I'm the MADP Assistant.", { greeting: greeting(), name: first(c.visitor) ? `, ${first(c.visitor)}` : "" }),
          t("studio.office.visit.setup.kindAsk", "What are we working on: a new product, or one you already have?"),
        ],
        composer: field({
          label: t("studio.office.visit.setup.kindLabel", "What kind of product"),
          replies: [
            { id: "new", label: t("studio.office.visit.setup.kindNew", "A new product") },
            { id: "existing", label: t("studio.office.visit.setup.kindExisting", "One I already have") },
          ],
        }),
      };
    case "name":
      return {
        key: "setup:name",
        lines: [a.kind === "existing" ? t("studio.office.visit.setup.nameAskExisting", "What is the product called?") : t("studio.office.visit.setup.nameAsk", "Lovely. What should we call it?")],
        composer: field({ label: t("studio.office.visit.setup.nameLabel", "The project's name"), placeholder: t("studio.office.visit.setup.namePlaceholder", "The project's name"), maxLength: 200 }),
      };
    case "description":
      return {
        key: "setup:description",
        lines: [a.kind === "existing"
          ? t("studio.office.visit.setup.aboutAskExisting", "Tell me about {name} in a sentence or two: what it does today, and what should change.", { name })
          : t("studio.office.visit.setup.aboutAsk", "Tell me about {name} in a sentence or two: who has the problem today, and what should change?", { name })],
        composer: field({ label: t("studio.office.visit.setup.aboutLabel", "About the project"), placeholder: t("studio.office.visit.setup.aboutPlaceholder", "In your own words"), multiline: true, maxLength: LIMITS.description }),
      };
    case "website":
      return {
        key: "setup:website",
        lines: [t("studio.office.visit.setup.websiteAsk", "Does {name} have a website? Paste the address, or tell me there is none.", { name })],
        composer: field({
          label: t("studio.office.visit.setup.websiteLabel", "The website"), placeholder: t("studio.office.visit.setup.websitePlaceholder", "www.example.com"), maxLength: LIMITS.website,
          replies: [{ id: "none", label: t("studio.office.visit.setup.websiteNone", "No website") }],
        }),
      };
    case "where":
      return c.existing ? {
        key: "setup:where:existing",
        lines: [t("studio.office.visit.setup.whereAskExisting", "Where does {name} live today? A few details help your team find it: its address, a test version and its code.", { name })],
        composer: field({ label: t("studio.office.visit.setup.whereLabel", "Where it lives"), replies: [{ id: "details", label: t("studio.office.visit.setup.whereDetails", "Fill in the details"), primary: true }] }),
      } : {
        key: "setup:where",
        lines: [t("studio.office.visit.setup.whereAsk", "Where should we keep the code? MADP Factory keeps it safe for you, with nothing to set up. You can also connect GitHub, now or any time later.")],
        composer: field({
          label: t("studio.office.visit.setup.whereLabel", "Where it lives"),
          replies: [
            { id: "factory", label: t("studio.office.visit.setup.whereFactory", "Keep it in MADP Factory"), primary: true },
            { id: "github", label: t("studio.office.visit.setup.whereGithub", "Connect GitHub") },
          ],
        }),
      };
    case "ready":
      return {
        key: "setup:ready",
        lines: [t("studio.office.visit.setup.readyAskWith", "Shall I create {name}, with {where}?", { name, where: whereWords(a, c.githubLogin ?? null) })],
        composer: field({
          label: t("studio.office.visit.setup.readyLabel", "Create the project"),
          replies: [
            { id: "create", label: t("studio.office.visit.setup.create", "Create the project"), primary: true },
            { id: "edit:name", label: t("studio.office.visit.setup.changeName", "Change the name"), quiet: true },
            { id: "edit:description", label: t("studio.office.visit.setup.changeAbout", "Change the description"), quiet: true },
            { id: "edit:where", label: t("studio.office.visit.setup.changeWhere", "Change where it lives"), quiet: true },
          ],
        }),
      };
    case "material":
      return {
        key: "setup:material",
        lines: [
          c.resumed ? t("studio.office.visit.setup.welcomeBack", "Welcome back. We are setting up {name}.", { name }) : t("studio.office.visit.setup.created", "{name} is created, and it's yours.", { name }),
          t("studio.office.visit.setup.materialAsk", "Do you have documents for us? Briefs, notes, lists, anything that explains the work. Drop them here or attach them."),
        ],
        files: true,
        composer: field({
          label: t("studio.office.visit.setup.materialLabel", "Material"),
          replies: [
            { id: "attach", label: t("studio.office.visit.setup.attach", "Attach files"), primary: true },
            { id: "none", label: t("studio.office.visit.setup.noFiles", "No files for now") },
          ],
        }),
      };
    case "handOver":
      return {
        key: "setup:handOver",
        lines: [
          ...(c.resumed ? [t("studio.office.visit.setup.welcomeBack", "Welcome back. We are setting up {name}.", { name })] : []),
          c.existing
            ? t("studio.office.visit.setup.handOverAskExisting", "Ready to start the analysis? Your business analyst reads your material and the product's code, then comes back with questions and a first picture of the change.")
            : t("studio.office.visit.setup.handOverAsk", "Ready to start the analysis? Your business analyst reads everything you shared, then comes back with questions and a first picture of what to build."),
          ...(c.handOverBlocked ? [c.handOverBlocked] : []),
        ],
        files: true,
        composer: field({
          label: t("studio.office.visit.setup.handOverLabel", "Start project analysis"),
          replies: [
            { id: "start", label: t("studio.office.visit.setup.handOver", "Start project analysis"), primary: true, disabled: Boolean(c.handOverBlocked) },
            { id: "attach", label: t("studio.office.visit.setup.attachMore", "Add files first"), quiet: true },
          ],
        }),
      };
  }
}

/** What the person's choice reads as in the conversation. */
function replyText(id: string, prompt: SetupPrompt): string {
  return (prompt.composer.replies ?? []).find((r: Reply) => r.id === id)?.label ?? id;
}

/** "a new one" / "we already have it live" / "neu" / "bestehend": the kind a typed answer names (null: not clear). */
export function kindOf(text: string): "new" | "existing" | null {
  if (/\b(exist\w*|already|live|have (one|it)|running|current|bestehend\w*|vorhanden|schon|läuft|laeuft|bisherig\w*)\b/i.test(text)) return "existing";
  if (/\b(new|idea|scratch|start(ing)? fresh|neu\w*|idee)\b/i.test(text)) return "new";
  return null;
}

/** One answer to the step `ask`: `text` for typed words, `reply` for a choice, `files` for attached files. Real answers
 *  are taken as they are; the app's hard limits (a name of 80 characters, a web address) are applied and said once,
 *  never asked again. */
export async function answerSetup(ask: SetupAsk, input: { text?: string; reply?: string; files?: File[] }, prompt: SetupPrompt, d: SetupDeps): Promise<void> {
  const { chat, visit, ops } = d;
  const text = (input.text ?? "").trim();
  const shown = input.reply ? replyText(input.reply, prompt) : text;
  const intent = input.reply ? null : intentOf(text);
  const projectId = visit.get().projectId;
  if (!input.reply && !text && !input.files?.length) return;

  switch (ask) {
    case "kind": {
      const kind = input.reply === "new" || input.reply === "existing" ? input.reply : kindOf(text) ?? "new";
      chat.you(shown);
      if (!input.reply && !kindOf(text)) {
        await chat.say(A, t("studio.office.visit.setup.kindAssumed", "Then I'll start it as a new product."));
      }
      visit.setDraft({ kind }, { websiteDone: false, whereDone: false, aboutDone: false });
      return;
    }
    case "name": {
      chat.you(text);
      if (intent === "later" || intent === "notSure" || intent === "no") {
        // a name is needed to open the project: a working title, renamed any time
        const working = t("studio.office.visit.setup.workingTitle", "New project");
        visit.setDraft({ name: working });
        await chat.say(A, t("studio.office.visit.setup.workingTitleSaid", "Then I'll call it “{name}” for now. You can rename it any time.", { name: working }));
        return;
      }
      let name = text.replace(UNSAFE, "").trim();
      if (name.length > PROJECT_NAME_MAX) {
        name = name.slice(0, PROJECT_NAME_MAX).trim();
        await chat.say(A, t("studio.office.visit.setup.nameShortened", "I've kept the first {max} characters: “{name}”.", { max: PROJECT_NAME_MAX, name }));
      } else {
        void chat.say(A, ackFor("name", name));
      }
      visit.setDraft({ name });
      return;
    }
    case "description": {
      chat.you(text);
      if (intent === "later" || intent === "notSure" || intent === "no") {
        void chat.say(A, ackFor("later"));
        visit.setDraft({ description: "" }, { aboutDone: true });
        return;
      }
      void chat.say(A, ackFor("about", text));
      visit.setDraft({ description: text.slice(0, LIMITS.description) }, { aboutDone: true });
      return;
    }
    case "website": {
      chat.you(shown);
      if (input.reply === "none" || intent) {
        visit.setDraft({ website: "" }, { websiteDone: true });
        return;
      }
      const w = checkWebsite(text);
      if (w.ok) {
        void chat.say(A, ackFor("answer", w.value.replace(/^https?:\/\//i, "").replace(/\/$/, "")));
        visit.setDraft({ website: w.value }, { websiteDone: true });
      } else {
        // not an address: noted without it (no second asking); it can be added in Project setup
        await chat.say(A, t("studio.office.visit.setup.websiteSkipped", "I couldn't read that as a web address, so I've left the website out. You can add it in Project setup."));
        visit.setDraft({ website: "" }, { websiteDone: true });
      }
      return;
    }
    case "where": {
      const github = input.reply === "github" || (!input.reply && /\bgit\s*hub\b/i.test(text));
      const details = input.reply === "details" || (!input.reply && d.visit.get().draft.answers.kind === "existing");
      if (github || details) {
        if (!input.reply) chat.you(text);
        // GitHub, or a live product's details: the guided start's own step, in a window over the office
        visit.openWhere(true);
        return;
      }
      chat.you(shown);
      visit.setDraft({ repoChoice: "factory", repo: null }, { whereDone: true });
      await chat.say(A, t("studio.office.visit.setup.factoryOk", "Done. MADP Factory keeps the code safe, and you can connect GitHub any time later."));
      return;
    }
    case "ready": {
      const edit = input.reply?.startsWith("edit:") ? input.reply.slice(5)
        : !input.reply && /\b(name|call|nennen|name\w*)\b/i.test(text) ? "name"
        : !input.reply && /\b(description|about|beschreib\w*)\b/i.test(text) ? "description"
        : !input.reply && /\b(code|github|repo\w*|factory)\b/i.test(text) ? "where"
        : null;
      if (edit) {
        chat.you(shown);
        // changed answers are a new request (as in the New project dialog)
        visit.setCreateRequest(null);
        if (edit === "name") visit.setDraft({ name: "" });
        else if (edit === "description") visit.setDraft({ description: "" }, { aboutDone: false });
        else visit.setDraft({}, { whereDone: false });
        return;
      }
      if (input.reply !== "create" && intent !== "yes") {
        chat.you(shown);
        await chat.say(A, intent === "no" ? t("studio.office.visit.setup.whatToChange", "What should I change: the name, the description or where the code lives?")
          : t("studio.office.visit.setup.createAsIs", "Shall I create it as it is? Say yes, or tell me what to change."));
        return;
      }
      chat.you(shown);
      // every step must still hold (GitHub can have been disconnected meanwhile): back to the one that does not
      const answers = visit.get().draft.answers;
      if (Object.keys(validateStep("where", answers, d.githubLogin)).length) {
        visit.setDraft({}, { whereDone: false });
        await chat.say(A, t("studio.office.visit.setup.whereAgain", "Let's look at where the code lives once more: GitHub needs to be connected for that choice."), { tone: "error" });
        return;
      }
      const requestId = visit.get().createRequest ?? ops.newRequestId();
      visit.setCreateRequest(requestId);
      try {
        const id = await chat.whileBusy(A, t("studio.office.visit.setup.creating", "Creating your project"), () => ops.create(answers, d.githubLogin, requestId));
        visit.setCreateRequest(null);
        visit.setProject(id);
      } catch (e) {
        await chat.say(A, t("studio.office.visit.setup.createFailedSayYes", "The project could not be created yet. {reason} Say yes to try again; it is never created twice.", { reason: ops.message(e) }), { tone: "error" });
      }
      return;
    }
    case "material":
    case "handOver": {
      if (!projectId) return;
      if (input.files?.length) { await share(projectId, input.files, d); return; }
      if (input.reply === "attach") { ops.pickFiles?.(); return; }
      if (input.reply === "start" || (ask === "handOver" && intent === "yes")) {
        chat.you(shown);
        try {
          await chat.whileBusy(A, t("studio.office.visit.setup.handingOver", "Handing over to your business analyst"), () => ops.handOver(projectId));
        } catch (e) {
          await chat.say(A, t("studio.office.visit.setup.handOverFailed", "The analysis could not be started. {reason}", { reason: ops.message(e) }), { tone: "error" });
        }
        return;
      }
      if (ask === "material" && intent === "yes") { chat.you(text); ops.pickFiles?.(); return; }
      chat.you(shown);
      if (ask === "handOver") {
        await chat.say(A, t("studio.office.visit.setup.whenReady", "Fine. Whenever you're ready, just say so."));
        return;
      }
      // "no files", "later", or anything else: no files for now, and on
      visit.passMaterial();
      await chat.say(A, t("studio.office.visit.setup.noFilesOk", "No problem. You can add files any time in Project setup, also after the analysis has started."));
      return;
    }
  }
}

/** Files given at reception: uploaded one after the other into "Client documents"; the assistant says only what
 *  really happened. */
async function share(projectId: string, files: File[], d: SetupDeps): Promise<void> {
  const { chat, visit, ops } = d;
  chat.you(files.length === 1 ? files[0].name : t("studio.office.visit.setup.filesYou", "{n} files: {names}", { n: files.length, names: files.map((f) => f.name).join(", ") }));
  visit.setUploads(files.map((f) => ({ name: f.name, phase: "queued" })));
  let out: { filed: number; failed: { name: string; message: string }[] };
  try {
    out = await chat.whileBusy(A, t("studio.office.visit.setup.filing", "Filing your documents"), () => ops.upload(projectId, files, (i, row) => visit.setUploads((rows) => rows.map((r, k) => (k === i ? { ...r, ...row } : r)))));
  } catch (e) {
    const message = ops.message(e);
    visit.setUploads((rows) => rows.map((r) => (r.phase === "done" ? r : { ...r, phase: "failed", message })));
    out = { filed: 0, failed: files.map((f) => ({ name: f.name, message })) };
  }
  if (out.filed === 0) {
    await chat.say(A, t("studio.office.visit.setup.filesNone", "Those didn't upload. {reason} Try again, or go on without files for now.", { reason: out.failed[0]?.message ?? "" }), { tone: "error" });
    return;
  }
  visit.passMaterial();
  const q = files.length === 1 ? quotable(files[0].name) : null;
  if (out.failed.length === 0) {
    await chat.say(A, files.length === 1
      ? (q ? t("studio.office.visit.setup.fileFiled", "Got it. {name} is filed in your project's Client documents.", { name: q }) : t("studio.office.visit.setup.oneFiled", "Got it, it's filed in your project's Client documents."))
      : t("studio.office.visit.setup.filesFiled", "Got them. All {n} are filed in your project's Client documents.", { n: out.filed }));
  } else {
    await chat.say(A, t("studio.office.visit.setup.filesSome", "{filed} of {total} are filed. {names} couldn't be uploaded: {reason} You can add them again in Project setup.", {
      filed: out.filed, total: files.length, names: out.failed.map((f) => f.name).join(", "), reason: out.failed[0].message,
    }), { tone: "error" });
  }
}
