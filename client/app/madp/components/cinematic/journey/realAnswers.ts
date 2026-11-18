/** The real office's answers, pure (no network): the guided start's answers of a new product, the project.create
 *  arguments, and the website as the person typed it. The ops themselves are in real.ts. */
import { EMPTY_ANSWERS, checkWebsite, toCreateArgs, type StartAnswers } from "@/madp/domain/guidedStart";

/** What the person told the office, as the guided start's answers of a new product. */
export interface RealAnswers { name: string; about: string; audience: string; goal: string; githubLogin?: string | null }

export function startAnswersOf(a: RealAnswers): StartAnswers {
  return { ...EMPTY_ANSWERS, kind: "new", name: a.name.trim(), description: a.about.trim(), users: a.audience.trim(), goal: a.goal.trim(), repoChoice: "factory" };
}

/** The project.create arguments: the name and the idea; MADP Factory keeps the code (GitHub can be connected later). */
export function createArgsFor(a: RealAnswers) {
  return toCreateArgs(startAnswersOf(a), null);
}

/** A typed website: its https address, "" for none, or null when it is not a web address. */
export function websiteOf(raw: string): string | null {
  const w = checkWebsite(raw);
  return w.ok ? w.value : null;
}

/** "https://www.example.com/" → "www.example.com" (the address as people say it). */
export function websiteLabel(url: string): string {
  return url.replace(/^https?:\/\//i, "").replace(/\/$/, "");
}

/** The website as a note of the project's material. */
export const WEBSITE_NOTE_TITLE = "Website";
export function websiteNoteBody(url: string): string {
  return `Our website: ${url}`;
}

