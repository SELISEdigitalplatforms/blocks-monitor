import { createFunction } from "../_lib";
import ops from "mf:ops/project";
import aclSchemas from "mf:schemas/acl";
export default createFunction({ name: "project", ops, aclSchemas });
