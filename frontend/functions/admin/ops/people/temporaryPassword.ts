// The temporary password people.createAccount hands to the admin once. Pure: the randomness is injected.
import { randomInt } from "node:crypto";

export const TEMP_PASSWORD_LENGTH = 20;

const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWER = "abcdefghijkmnopqrstuvwxyz";
const DIGITS = "23456789";
const SYMBOLS = "!@#$%^&*-_=+?";
const PER_CLASS = 2;

type Rand = (max: number) => number;

/** 20 characters, at least 2 of each class, uniformly drawn and Fisher-Yates shuffled. */
export function generateTemporaryPassword(rand: Rand = (max) => randomInt(max)): string {
  const pick = (set: string): string => set[rand(set.length)];
  const all = UPPER + LOWER + DIGITS + SYMBOLS;
  const chars: string[] = [];
  for (const set of [UPPER, LOWER, DIGITS, SYMBOLS]) for (let i = 0; i < PER_CLASS; i++) chars.push(pick(set));
  while (chars.length < TEMP_PASSWORD_LENGTH) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

export function meetsTemporaryPasswordPolicy(pw: string): boolean {
  return (
    pw.length >= 16 && pw.length <= 64 && !/\s/.test(pw) &&
    /[A-Z]/.test(pw) && /[a-z]/.test(pw) && /[0-9]/.test(pw) && /[^A-Za-z0-9]/.test(pw)
  );
}
