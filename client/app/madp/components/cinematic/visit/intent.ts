/** What a short reply means when it is not an answer in itself, in English and German: "later" / "skip" (set it aside),
 *  "not sure" / "don't know" (the app's "Not sure" path), "yes" / "ok" (a confirmation, where one is asked), "no".
 *  Only a reply that is nothing but such words counts ("later" does; "later this year we launch" is an answer). Pure. */

export type Intent = "later" | "notSure" | "yes" | "no";

const norm = (s: string) => s.trim().toLowerCase().replace(/[’`]/g, "'").replace(/[.!?,;:…]+/g, " ").replace(/\s+/g, " ").trim();

const WORDS: Record<Intent, readonly string[]> = {
  later: [
    "later", "skip", "skip it", "skip this", "skip that", "next", "pass", "not now", "maybe later", "later please", "come back later",
    "let's skip", "move on", "next one", "next question",
    "später", "spaeter", "überspringen", "ueberspringen", "nicht jetzt", "weiter", "nächste", "naechste", "nächste frage", "vielleicht später",
  ],
  notSure: [
    "not sure", "i'm not sure", "im not sure", "i am not sure", "unsure", "don't know", "dont know", "i don't know", "i dont know", "no idea",
    "no clue", "dunno", "idk", "not yet sure", "hard to say", "you decide", "suggest something", "suggest an answer",
    "weiss nicht", "weiß nicht", "ich weiss nicht", "ich weiß nicht", "keine ahnung", "nicht sicher", "unsicher", "bin nicht sicher",
    "ich bin nicht sicher", "schwer zu sagen", "schlagen sie etwas vor",
  ],
  yes: [
    "yes", "y", "yeah", "yep", "yup", "ok", "okay", "k", "sure", "fine", "right", "correct", "that's right", "thats right", "looks good",
    "sounds good", "go", "go ahead", "do it", "confirm", "confirmed", "agreed", "perfect", "great", "good", "all good", "yes please",
    "ja", "jawohl", "genau", "passt", "stimmt", "richtig", "gut", "einverstanden", "bestätigen", "bestaetigen", "los", "mach", "machen sie",
  ],
  no: ["no", "n", "nope", "not really", "no thanks", "nein", "nö", "noe", "eher nicht", "nicht wirklich"],
};

const LOOKUP = new Map<string, Intent>();
for (const [intent, words] of Object.entries(WORDS) as [Intent, readonly string[]][]) for (const w of words) LOOKUP.set(norm(w), intent);

/** The intent of a reply that consists only of such words, else null (it is an answer). */
export function intentOf(text: string): Intent | null {
  const t = norm(text);
  if (!t || t.split(" ").length > 5) return null;
  return LOOKUP.get(t) ?? LOOKUP.get(t.replace(/^(um|uh|hmm|well|so|also|naja|hm)\s+/, "")) ?? LOOKUP.get(t.replace(/\s+(please|bitte|thanks|danke)$/, "")) ?? null;
}

/** Defer-like intents: the app's "Later" and "Not sure". */
export const isAside = (i: Intent | null): i is "later" | "notSure" => i === "later" || i === "notSure";
