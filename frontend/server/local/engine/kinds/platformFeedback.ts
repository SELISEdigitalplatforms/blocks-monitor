// platform.feedback: a beta tester's feedback on the MADP Factory itself becomes a ticket in the Backlog column of the
// team's private GitHub Projects board. The job belongs to no project (ProjectId and WorkspaceId "system"); its input is
// the feedback (platformFeedback/ticket.ts readFeedbackInput).
//
//   1. a retry first looks for its own ticket on the board (the latest 50 items, the draft body ending with
//      "· job <jobId>") and reuses it, so a ticket is never made twice;
//   2. each attached file (bytes from Blocks Storage) goes to the private assets repo at
//      feedback/<day>/<jobId>/<n>-<name> (an existing file there is replaced with its sha); a file that cannot be read
//      or uploaded is listed as "could not be attached" and the ticket still goes out;
//   3. a draft issue on the board (addProjectV2DraftIssue), then its Status set to Backlog
//      (updateProjectV2ItemFieldValue).
//
// Runs only on a host with the board's GitHub sign-in (platformFeedback/config.ts; jobScope.ts keeps other hosts from
// claiming it). GitHub's refusals become a calm JobFailure with an engine.feedbackGithub* code.
import { JobFailure, type JobRun, type KindResult, type KindWriter } from "../run.ts";
import { feedbackConfig, feedbackToken, type FeedbackConfig } from "./platformFeedback/config.ts";
import { GithubError, addDraftIssue, findItemWithMarker, github, putRepoFile, setStatus, type BoardItem, type FetchLike, type Github } from "./platformFeedback/github.ts";
import { attachmentPath, dayOf, markerOf, rawUrl, readFeedbackInput, ticketBody, ticketTitle, type Attachment, type FeedbackInput } from "./platformFeedback/ticket.ts";

/** Larger files are listed, not uploaded (the contents API takes the file inline as base64). */
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export interface PlatformFeedbackDeps {
  env?: Record<string, string | undefined>;
  fetch?: FetchLike;
  token?: (env: Record<string, string | undefined>) => Promise<string | null>;
}

const AUTH_MESSAGE = "The team board's GitHub sign-in is missing or no longer allowed. The feedback is kept with this job and can be sent again.";
const RATE_MESSAGE = "GitHub asked us to slow down. The feedback is kept with this job; try sending it again in a few minutes.";
const FAILED_MESSAGE = "The ticket could not be written to the team board just now. The feedback is kept with this job and can be sent again.";

/** A GitHub refusal as the job's plain failure. */
function failureOf(e: GithubError): JobFailure {
  if (e.kind === "auth") return new JobFailure(AUTH_MESSAGE, "engine.feedbackGithubAuth");
  if (e.kind === "rateLimit") return new JobFailure(RATE_MESSAGE, "engine.feedbackGithubRateLimited");
  return new JobFailure(FAILED_MESSAGE, "engine.feedbackGithubFailed");
}

function itemLink(cfg: FeedbackConfig, item: BoardItem): string {
  return item.fullDatabaseId ? `${cfg.boardUrl}?pane=issue&itemId=${encodeURIComponent(item.fullDatabaseId)}` : cfg.boardUrl;
}

async function uploadAll(run: JobRun, gh: Github, cfg: FeedbackConfig, input: FeedbackInput): Promise<Attachment[]> {
  const out: Attachment[] = [];
  const day = dayOf(input.submittedAt, run.now());
  for (const [i, f] of input.files.entries()) {
    await run.step(25 + Math.round((40 * i) / Math.max(1, input.files.length)), `Attaching files (${i + 1} of ${input.files.length})…`);
    const bytes = f.fileId ? await run.readFile(f.fileId) : null;
    if (!bytes || bytes.length === 0) {
      out.push({ name: f.fileName, failed: "the file was not found" });
      continue;
    }
    if (bytes.length > MAX_UPLOAD_BYTES) {
      out.push({ name: f.fileName, failed: "the file is too large" });
      continue;
    }
    const path = attachmentPath({ day, jobId: run.id, index: i + 1, fileName: f.fileName });
    try {
      await putRepoFile(gh, { repo: cfg.assetsRepo, branch: cfg.assetsBranch, path, bytes, message: `Feedback ${run.id} attachment` });
      out.push({ name: f.fileName, image: f.mime.toLowerCase().startsWith("image/"), url: rawUrl(cfg.assetsRepo, cfg.assetsBranch, path) });
    } catch (e) {
      if (!(e instanceof GithubError)) throw e;
      // a sign-in GitHub refuses outright would refuse the ticket too: fail now, plainly
      if (e.kind === "auth" && e.status === 401) throw e;
      run.log(`attachment ${i + 1} not uploaded (${e.message})`);
      out.push({ name: f.fileName, failed: "the upload failed" });
    }
  }
  return out;
}

export function makePlatformFeedbackWriter(deps: PlatformFeedbackDeps = {}): KindWriter {
  return async (run: JobRun): Promise<KindResult> => {
    const env = deps.env ?? process.env;
    const cfg = feedbackConfig(env);
    const input = readFeedbackInput(run.input);
    if (!input.title && !input.description) throw new JobFailure("This feedback has no title and no description, so there is nothing to send.", "engine.feedbackEmpty");

    await run.step(5, "Getting ready to send the feedback…");
    const token = await (deps.token ?? ((e) => feedbackToken(e)))(env);
    if (!token) throw new JobFailure("Feedback tickets are not set up on this engine host yet (no GitHub sign-in for the team board).", "engine.feedbackNotConfigured");
    const gh = github(token, deps.fetch ?? (globalThis.fetch as unknown as FetchLike), run.signal);
    const marker = markerOf(run.id);

    try {
      await run.step(15, "Checking the team board…");
      let item = await findItemWithMarker(gh, cfg.projectId, marker);
      if (item) {
        run.log("the ticket of an earlier attempt is on the board; reusing it");
      } else {
        const attachments = await uploadAll(run, gh, cfg, input);
        await run.step(75, "Writing the ticket…");
        run.check();
        item = await addDraftIssue(gh, { projectId: cfg.projectId, title: ticketTitle(input), body: ticketBody(input, attachments, run.id) });
      }
      // a reused ticket someone already moved keeps its column
      if (!item.hasStatus) {
        await run.step(90, "Putting the ticket in Backlog…");
        await setStatus(gh, { projectId: cfg.projectId, itemId: item.id, fieldId: cfg.statusFieldId, optionId: cfg.statusOptionId });
      }
      const link = itemLink(cfg, item);
      return { outputs: [], message: `Ticket created in Backlog: ${link}`.slice(0, 200) };
    } catch (e) {
      if (e instanceof GithubError) {
        run.log(`GitHub refused (${e.kind}, ${e.message})`);
        throw failureOf(e);
      }
      throw e;
    }
  };
}

export const sendPlatformFeedback: KindWriter = makePlatformFeedbackWriter();

export const WRITERS: Partial<Record<"platform.feedback", KindWriter>> = { "platform.feedback": sendPlatformFeedback };
