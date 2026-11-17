// file.extract: the MADP engine reads one file people shared (queued by doc.file.commit when an upload is committed,
// and by doc.file.extract when someone asks for it to be read again). It runs on the engine host only — the in-process
// engine in local mode, the engine worker in Blocks mode — never on a web server:
//
//   1. the file's bytes from Storage (the DocFile's StorageObjectId);
//   2. the parser for its type and the AI runner's findings (server/api/extraction/process.ts readSource);
//   3. the project's knowledge base on this host (<MF_ENGINE_ROOT>/projects/<ws>/<id>/artifacts/brief: sources/<fileId>/,
//      the manifest, and the brief rebuilt from the project's rows), which the engine's context and tools read;
//   4. the reading as one JSON object in the project's Storage folder; the job's OutputRefs point at the file and at
//      that object, so every web server builds the brief from Blocks (brief/routes.ts), wherever it runs.
//
// A file that cannot be read fails the job with a plain reason (and the PDF reader's code), so the page can say so and
// offer "Read again". Restart safe: a run that starts again reads the file again and overwrites the same folder.
import type { EngineJobKind } from "../../../../src/domain/engineJob";
import { JobFailure, type JobRun, type KindResult, type KindWriter } from "../run.ts";
import { str } from "../context.ts";

const PUBLISHED_MIME = "application/json";
/** The reader's own plain reason for a document type it has no parser for (api/extraction/process.ts). */
const UNAVAILABLE_PARSER = "This document requires an unavailable parser.";

export const fileExtract: KindWriter = async (run: JobRun): Promise<KindResult> => {
  const fileId = str(run.input.fileId);
  const file = fileId ? run.p.row("DocFile", fileId) : undefined;
  if (!file || file.IsDeleted === true || str(file.Status) !== "ready") {
    throw new JobFailure("This file is no longer in the project.", "file.gone");
  }
  const name = str(file.Name) || "file";
  const mime = str(file.Mime) || "application/octet-stream";
  await run.step(10, `Reading ${name}…`);
  const data = await run.readFile(str(file.StorageObjectId));
  if (!data || data.length === 0) throw new JobFailure("The file could not be downloaded from storage.", "file.unreadable");

  const { readSource, saveExtraction, publishedReading } = await import("../../../api/extraction/process.ts");
  await run.step(30, `Reading ${name}…`);
  const reading = await readSource({ fileId, fileName: name, mimeType: mime, bytes: Buffer.from(data) });
  run.check();

  // the engine host's own knowledge base (the context, the prompts and the project-brief tools read it)
  await run.step(80, "Writing down what the file says…");
  const workspaceId = run.workspaceId || run.p.workspaceId;
  try {
    const { kbKey, LOCAL_WORKSPACE } = await import("../../../api/brief/access.ts");
    // Local mode (the in-process engine, no project folders): its brief routes own the "local" knowledge base and its
    // decisions.json. The engine host (Blocks): the project's own folder, with the brief made from the Blocks rows.
    const local = !run.deps.projectFolder;
    await saveExtraction(kbKey(local ? LOCAL_WORKSPACE : workspaceId, run.projectId), reading);
    if (!local) {
      const { syncBrief } = await import("../../../engine-context/briefSync.ts");
      await syncBrief({ workspaceId, projectId: run.projectId, userId: run.requester, project: run.p.project, rows: (s) => run.p.rows(s) });
    }
  } catch (e) {
    // the reading still reaches Blocks below; the next context refresh writes the folder again
    run.log(`[engine] file.extract ${run.id.slice(0, 8)}: knowledge base not written (${e instanceof Error ? e.message.slice(0, 120) : "error"})`);
  }

  // a file that could not be read: the job fails with the reason (the row is what the page shows). The PDF reader's
  // reasons (with their code) and the missing-parser one are written for people; any other is a library's or the AI
  // runner's own words, which go to the log only.
  if (reading.result.status === "failed") {
    const reason = reading.error || "";
    if (reading.errorCode || reason === UNAVAILABLE_PARSER) throw new JobFailure(reason || "This file could not be read.", reading.errorCode || "file.failed");
    run.log(`not read: ${reason.replace(/\s+/g, " ").slice(0, 500) || "no reason given"}`);
    throw new JobFailure("This file could not be read. Share it again in a few minutes; if it still fails, ask the engine team to look into it.", "file.failed");
  }

  // what every web server reads: one JSON object per reading, in the project's Storage folder
  const published = publishedReading(reading, run.iso());
  const objectId = await run.putFile(`reading-${fileId}.json`, PUBLISHED_MIME, new TextEncoder().encode(JSON.stringify(published)));
  const outputs = [`DocFile:${fileId}`, `StorageObject:${objectId}`];
  const found = reading.findings.observations.length;
  const message = reading.result.status === "unsupported"
    ? `${name}: this kind of file can't be read automatically.`
    : `${name}: ${found} finding${found === 1 ? "" : "s"}.`;
  return { outputs, message };
};

export const WRITERS: Partial<Record<EngineJobKind, KindWriter>> = {
  "file.extract": fileExtract,
};
