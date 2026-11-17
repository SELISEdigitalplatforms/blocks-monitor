import type { Person } from "./types";

export const BLOCKS_PERSON_PREFIX = "blk-";

/** The person signed in with SELISE Blocks; set by the app from the Blocks session (no state imports here). */
export interface SignedIn { userId: string; person: Person; superAdmin: boolean }

let current: SignedIn | null = null;
let remembered: Person[] = [];
let version = 0;
const listeners = new Set<() => void>();

export const MEMBER_PERSON_PREFIX = "mbr-";
export const isMemberPersonId = (id: string): boolean => id.startsWith(MEMBER_PERSON_PREFIX);

function notifyPeople(): void {
  version += 1;
  listeners.forEach((fn) => {
    try { fn(); } catch { /* a failing listener must not block the others */ }
  });
}

/** Keep a workspace member (who is not the signed-in person) known by id and email. */
export function rememberPerson(p: Person): void {
  remembered = [...remembered.filter((r) => r.id !== p.id), p];
  notifyPeople();
}

export function setSignedIn(s: SignedIn | null): void {
  current = s;
  notifyPeople();
}
export const signedIn = (): SignedIn | null => current;

export const peopleVersion = (): number => version;

export function subscribePeople(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean).map((w) => Array.from(w));
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).join("").toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

export function blocksPerson(p: { userId: string; email: string; displayName: string; isSuperAdmin: boolean }): Person {
  const email = p.email.trim().toLowerCase();
  const name = (p.displayName ?? "").trim().replace(/\s+/g, " ") || email.split("@")[0];
  return {
    id: `${BLOCKS_PERSON_PREFIX}${p.userId}`,
    name,
    email,
    title: p.isSuperAdmin ? "Super admin" : "Member",
    role: "requester",
    initials: initialsOf(name),
    does: "Signed in to MADP Factory.",
  };
}

export function memberPerson(m: { id: string; name: string; email: string }): Person {
  const email = m.email.trim().toLowerCase();
  const name = m.name.trim().replace(/\s+/g, " ") || email.split("@")[0];
  return {
    id: `${MEMBER_PERSON_PREFIX}${m.id}`,
    name,
    email,
    title: "Workspace member",
    role: "requester",
    initials: initialsOf(name),
    does: "Works in this workspace.",
  };
}

export const personById = (id: string): Person | undefined =>
  (current?.person.id === id ? current.person : undefined) ?? remembered.find((p) => p.id === id);
export const personByEmail = (email: string): Person | undefined => {
  const e = email.trim().toLowerCase();
  return (current?.person.email === e ? current.person : undefined) ?? remembered.find((p) => p.email === e);
};

export const ROLE_LABEL: Record<Person["role"], string> = {
  requester: "Owner",
  techlead: "Tech Lead",
  pm: "Project Manager",
  management: "Management",
  admin: "Admin",
};
