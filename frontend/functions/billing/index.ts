import { createFunction } from "../_lib";
import ops from "mf:ops/billing";
import aclSchemas from "mf:schemas/acl";
export default createFunction({ name: "billing", ops, aclSchemas });
