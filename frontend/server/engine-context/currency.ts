// The project's own currency, read from its material (the brief, the notes, the files' text, the answers): the one
// named most often, with an explicit "Currency: EUR" line winning outright. Never a default of the engine's home
// region: when the material names no currency the generated content stays neutral (plain amounts). Pure.

export interface Currency {
  code: string;
  /** How an amount is written in the generated screens and text: "€24.00", "CHF 24.00". */
  format(amount: number): string;
}

interface Known { code: string; symbol: string | null; words: RegExp }

const KNOWN: Known[] = [
  { code: "EUR", symbol: "€", words: /€\s?\d|\d\s?€|\bEUR\b|\beuros?\b/gi },
  { code: "USD", symbol: "$", words: /(?<![A-Za-z])(?:US)?\$\s?\d|\bUSD\b|\bUS dollars?\b/gi },
  { code: "GBP", symbol: "£", words: /£\s?\d|\bGBP\b|\bpounds? sterling\b/gi },
  { code: "CHF", symbol: null, words: /\bCHF\b|\bSwiss francs?\b|\bFr\.\s?\d/gi },
  { code: "INR", symbol: "₹", words: /₹\s?\d|\bINR\b|\brupees?\b/gi },
  { code: "BDT", symbol: "৳", words: /৳\s?\d|\bBDT\b|\btaka\b/gi },
  { code: "JPY", symbol: "¥", words: /\bJPY\b|\byen\b/gi },
  { code: "AUD", symbol: "A$", words: /\bAUD\b|\bA\$\s?\d/gi },
  { code: "CAD", symbol: "C$", words: /\bCAD\b|\bC\$\s?\d/gi },
  { code: "SEK", symbol: null, words: /\bSEK\b/gi },
  { code: "NOK", symbol: null, words: /\bNOK\b/gi },
  { code: "DKK", symbol: null, words: /\bDKK\b/gi },
  { code: "PLN", symbol: null, words: /\bPLN\b|\bzłoty\b/gi },
  { code: "AED", symbol: null, words: /\bAED\b|\bdirhams?\b/gi },
  { code: "SGD", symbol: "S$", words: /\bSGD\b/gi },
];

/** "Currency: EUR at launch", "currency EUR", "prices in EUR": the material saying which one outright. */
const STATED = /\b[Cc]urrenc(?:y|ies)\b[^.\n]{0,24}?\b([A-Z]{3})\b|\b[Pp]rices? (?:are )?in ([A-Z]{3})\b/g;

const twoDecimals = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function currencyOfCode(code: string): Currency | null {
  const k = KNOWN.find((x) => x.code === code.toUpperCase());
  if (!k) return /^[A-Z]{3}$/.test(code) ? { code, format: (n) => `${code} ${twoDecimals(n)}` } : null;
  return { code: k.code, format: (n) => (k.symbol ? `${k.symbol}${twoDecimals(n)}` : `${k.code} ${twoDecimals(n)}`) };
}

/** The code of the currency the texts use ("" when none is named). */
export function currencyCodeIn(texts: readonly string[]): string {
  const all = texts.filter(Boolean).join("\n");
  if (!all.trim()) return "";
  for (const m of all.matchAll(STATED)) {
    const code = (m[1] ?? m[2] ?? "").toUpperCase();
    if (KNOWN.some((k) => k.code === code)) return code;
  }
  let best = "";
  let most = 0;
  for (const k of KNOWN) {
    const n = (all.match(k.words) ?? []).length;
    if (n > most) {
      most = n;
      best = k.code;
    }
  }
  return best;
}

/** The currency of the texts, or null (neutral: plain amounts). */
export function currencyIn(texts: readonly string[]): Currency | null {
  const code = currencyCodeIn(texts);
  return code ? currencyOfCode(code) : null;
}

/** An amount in the project's currency, or a plain amount when the material names none. */
export function money(amount: number, c: Currency | null): string {
  return c ? c.format(amount) : twoDecimals(amount);
}
