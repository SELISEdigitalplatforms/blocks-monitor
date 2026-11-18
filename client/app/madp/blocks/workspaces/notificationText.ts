// Kind + params -> one plain sentence, rendered on the web. ParamsJson holds keys and params only.
import { NOTIFICATION_KINDS, NOTIFICATION_KIND_LIST } from "@/madp/domain/notifications";
import { ENGINE_JOB_KIND_TEXT as ENGINE_JOB_KIND_LABEL } from "@/madp/components/engine/jobWords";

export const FALLBACK_NOTIFICATION_TEXT = "You have an update";

type Params = Record<string, unknown>;

interface Template {
  text: (p: Record<string, string>) => string;
}

/** The plain environment names, the same as the Release step's. */
const ENV: Record<string, string> = { dev: "Development", stage: "Staging", production: "Production" };
const env = (v: string | undefined) => (v ? ENV[v] ?? v : "");
/** The work's plain name ("Requirements draft"), never the kind's id. */
const work = (p: Record<string, string>) => p.jobLabel || (ENGINE_JOB_KIND_LABEL as Record<string, string>)[p.jobKind] || "The requested work";

/** "6 of 38 of its checks fail." */
const checksText = (p: Record<string, string>) => (p.checks ? `${p.checks} of its checks fail.` : "some of its checks fail.");
/** What happens next, and who acts. */
const nextText = (p: Record<string, string>) =>
  p.next === "fixing" ? " The development team is fixing them."
    : p.next === "reverting" ? " Development is being put back to the last build whose checks passed."
      : p.next === "you" ? " Open it to decide how to go on." : "";

const TEMPLATES: Record<keyof typeof NOTIFICATION_KINDS, Template> = {
  invited: {
    text: (p) => `${p.actorName} added you to ${p.workspaceName} as ${p.roleName}.`,
  },
  "access-requested": {
    text: (p) => `${p.actorName} asked to invite ${p.email} to ${p.workspaceName}. Ask a platform admin to add them in Blocks IAM.`,
  },
  assigned: { text: (p) => `${p.actorName} assigned you to ${p.projectName}.` },
  shared: { text: (p) => `${p.actorName} shared ${p.itemLabel} in ${p.projectName} with you.` },
  "business.handed-over": {
    text: (p) => `${p.actorName} finished the project setup of ${p.projectName}. Your business analyst is now getting to know it.`,
  },
  "requirements.ready": { text: (p) => `The requirements of ${p.projectName} are ready for your review.` },
  "scope.ready": { text: (p) => `The requirements of ${p.projectName} are approved. In Business Analysis, your business analyst is now preparing the scope and the delivery plan.` },
  "build.started": {
    text: (p) =>
      p.milestoneName
        ? `Your development team started building ${p.milestoneName} of ${p.projectName}.`
        : p.changeNumber
          ? `Your development team started building change ${p.changeNumber} of ${p.projectName}.`
          : `Your development team started building ${p.projectName}.`,
  },
  "approval.requested": { text: (p) => `${p.actorName} asks for your approval to release ${p.projectName} ${p.version} to ${env(p.environment)}.` },
  "approval.decided": { text: (p) => `${p.actorName} ${p.decision} ${p.projectName} ${p.version} for ${env(p.environment)}.` },
  "release.created": {
    text: (p) =>
      p.state === "not-usable"
        ? `${p.changeNumber ? `${p.changeNumber} of ${p.projectName}` : `${p.projectName} ${p.version}`} is on ${env(p.environment)}, but not usable yet: ${checksText(p)}${nextText(p)}`
        : p.state === "reverted"
          ? `${env(p.environment)} of ${p.projectName} is back on the last build whose checks passed (${p.version})${p.changeNumber ? `: ${p.changeNumber} was taken off it until it is fixed` : ""}.`
          : p.state === "fixed" && p.changeNumber
            ? `${p.changeNumber} of ${p.projectName} works on ${env(p.environment)} now (${p.version}): its checks pass.`
            : `Release ${p.version} of ${p.projectName} is prepared for ${env(p.environment)}.`,
  },
  "release.promoted": { text: (p) => `${p.projectName} ${p.version} is now on ${env(p.environment)}.` },
  "change.released": {
    text: (p) =>
      p.state === "not-usable"
        ? `Change ${p.changeNumber} of ${p.projectName} is on Development, but not usable yet: ${checksText(p)}${nextText(p)}`
        : p.state === "fixed"
          ? `Change ${p.changeNumber} of ${p.projectName} works on Development now: its checks pass.`
          : `Change ${p.changeNumber} of ${p.projectName} is released.`,
  },
  "preview.ready": { text: (p) => `The preview of ${p.milestoneName} in ${p.projectName} is ready to try.` },
  "job.succeeded": { text: (p) => `${work(p)} for ${p.projectName} is finished.` },
  "job.failed": { text: (p) => `${work(p)} for ${p.projectName} didn't finish. Open it to try again.` },
};

/** The kinds this file can render (the tests compare it with the catalogue). */
export const RENDERED_KINDS: readonly string[] = Object.keys(TEMPLATES);

/** Safe JSON parse to string params ({} on any error). */
export function parseNotificationParams(json: string | null | undefined): Record<string, string> {
  if (typeof json !== "string" || json === "") return {};
  try {
    const v: unknown = JSON.parse(json);
    if (typeof v !== "object" || v === null || Array.isArray(v)) return {};
    const out: Record<string, string> = {};
    for (const [k, val] of Object.entries(v)) {
      if (typeof val === "string") out[k] = val;
      else if (typeof val === "number" || typeof val === "boolean") out[k] = String(val);
    }
    return out;
  } catch {
    return {};
  }
}

export function notificationText(kind: string, params: Params): string {
  if (!(NOTIFICATION_KIND_LIST as readonly string[]).includes(kind)) return FALLBACK_NOTIFICATION_TEXT;
  const t = TEMPLATES[kind as keyof typeof NOTIFICATION_KINDS];
  const flat: Record<string, string> = {};
  const shape = NOTIFICATION_KINDS[kind as keyof typeof NOTIFICATION_KINDS];
  const read = (key: string): string | null => {
    const v = params?.[key];
    if (typeof v === "string" && v.trim() !== "") return v;
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
    return null;
  };
  for (const key of shape.required as readonly string[]) {
    const v = read(key);
    if (v === null) return FALLBACK_NOTIFICATION_TEXT;
    flat[key] = v;
  }
  for (const key of shape.optional as readonly string[]) {
    const v = read(key);
    if (v !== null) flat[key] = v;
  }
  return t.text(flat);
}
