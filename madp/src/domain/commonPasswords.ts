// Passwords that are long enough but still among the first an attacker tries: entries of well-known breach lists
// (12 characters and longer, or common words that people pad to 12), plus patterns (one repeated character, runs,
// keyboard rows, a common word padded with digits or symbols). Checked the same way in the browser and on the server.

const WORDS = [
  "password", "passwort", "passw0rd", "p@ssw0rd", "p@ssword", "pass", "qwerty", "qwertz", "azerty", "asdf", "zxcv",
  "letmein", "welcome", "welkom", "willkommen", "admin", "administrator", "root", "login", "changeme", "default",
  "iloveyou", "monkey", "dragon", "master", "sunshine", "princess", "football", "baseball", "superman", "batman",
  "trustno1", "shadow", "michael", "jennifer", "secret", "abc", "abcd", "test", "guest", "user", "hello", "starwars",
  "freedom", "whatever", "computer", "internet", "madp", "factory", "madpfactory", "selise", "blocks", "company",
  "summer", "winter", "spring", "autumn", "january", "december", "access", "letmeinnow", "mypassword", "newpassword",
];

const LONG_COMMON = new Set([
  "123456789012", "1234567890123", "12345678901234", "123456789123", "1234567891011", "111111111111",
  "000000000000", "123123123123", "121212121212", "qwertyuiop12", "qwertyuiopas", "qwertyuiopasdf",
  "1q2w3e4r5t6y", "1q2w3e4r5t6y7u", "1qaz2wsx3edc", "1qaz2wsx3edc4rfv", "zaq12wsxcde3", "zaq1zaq1zaq1",
  "qazwsxedcrfv", "asdfghjkl123", "asdfghjklqwe", "passwordpassword", "iloveyouiloveyou", "trustno1trustno1",
  "correcthorsebatterystaple", "correct horse battery staple", "thequickbrownfox", "the quick brown fox",
  "letmein123456", "welcome123456", "administrator1", "changemenow1", "michaeljordan", "nicholasnicholas",
]);

const KEYBOARD_ROWS = ["1234567890", "qwertyuiop", "asdfghjkl", "zxcvbnm", "qwertzuiop", "yxcvbnm", "azertyuiop", "abcdefghijklmnopqrstuvwxyz"];

/** The whole string walks along one keyboard row or the alphabet (forwards or backwards, wrapping around). */
function isRun(s: string): boolean {
  if (s.length < 6) return false;
  for (const row of KEYBOARD_ROWS) {
    const rev = [...row].reverse().join("");
    const reps = Math.ceil(s.length / row.length) + 1;
    if (row.repeat(reps).includes(s) || rev.repeat(reps).includes(s)) return true;
  }
  return false;
}

/** True when the password is a known common one or follows an easy pattern. */
export function isCommonPassword(password: string): boolean {
  const raw = password.toLowerCase();
  if (LONG_COMMON.has(raw)) return true;
  const compact = raw.replace(/[\s._-]+/g, "");
  if (LONG_COMMON.has(compact)) return true;
  // one character, or one short chunk, repeated
  if (/^(.)\1+$/.test(compact)) return true;
  if (/^(.{1,4})\1{2,}$/.test(compact)) return true;
  if (isRun(compact)) return true;
  // a common word (or two) padded only with digits, symbols, or a year
  const bare = compact.replace(/[^a-z]/g, "");
  // the letters with the usual swaps undone (p@ssw0rd), trailing digits and symbols dropped first
  const leet = compact.replace(/[^a-z]+$/, "").replace(/@/g, "a").replace(/0/g, "o").replace(/1/g, "i").replace(/3/g, "e").replace(/\$/g, "s").replace(/[^a-z]/g, "");
  for (const w of WORDS) {
    if (bare === w || leet === w || bare === w + w) return true;
  }
  // only digits, with few different ones
  if (/^\d+$/.test(compact) && new Set(compact).size <= 4) return true;
  return false;
}
