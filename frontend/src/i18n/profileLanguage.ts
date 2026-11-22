// The signed-in person's language preference (the language of their Blocks IAM profile, /api/auth/session's
// profile.language) meets the language of this browser: see applyProfileLanguage in ./language.
import { useSession } from "@/blocks/session";
import { applyProfileLanguage, forgetSignedIn } from "./language";

export function bindProfileLanguage(): () => void {
  let seenUser: string | null = null;
  const on = (s: ReturnType<typeof useSession.getState>) => {
    const userId = s.status === "signed-in" ? s.profile?.userId ?? null : null;
    if (userId === seenUser) return;
    seenUser = userId;
    if (userId) applyProfileLanguage(s.profile?.language ?? null);
    else forgetSignedIn();
  };
  on(useSession.getState());
  return useSession.subscribe(on);
}
