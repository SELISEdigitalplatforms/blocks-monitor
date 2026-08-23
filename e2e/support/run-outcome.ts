import fs from "fs"
import path from "path"

const OUTCOME_PATH = path.resolve(__dirname, "../fixtures/run-outcome.json")

let monitorTestsFailed = false

export function markMonitorTestFailed() {
  monitorTestsFailed = true
  fs.mkdirSync(path.dirname(OUTCOME_PATH), { recursive: true })
  fs.writeFileSync(OUTCOME_PATH, JSON.stringify({ failed: true }))
}

/** Delete shared project only when every monitor test passed. */
export function shouldDeleteSharedProject(): boolean {
  if (process.env.E2E_KEEP_PROJECT === "1") return false
  if (fs.existsSync(OUTCOME_PATH)) return false
  return !monitorTestsFailed
}

export function resetRunOutcome() {
  monitorTestsFailed = false
  if (fs.existsSync(OUTCOME_PATH)) fs.unlinkSync(OUTCOME_PATH)
}
