import { FILE_OPS } from "./files";
import { FOLDER_OPS } from "./folders";
import { NOTE_OPS } from "./notes";

// DOC_OPS (the defineOp-made ops) is built from these handlers by ../projects/bind.ts.
export { FILE_OPS, FOLDER_OPS, NOTE_OPS };
export const DOC_HANDLERS = [...FOLDER_OPS, ...NOTE_OPS, ...FILE_OPS];
