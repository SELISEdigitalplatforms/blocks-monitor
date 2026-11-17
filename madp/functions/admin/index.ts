import { createFunction } from "../_lib";
import ops from "mf:ops/admin";
import aclSchemas from "mf:schemas/acl";
export default createFunction({ name: "admin", ops, aclSchemas });
