/** "Read again" on a file of the Project understanding step: asks the MADP engine to read the committed file once more
 *  (doc.file.extract queues a file.extract job; the engine reads it on the engine host). Nothing is downloaded,
 *  uploaded or read in the browser or on the web server: the brief shows "Reading…" until the engine has finished. */

export interface RetryAttachment {
  fileId: string;
  name: string;
  mimeType?: string;
}

interface RetryDeps {
  /** Calls one op of the project function (callProjectOp). */
  callOp: <T>(op: string, args: Record<string, unknown>) => Promise<T>;
}

/** Queues the reading; answers the engine job's id (`queued` false: a reading of the file is already under way). */
export async function retryAttachmentExtraction(
  projectId: string,
  attachment: RetryAttachment,
  deps: RetryDeps,
  signal?: AbortSignal,
): Promise<{ jobId: string; queued: boolean }> {
  signal?.throwIfAborted();
  const answer = await deps.callOp<{ jobId: string; queued: boolean }>("doc.file.extract", { projectId, fileId: attachment.fileId });
  return { jobId: String(answer.jobId), queued: answer.queued === true };
}
