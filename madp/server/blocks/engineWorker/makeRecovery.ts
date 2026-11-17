import fs from "node:fs";
import path from "node:path";

/** Operator has confirmed that the abandoned attempt created no file. Never discard a fresh marker. */
export function archiveMakeAttempt(directory: string, now: Date): void {
  const started = path.join(directory, "provider-started.json");
  const abandoned = path.join(directory, "provider-started.abandoned.json");
  if (fs.existsSync(path.join(directory, "provider-result.json"))) {
    throw new Error("A provider result is recorded. Inspect and recover its destination instead of starting a new file.");
  }
  if (fs.existsSync(started)) {
    const destination = fs.existsSync(abandoned) ? path.join(directory, `provider-started.abandoned.${now.getTime()}.json`) : abandoned;
    fs.renameSync(started, destination);
  } else if (!fs.existsSync(abandoned)) {
    throw new Error("The failed attempt left no provider start marker or archived attempt to recover.");
  }
}

/** A resumed run gets a new timeout window, not the expired claim's timestamp. */
export function makeRecoveryClaim(briefId: string, now: Date) {
  // The gateway ignores null clears; keep the previous finish time as history until this run finishes.
  return { Status: "claimed", ClaimedAt: now.toISOString(), Progress: 0,
    Message: "Resuming the approved private Make import.", ErrorCode: "", ActiveKey: `design.generate:${briefId}` };
}

/** Re-entering the same operator-approved recovery is safe; changing its destination is not. */
export function recordMakeRecovery(directory: string, fileKey: string, now: Date): void {
  const file = path.join(directory, "provider-recovery.json");
  if (fs.existsSync(file)) {
    const previous = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
    if (previous.fileKey !== fileKey) throw new Error("A different recovery destination is already recorded. Inspect it before changing the target.");
    return;
  }
  fs.writeFileSync(file, JSON.stringify({ fileKey, decidedAt: now.toISOString() }, null, 2), { flag: "wx", mode: 0o600 });
}
