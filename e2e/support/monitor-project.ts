import fs from "fs"
import path from "path"

export type MonitorProjectFixture = {
  projectName: string
  itemId: string
  dashboardUrl: string
  monitorUrl: string
}

const FIXTURE_PATH = path.resolve(__dirname, "../fixtures/monitor-project.json")
export const MONITOR_SESSION_PATH = path.resolve(__dirname, "../fixtures/monitor-session.json")

export function readMonitorProject(): MonitorProjectFixture | null {
  if (!fs.existsSync(FIXTURE_PATH)) return null
  return JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8")) as MonitorProjectFixture
}

export function writeMonitorProject(fixture: MonitorProjectFixture) {
  fs.mkdirSync(path.dirname(FIXTURE_PATH), { recursive: true })
  fs.writeFileSync(FIXTURE_PATH, JSON.stringify(fixture, null, 2))
}

export function clearMonitorProject() {
  if (fs.existsSync(FIXTURE_PATH)) fs.unlinkSync(FIXTURE_PATH)
}

export function clearMonitorSession() {
  if (fs.existsSync(MONITOR_SESSION_PATH)) fs.unlinkSync(MONITOR_SESSION_PATH)
}

export function monitorSessionExists(): boolean {
  return fs.existsSync(MONITOR_SESSION_PATH)
}
