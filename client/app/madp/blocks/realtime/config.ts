// The doorbell's non-secret settings. Only the public project key goes in the hub URL; the IAM cookie session does the rest.
import { blocksConfig } from "../config";

/** The Blocks Notifier method name; blocks/logic/notification/mf-doorbell.json uses the same value. */
export const DOORBELL_METHOD = "mf.doorbell";

/** The https hub URL with the public project key, or null when it is unset or not https. */
export function doorbellHubUrl(): string | null {
  const raw = import.meta.env.VITE_MF_NOTIFIER_HUB_URL;
  if (typeof raw !== "string" || raw.trim() === "") return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  url.searchParams.set("x-blocks-key", blocksConfig().projectKey);
  return url.toString();
}
