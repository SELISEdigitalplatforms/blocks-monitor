// The `seed` area of mf-admin: super admin only, SeedKey-based, resumable. A seed must never run twice concurrently.
import { seedApply } from "./apply";
import { seedRemove } from "./remove";
import { seedStart } from "./start";
import { seedStatus } from "./status";

export const SEED_OPS = [seedStart, seedApply, seedRemove, seedStatus];
