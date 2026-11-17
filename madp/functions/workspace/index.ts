import { createFunction } from "../_lib";
import ops from "mf:ops/workspace";
import aclSchemas from "mf:schemas/acl";
export default createFunction({ name: "workspace", ops, aclSchemas });
