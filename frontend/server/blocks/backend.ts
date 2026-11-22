import adminOps from "mf:ops/admin";
import workspaceOps from "mf:ops/workspace";
import projectOps from "mf:ops/project";
import deliveryOps from "mf:ops/delivery";
import collabOps from "mf:ops/collab";
import billingOps from "mf:ops/billing";
import aclSchemas from "mf:schemas/acl";
import { createFunction } from "../../functions/_lib/router.ts";

// Real Blocks SDK/service adapters are the router defaults. No local gateway/IAM/engine.
// One router per function this host serves (BLOCKS_FUNCTIONS in host.ts). Admin's people.* ops call Blocks IAM with the
// signed-in caller's own token (the host passes it for admin and workspace only).
const routers = {
  workspace: createFunction({ name: "workspace", ops: workspaceOps, aclSchemas }),
  project: createFunction({ name: "project", ops: projectOps, aclSchemas }),
  delivery: createFunction({ name: "delivery", ops: deliveryOps, aclSchemas }),
  collab: createFunction({ name: "collab", ops: collabOps, aclSchemas }),
  admin: createFunction({ name: "admin", ops: adminOps, aclSchemas }),
  billing: createFunction({ name: "billing", ops: billingOps, aclSchemas }),
};

export function getRouter(name: keyof typeof routers) {
  return routers[name];
}
