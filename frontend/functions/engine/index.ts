import { createFunction } from "../_lib";
import ops from "mf:ops/engine";
import aclSchemas from "mf:schemas/acl";
export default createFunction({ name: "engine", ops, aclSchemas });
