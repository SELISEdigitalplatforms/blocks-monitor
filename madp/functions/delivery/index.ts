import { createFunction } from "../_lib";
import ops from "mf:ops/delivery";
import aclSchemas from "mf:schemas/acl";
export default createFunction({ name: "delivery", ops, aclSchemas });
