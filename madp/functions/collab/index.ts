import { createFunction } from "../_lib";
import ops from "mf:ops/collab";
import aclSchemas from "mf:schemas/acl";
export default createFunction({ name: "collab", ops, aclSchemas });
