/** Binds the Blocks session to the people lookup and the persona. Identity comes only from the Blocks session. */
import { blocksPerson, setSignedIn } from "@/madp/data/people";
import { useSession } from "@/madp/blocks/session";
import { useDemo } from "./store";

type SessionState = ReturnType<typeof useSession.getState>;

function apply(s: SessionState): void {
  if (s.status === "signed-in" && s.profile) {
    const p = s.profile;
    const person = blocksPerson(p);
    setSignedIn({ userId: p.userId, person, superAdmin: p.isSuperAdmin });
    if (useDemo.getState().personaId !== person.id) useDemo.getState().signIn(person.id);
  } else if (s.status === "signed-out") {
    setSignedIn(null);
    if (useDemo.getState().personaId) useDemo.getState().signOut();
  }
}

let bound = false;

export function bindIdentity(): void {
  if (bound) return;
  bound = true;
  apply(useSession.getState());
  useSession.subscribe(apply);
}
