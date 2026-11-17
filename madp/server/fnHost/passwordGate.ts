// First-sign-in password gate: a person whose Account row says MustChangePassword may only use the session,
// change-password and sign-out endpoints until the password is changed. The local host reads the flag from the person's
// own Account row (server/local/host.ts).

export type PasswordGateState = "open" | "blocked" | "unavailable";

export const MUST_CHANGE_PASSWORD_CODE = "must_change_password";
export const MUST_CHANGE_PASSWORD_KEY = "auth.mustChangePassword";

export const UNKNOWN_FIELD_LINE =
  "[auth] Account.MustChangePassword is not on the Blocks schema yet; first-sign-in password changes are not enforced";

export interface PasswordGate {
  check(userId: string, accessToken: string): Promise<PasswordGateState>;
  markChanged(userId: string): void;
  changed(userId: string): boolean;
  clear(userId: string): void;
  forget(userId: string): void;
}

export function createPasswordGate(o: {
  read(userId: string, accessToken: string): Promise<boolean | "unknown-field">;
  now?(): number;
  ttlMs?: number;
  changedTtlMs?: number;
  maxUsers?: number;
  log?(line: string): void;
}): PasswordGate {
  const now = o.now ?? Date.now;
  const ttlMs = o.ttlMs ?? 600_000;
  const changedTtlMs = o.changedTtlMs ?? 900_000;
  const maxUsers = o.maxUsers ?? 10_000;
  const cache = new Map<string, { state: "open" | "blocked"; at: number }>();
  const marks = new Map<string, number>();
  const inFlight = new Map<string, Promise<PasswordGateState>>();
  let warned = false;

  const bound = <V>(map: Map<string, V>): void => {
    while (map.size > maxUsers) {
      const oldest = map.keys().next();
      if (oldest.done) return;
      map.delete(oldest.value);
    }
  };
  const put = (userId: string, state: "open" | "blocked"): void => {
    cache.delete(userId);
    cache.set(userId, { state, at: now() });
    bound(cache);
  };

  return {
    check(userId, accessToken) {
      const hit = cache.get(userId);
      if (hit && now() - hit.at < ttlMs) return Promise.resolve(hit.state);
      const pending = inFlight.get(userId);
      if (pending) return pending;
      const run = (async (): Promise<PasswordGateState> => {
        try {
          const r = await o.read(userId, accessToken);
          if (r === "unknown-field") {
            if (!warned) {
              warned = true;
              try {
                o.log?.(UNKNOWN_FIELD_LINE);
              } catch {
                /* logging never breaks a request */
              }
            }
            put(userId, "open");
            return "open";
          }
          const state = r === true ? "blocked" : "open";
          put(userId, state);
          return state;
        } catch {
          return "unavailable";
        } finally {
          inFlight.delete(userId);
        }
      })();
      inFlight.set(userId, run);
      return run;
    },
    markChanged(userId) {
      marks.delete(userId);
      marks.set(userId, now());
      bound(marks);
    },
    changed(userId) {
      const at = marks.get(userId);
      if (at === undefined) return false;
      if (now() - at < changedTtlMs) return true;
      marks.delete(userId);
      return false;
    },
    clear(userId) {
      marks.delete(userId);
      put(userId, "open");
    },
    forget(userId) {
      cache.delete(userId);
      marks.delete(userId);
      inFlight.delete(userId);
    },
  };
}
