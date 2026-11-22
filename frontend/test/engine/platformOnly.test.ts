import { describe, expect, it } from "vitest";
import { isBlocksPlatformLine, lineFor } from "../../src/blocks/engine/platformOnly";

const CONNECT = "Connect Athlete Insurance Portal to Blocks: open https://iam.seliseblocks.com/device and confirm ABCD-EFGH.";
const NO_ACCESS = "The Blocks account that signed in cannot reach the Blocks project of Athlete Insurance Portal. Start it again and sign in with the Blocks account that may deploy this product.";

describe("the platform's Blocks steps reach platform super admins only", () => {
  it("recognises the engine's Blocks sign-in and Blocks account lines and the blocks.* failures", () => {
    expect(isBlocksPlatformLine(CONNECT)).toBe(true);
    expect(isBlocksPlatformLine(NO_ACCESS)).toBe(true);
    expect(isBlocksPlatformLine("Waiting for the Blocks sign-in of Lunch board that another job started.")).toBe(true);
    expect(isBlocksPlatformLine("anything", "blocks.connect_no_access")).toBe(true);
    expect(isBlocksPlatformLine("Building CR-006: running the checks")).toBe(false);
    expect(isBlocksPlatformLine("One step in the Blocks portal is needed: in this product's Blocks project, open Release and add MADP Factory's repository x (branch \"dev\"). Then start the build again.")).toBe(true);
    expect(isBlocksPlatformLine("anything", "madp.link_repos")).toBe(true);
    expect(isBlocksPlatformLine("A Blocks step of the product set-up did not go through (auth oidc-clients list).", "madp.blocks_cli")).toBe(true);
    expect(isBlocksPlatformLine(null, null)).toBe(false);
  });
  it("people of a product read a calm line without a link or a code; a super admin reads the engine's own line", () => {
    const waiting = lineFor("running", CONNECT, null, false);
    expect(waiting).not.toContain("https://");
    expect(waiting).not.toContain("ABCD-EFGH");
    expect(waiting).toMatch(/platform team/i);
    const failed = lineFor("failed", NO_ACCESS, "blocks.connect_no_access", false);
    expect(failed).not.toMatch(/sign in/i);
    expect(failed).toMatch(/platform team/i);
    expect(lineFor("running", CONNECT, null, true)).toBe(CONNECT);
    expect(lineFor("failed", "The checks failed.", null, false)).toBe("The checks failed.");
  });
});
