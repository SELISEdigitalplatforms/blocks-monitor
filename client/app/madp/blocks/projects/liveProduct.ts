// The documentation of a live product: the op project.documentExisting queues the engine job product.document
// (src/domain/liveProduct.ts). A repeat while one is queued or running answers that job. Plain messages for the
// op's refusals live in ./messages.ts (liveProduct.*).
import { useMutation } from "@tanstack/react-query";
import { callFunction, newRequestId } from "../fn";
import { queryClient } from "../queryClient";
import { isEngineJobQuery } from "../engine/actions";
import { DOCUMENT_OP } from "@/madp/domain/liveProduct";

export interface DocumentExistingResult {
  jobId: string;
  /** a documentation was already queued or running: that one is answered */
  existing: boolean;
}

/** Asks for the documentation of a live product and reads the project's job list again. */
export async function documentExisting(projectId: string, requestId = newRequestId()): Promise<DocumentExistingResult> {
  const res = await callFunction<{ jobId?: unknown; existing?: unknown }>("project", DOCUMENT_OP, { projectId }, { requestId });
  await queryClient.invalidateQueries({ predicate: isEngineJobQuery });
  return { jobId: typeof res.data?.jobId === "string" ? res.data.jobId : "", existing: res.data?.existing === true };
}

/** One mutation per page: "Document / Refresh from the live product". */
export function useDocumentExisting(projectId: string) {
  return useMutation({ mutationKey: ["documentExisting", projectId], mutationFn: () => documentExisting(projectId) });
}
