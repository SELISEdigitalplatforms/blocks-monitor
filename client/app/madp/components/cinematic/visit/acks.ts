/** Short acknowledgements that answer what the person actually said ("Global users, noted."), varied, never the same
 *  words twice in a row: no scripted "Thank you." after everything. The person's words are quoted back when they are
 *  short enough to say; a long answer gets a short word of its own. Texts through t() (read when said). */
import { t } from "@/madp/i18n";

export type AckKind = "answer" | "about" | "goal" | "users" | "later" | "notSure" | "confirm" | "name";

/** the longest answer quoted back word for word */
const QUOTE_MAX = 44;

/** The person's words as they can be said back: trimmed, without closing punctuation; null when too long to quote. */
export function quotable(said: string): string | null {
  const q = said.trim().replace(/\s+/g, " ").replace(/[.!?…,;:]+$/, "");
  if (!q || q.length > QUOTE_MAX || q.includes("\n")) return null;
  return q;
}

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

function templates(kind: AckKind, q: string | null): string[] {
  const Q = q ? cap(q) : "";
  switch (kind) {
    case "goal":
      return q ? [
        t("studio.office.visit.ack.goal1", "So the goal is: {q}. Clear.", { q }),
        t("studio.office.visit.ack.goal2", "{Q}: that's what it's for, then.", { Q }),
      ] : [t("studio.office.visit.ack.goalLong", "That's a clear goal.")];
    case "users":
      return q ? [
        t("studio.office.visit.ack.users1", "{Q}, so that's who it's for.", { Q }),
        t("studio.office.visit.ack.users2", "Built for {q}. Noted.", { q }),
      ] : [t("studio.office.visit.ack.usersLong", "Now I know who it's for.")];
    case "about":
      // a description is a few sentences: never said back word for word
      return [
        t("studio.office.visit.ack.about1", "Clear, I get the picture."),
        t("studio.office.visit.ack.about2", "Good, that tells me what it's about."),
        t("studio.office.visit.ack.about3", "That's a clear start."),
      ];
    case "name":
      return q ? [t("studio.office.visit.ack.name", "{Q}. Nice name.", { Q })] : [t("studio.office.visit.ack.nameLong", "Nice name.")];
    case "later":
      return [
        t("studio.office.visit.ack.later1", "Fine, we'll come back to it."),
        t("studio.office.visit.ack.later2", "Sure, let's leave that for later."),
        t("studio.office.visit.ack.later3", "No problem, later then."),
      ];
    case "notSure":
      return [
        t("studio.office.visit.ack.notSure1", "That's fine, I'll suggest an answer for you to check."),
        t("studio.office.visit.ack.notSure2", "No problem, I'll propose something you can check."),
      ];
    case "confirm":
      return [t("studio.office.visit.ack.confirm1", "Good."), t("studio.office.visit.ack.confirm2", "Great, done."), t("studio.office.visit.ack.confirm3", "Perfect.")];
    case "answer":
    default:
      return q ? [
        t("studio.office.visit.ack.answer1", "{Q}, noted.", { Q }),
        t("studio.office.visit.ack.answer2", "Got it: {q}.", { q }),
        t("studio.office.visit.ack.answer3", "{Q}. That helps.", { Q }),
        t("studio.office.visit.ack.answer4", "Okay, {q}.", { q }),
      ] : [
        t("studio.office.visit.ack.long1", "That helps a lot."),
        t("studio.office.visit.ack.long2", "Clear, I'll work with that."),
        t("studio.office.visit.ack.long3", "Good, that settles it."),
      ];
  }
}

let last = "";
let turn = 0;

/** A short acknowledgement of what the person said, never the same words as the last one. */
export function ackFor(kind: AckKind, said = ""): string {
  const list = templates(kind, quotable(said));
  turn++;
  for (let i = 0; i < list.length; i++) {
    const pick = list[(turn + i) % list.length];
    if (pick !== last) { last = pick; return pick; }
  }
  last = list[0];
  return list[0];
}

/** Tests only: start the rotation again. */
export function resetAcks(): void {
  last = "";
  turn = 0;
}
