/** How much of the chat's furniture fits its height. */

export const HIDE_BELOW_H = 300;

/** How the quick prompts show for a chat of height `h`: wrapped onto as many lines as they need (never cut off at the
 *  panel's edge), or hidden (the composer stays). */
export function promptMode(h: number): "wrap" | "hidden" {
  return h < HIDE_BELOW_H ? "hidden" : "wrap";
}
