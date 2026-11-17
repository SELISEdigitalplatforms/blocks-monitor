// Blocks sign-ins and Blocks account problems belong to the platform team, never to the people of a product: a
// product's Blocks project is reached with the platform's own Blocks account (today one person's, later a master
// account), so nobody on a project can or should approve a Blocks sign-in. The engine still writes those lines
// (server/local/engine/official/blocksLogin.ts: "Connect <product> to Blocks …", "Waiting for the Blocks sign-in of …",
// the blocks.* failures); here they are told to platform super admins only. Everyone else reads one calm line that
// says the platform team is finishing a one-time setup, and no sign-in card, link or code.
import { useSession } from "@/blocks/session";
import { connectOf } from "@/domain/blocksConnect";
import { t } from "@/i18n";

/** Lines of the engine's Blocks sign-in and Blocks account steps (the job's own wording, see blocksLogin.ts). */
const BLOCKS_LINE = /\bconnect\b.{1,80}\bto Blocks\b|\bBlocks sign-?in\b|\bBlocks account\b|\bsigned in to Blocks\b|\bBlocks project of\b|\bBlocks portal\b|\bBlocks step\b|\bMADP registry\b/i;
/** Error codes of steps only the platform team can take (portal links, the engine's Blocks set-up and registry). */
const PLATFORM_CODES = new Set(["madp.link_repos", "madp.blocks_cli", "madp.registry"]);

/** True when a job's line or error is about the platform's Blocks sign-in or Blocks account. */
export function isBlocksPlatformLine(message: string | null | undefined, errorCode?: string | null): boolean {
  if (typeof errorCode === "string" && (errorCode.startsWith("blocks.") || PLATFORM_CODES.has(errorCode))) return true;
  if (!message) return false;
  return connectOf(message) !== null || BLOCKS_LINE.test(message);
}

/** The calm line people of a product read instead (no link, no code, nothing to do). */
export function platformSetupLine(status: string): string {
  return status === "failed"
    ? t("studio.engine.platformSetup.failed", "This product's one-time setup on the platform needs the platform team. They have been told; you don't need to do anything.")
    : t("studio.engine.platformSetup.waiting", "The platform team is finishing a one-time setup for this product. You don't need to do anything; the work continues by itself.");
}

/** Whether the signed-in person sees the platform's own Blocks steps (platform super admins only). */
export const seesPlatformSteps = (): boolean => useSession.getState().profile?.isSuperAdmin === true;

/** The line to show for a job: the engine's own line for platform super admins, the calm line for everyone else. */
export function lineFor(status: string, message: string | null, errorCode: string | null, operator = seesPlatformSteps()): string | null {
  if (operator || !isBlocksPlatformLine(message, errorCode)) return message;
  return platformSetupLine(status);
}
