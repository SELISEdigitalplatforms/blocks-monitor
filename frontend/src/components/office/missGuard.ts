/** Guards for the chat over the 3D stage. */

/** A pointer click that missed every object clears the selection only when it is a real click ON the WebGL canvas:
 *  a keyboard or programmatic click from the chat's DOM (detail 0, or another target) is not a click on the floor. */
export function isCanvasClick(e: { target: EventTarget | null; detail: number }): boolean {
  return (e.target as { tagName?: string } | null)?.tagName === "CANVAS" && e.detail > 0;
}
