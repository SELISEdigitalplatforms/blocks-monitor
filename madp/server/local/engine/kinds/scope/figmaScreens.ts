import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { JobFailure, JobGone, type JobRun, type KindResult } from '../../run.ts';
import { makeRunner, makeRunnerBinary, makeRunnerProvider } from '../../ai/makeRunner.ts';
import { figmaEngineConfig, reserveFigmaIteration, FigmaConfigurationError, assertFigmaWriteAvailable, claimFigmaWrite, finishFigmaWrite, figmaDesignerModel, type FigmaEngineConfig } from '../../ai/figmaConfig.ts';
import { readScreenExports } from '../../ai/screenArtifacts.ts';
import { designIntentOf, factoryDesignSource, parseProductPrototype, checkDesignCoverage, coverageFailureMessage, designCoverageTemplate, resolveRequirementKey } from '../../../../../src/domain/factoryDesign.ts';
import { figmaDesignUrl, screenPreviewPath, parseFigmaScreens, screenGallery } from '../../../../../src/domain/figmaScreens.ts';
import type { Row } from '../../../../../functions/_lib/gateway';
import { startFigmaUploadBridge } from '../../ai/figmaUpload.ts';
import { assessDesignFeedback, requireAlignedDesignFeedback } from '../../ai/designFeedback.ts';
import { prototypeRunner } from '../../ai/prototypeRunner.ts';
import { parseDesignTokens } from '../../../../../src/domain/designTokens.ts';
import { resolveCoverageScreens } from './figmaCoverage.ts';
import { loadDesignKit, type DesignKit } from './designKit.ts';
import { DESIGN_BRIEF_FILE, DESIGNER_SYSTEM_MAX_BYTES, designerSystem, prepareDesignBrief, styleOfRecord, type PreparedDesignBrief } from './designerBrief.ts';
import {
  brandColourOf, designQualityBar, notReviewedState, pngInfo, polishInstructions, polishRequest, POLISH_SCHEMA, REVIEW_SCHEMA, REVIEW_STATE_FILE, REVIEW_STEPS,
  reviewImages, reviewPrompt, reviewRubric, reviewSection, reviewSystem, runDesignReview, writeReviewSection, type ReviewScreen, type ReviewState,
} from './designReview.ts';

/** The Figma tool steps for a Codex session (html_to_figma through the host upload bridge, get_figma_skill). */
const CODEX_FIGMA_TOOLS = {
  upload: 'For html_to_figma uploads, use the worker-host upload bridge: write figma-upload-request.json with {"requestId": a unique alphanumeric id for this upload, "url": the single-use URL returned by the official html_to_figma tool, "file": the basename of the HTML document in this directory}. The host posts those bytes with UTF-8 Content-Type. Wait for figma-upload-response.json with the matching requestId and read its ok/data result; never reuse a stale response. Submit only one request at a time, never resend an ambiguous upload. Do not use shell curl/Python for HTML submission. The bridge accepts only HTTPS mcp.figma.com HTML destinations, no credentials or Blocks headers. Follow the returned conversion receipt for the actual frame IDs.',
  initial: 'For this initial design from a description, use the official figma-generate-design HTML-to-Figma exception: author carefully composed self-contained screen HTML documents that follow the chosen style direction and the house principles, and convert them into native editable layers with html_to_figma. This is screen design, not a reusable component-library deliverable. Do not initiate a separate component-library authoring workflow. If html_to_figma is unavailable, report that specific limitation. Do not import runnable Make code.',
  skill: 'Before using any tool requiring a Figma skill, obtain its skill using the official get_figma_skill tool or MCP skill resource; follow it. In particular load figma-create-new-file before create_new_file, and figma-use plus figma-generate-design before use_figma. If required skills cannot be loaded, fail explicitly.',
  export: "Export the actual completed Figma screen frames as PNG files into the supplied working directory using official export/download tools. Inspect the exports before returning; no screenshots of unrelated apps, invented image URLs or raster-only fake Figma frames. Each PNG must correspond to the returned native frame nodeId. Local shell may compose screen HTML, save exports and handoff files, and execute upload/download HTTP instructions explicitly returned by official Figma tools, including html_to_figma's HTML POST. Use only the exact provider-returned destination URLs; do not invent endpoints, use browser credentials or send Blocks headers. Never read files outside this working directory or change system configuration.",
};

/** The same steps with the tools a Claude Code session has: Figma's skills as MCP resources, native frames drawn with
 *  use_figma (Plugin API), PNG exports from get_screenshot's short-lived download URL. */
const CLAUDE_FIGMA_TOOLS = {
  upload: 'This session has no html_to_figma upload step: draw native frames directly with use_figma. Use the already installed curl only to download the PNG URLs that get_screenshot returns.',
  initial: 'Design every screen as native, editable Figma layers drawn with use_figma (Figma Plugin API JavaScript, at most 50,000 characters per call; split large screens over several calls). Use one top-level frame per screen: 1440 px wide for desktop screens, 390 px wide for phone screens where the requirements mention mobile. Use auto layout, real text layers (Inter unless the chosen style direction names another typeface Figma offers), named layers and consistent 8 px spacing; follow the chosen style direction and the house principles for palette, typography, shape, density and character. Realistic fictional content only. This is screen design (with the own small working kit of components and styles of this file, as SKILL.md describes), not a separate component-library deliverable and not Figma Make.',
  skill: 'Before using a Figma tool, read its official skill with ReadMcpResourceTool: skill://figma/figma-create-new-file/SKILL.md before create_new_file, and skill://figma/figma-use/SKILL.md plus skill://figma/figma-generate-design/SKILL.md before use_figma (ListMcpResourcesTool lists them). Follow them. If a skill cannot be read, fail explicitly. Get the plan key from whoami, then create_new_file with editorType "design".',
  export: 'Export every completed screen frame as a PNG into the supplied working directory: call get_screenshot with the fileKey and the frame nodeId (maxDimension 2048), then download its short-lived PNG URL with curl into a file named <screen-slug>.png (letters, digits, - and _ only). Inspect each export before returning. Each PNG must show its returned native frame nodeId; no invented images. Never read files outside this working directory or change system configuration.',
};

/** How the planner writes the requirement map. Criterion ids instead of copied text: a copy with a screen reference
 *  appended or a cut-off ending used to fail a finished design. A requirement with nothing to see on a screen is said
 *  so explicitly, with a reason people read before approving, instead of failing the whole design. */
export const COVERAGE_RULES = 'Requirement map (coverage): return exactly one entry per requirement key in coverageTemplate and no other keys. In criteria, list the ids of that requirement\'s acceptance criteria from coverageTemplate ("AC1", "AC2", ...); each id stands for that exact criterion. Do not copy, shorten or annotate criterion text, and never put screen names or node ids in criteria; frame node ids go only in screens. If a requirement has nothing a person sees or does on any screen (for example a background data import or a scheduled feed from another system), return screens [] and noScreenReason: one short plain sentence saying why no screen is needed, and list it in design-master.md. Otherwise noScreenReason is null. When any part of a requirement is user-facing (a status, a setting, an error, a result), design that part instead of using noScreenReason.';

/** Native Figma frames and PNG exports; never requires a published Make website. */
export async function generateFigmaScreens(run: JobRun, brief: Row): Promise<KindResult> {
  const config = figmaEngineConfig();
  const workspace = process.env.MF_ENGINE_FIGMA_WORKSPACE?.trim();
  // SKILL.md, the house principles, the style directions and the screen recipes (a release without them fails here)
  const kit = loadDesignKit();
  for (const problem of kit.problems) run.log(`design skill: ${problem}`);
  const intent = designIntentOf(run.p);
  const source = factoryDesignSource(intent);
  const operation = `${run.workspaceId}:${run.projectId}:${String(brief.ItemId)}`;
  try { assertFigmaWriteAvailable(config, operation, run.id); }
  catch (error) { if (error instanceof FigmaConfigurationError) throw new JobFailure(error.message, error.code); throw error; }
  if (source !== run.input.source) throw new JobFailure('Project intent changed before design generation.', 'design.stale');
  const dir = path.join(run.folder().artifacts, 'figma-screens', run.id);
  fs.mkdirSync(dir, { recursive: true });
  const resultFile = path.join(dir, 'result.json');
  const started = path.join(dir, 'started.json');
  const previous = parseFigmaScreens(brief.PrototypeJson);
  const currentRevision = parseProductPrototype(brief.PrototypeJson);
  if (currentRevision?.jobId !== run.id && (currentRevision?.revision ?? null) !== (run.input.previousRevision ?? null)) {
    throw new JobFailure('The design revision changed before this request started.', 'design.stale');
  }
  const feedback = typeof run.input.feedback === 'string' ? run.input.feedback.trim() : '';
  if (feedback && !fs.existsSync(resultFile) && !fs.existsSync(started)) {
    await run.step(5, 'Checking design feedback against the agreed goals and requirements.');
    const assessment = await assessDesignFeedback(prototypeRunner, intent, feedback, previous?.revision ?? null, run.signal);
    fs.writeFileSync(path.join(dir, 'feedback-assessment.json'), JSON.stringify(assessment, null, 2));
    requireAlignedDesignFeedback(assessment);
  }
  let result: any;
  let prepared: PreparedDesignBrief | null = null;
  let recoveryUrl: string | null = null;
  let resumeFrames = false;
  if (fs.existsSync(resultFile)) {
    result = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
    const manifestFile = path.join(dir, 'screen-manifest.json');
    const uploadRecovery = /HTTP requests exceed your save-only/.test(String(result.error));
    const accountRecovery = process.env.MF_ENGINE_FIGMA_RESUME_JOB === run.id && /Starter.plan MCP limit|MCP.*(?:limit|allowance)/i.test(String(result.error));
    const networkRecovery = /could not resolve mcp\.figma\.com/i.test(String(result.error)) && result.screens?.length === 0;
    const recoveryFile = path.join(dir, networkRecovery ? 'recovered-host-upload.json' : accountRecovery ? 'recovered-account-access.json' : uploadRecovery ? 'recovered-upload-permission.json' : 'recovered-empty-file.json');
    if (result.error && (networkRecovery || accountRecovery || /component-authoring helper failed to load|HTTP requests exceed your save-only/.test(String(result.error)) && result.screens?.length === 0) && fs.existsSync(manifestFile) && !fs.existsSync(recoveryFile)) {
      const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8').replace(/^\uFEFF/, ''));
      recoveryUrl = accountRecovery || manifest.status === 'failed' && manifest.screens?.length === 0 ? figmaDesignUrl(manifest.projectUrl) : null;
      resumeFrames = accountRecovery;
      if (recoveryUrl) {
        fs.writeFileSync(recoveryFile, JSON.stringify({ projectUrl: recoveryUrl, jobId: run.id, reason: 'Provider explicitly recorded an empty destination after missing helper; resume this exact file once.' }));
        fs.renameSync(resultFile, path.join(dir, networkRecovery ? 'result.shell-network-failure.json' : accountRecovery ? 'result.account-limit-failure.json' : uploadRecovery ? 'result.upload-permission-failure.json' : 'result.empty-file-failure.json'));
        result = null;
      }
    }
  }
  // A stopped native planner can resume its recorded file without repeating
  // creation. The job/source checkpoint binds the receipt to this revision.
  const nativeReceiptFile = path.join(dir, 'native-frame-receipt.json');
  if (!result && !recoveryUrl && fs.existsSync(started) && fs.existsSync(nativeReceiptFile)) {
    const checkpoint = JSON.parse(fs.readFileSync(started, 'utf8'));
    const receipt = JSON.parse(fs.readFileSync(nativeReceiptFile, 'utf8'));
    if (checkpoint.jobId === run.id && checkpoint.source === source && figmaDesignUrl(receipt.projectUrl) &&
        Array.isArray(receipt.nodeIds) && receipt.nodeIds.length && receipt.nodeIds.every((id: unknown) => typeof id === 'string' && /^\d+:\d+$/.test(id))) {
      recoveryUrl = figmaDesignUrl(receipt.projectUrl);
      resumeFrames = true;
    }
  }
  if (!result) {
    if (fs.existsSync(started) && !recoveryUrl) throw new JobFailure('Recover the recorded Figma operation before retrying; it may have created frames.', 'design.figmaRecoveryRequired');
      try { reserveFigmaIteration(config, run.id, run.now()); }
    catch (error) { if (error instanceof FigmaConfigurationError) throw new JobFailure(error.message, error.code); throw error; }
    // The business analyst's design brief and the style direction, chosen once per job (a resumed job keeps its own;
    // one that drew before it had a brief resumes without one, in the look it already has).
    const fresh = !fs.existsSync(started);
    if (fresh) await run.step(8, 'The business analyst is writing the design brief and choosing the style direction.');
    prepared = await prepareDesignBrief(run, dir, kit, { prototypeJson: brief.PrototypeJson, feedback, revision: run.input.previousRevision != null, choose: fresh });
    await run.step(10, REVIEW_STEPS.drawing);
      claimFigmaWrite(config, operation, run.id, source);
    // designReview: this job reviews and polishes its screens before saving them (an older checkpoint does not)
    if (!fs.existsSync(started)) fs.writeFileSync(started, JSON.stringify({ source, jobId: run.id, startedAt: run.iso(), artifactVersion: 2, designReview: 1 }));
    // The Figma MCP offers different tools per client: Codex gets html_to_figma and get_figma_skill; Claude Code gets
    // use_figma, get_screenshot and the skills as MCP resources (skill://figma/...). The steps are the same.
    const provider = makeRunnerProvider();
    const tools = provider === 'claude' ? CLAUDE_FIGMA_TOOLS : CODEX_FIGMA_TOOLS;
    const stopUploads = startFigmaUploadBridge(dir);
    try { result = await makeRunner()({
      system: designerSystem({ kit, prepared, withSkill: true, instructions: `You are the product planner producing native Figma Design screen frames, NOT a website or Figma Make project.
Use only the official Figma MCP for remote design operations. Never access credentials, publish a website, install packages, use unrelated servers or call Blocks APIs.
Use the already installed Node executable for local helper scripts. Never invoke Python launchers, runtime managers, installers or bootstrap downloads. Do not download a runtime into the job workspace. Preserve the configured proxy and certificate environment for provider uploads; do not print it.
${tools.upload}
${workspace ? `The operator selected this Figma workspace for MADP designs: ${JSON.stringify(workspace)}. Resolve its exact name through whoami and use that plan's key when creating the file. This is the user's selected destination; do not ask again. If no exact match exists, stop with workspace selection required; do not silently choose a different plan.` : 'No destination workspace is configured. Follow the official creation skill when resolving the destination.'}
${recoveryUrl ? `RECOVERY: Reuse only the recorded file ${recoveryUrl}. Inspect its current structure first. Do not create another file or duplicate any existing completed frames.` : 'Create a new Figma Design file for this revision so previous approved designs remain immutable.'}
${resumeFrames ? 'RESUME EXISTING FRAMES: Complete the interrupted revision in the recorded file. Read native-frame-receipt.json, any screen-manifest.json, ux-plan.md and the existing PNGs before working. Inspect the recorded frames in one batched native read to recover their names and mappings. Preserve valid exported PNGs when they match the current frames. Finish the visual review, export only missing or corrected frames, write design-master.md and return the complete screens/coverage result. Do not restart planning, redraw the revision, reconvert HTML or duplicate screens. Correct material clipping or encoding defects in place. If quota or permissions block completion, preserve all progress and return the specific error.' : ''}
${tools.initial}
${designQualityBar()}
${tools.skill}
After successful remote writes, journal the destination and actual frame node IDs to native-frame-receipt.json. Preserve and reuse those frames after interruption. Inspect the actual tool catalog before writing, and return an error starting with "Figma capability unavailable:" if this provider's required operation is absent. Build and visually inspect sections incrementally; the file's working kit of components and styles is part of the screens, not a separate library deliverable.
Derive a complete screen inventory. The visual direction is the chosen style direction applied under the house principles; record its tokens in the design master. Cover all requirements and exact acceptance criteria with requirement-to-screen traceability. Include important role, responsive, empty, error and validation states. Use realistic fictional data, accessible contrast and readable typography. Do not invent business scope.
${tools.export}
Return provider-observed Figma file URL and frame IDs. In coverage, name every screen by its frame nodeId exactly as returned in screens.
${COVERAGE_RULES}
Write ux-plan.md and design-master.md in the working directory. The design master must describe layout, typography, colors, components, interactions, screen states and screen-to-requirement mapping so development can implement these exact designs. Return error if any required operation cannot complete.` }),
      prompt: JSON.stringify({ directory: dir, intent, coverageTemplate: designCoverageTemplate(intent), feedback: run.input.feedback ?? '', previous: previous ? { projectUrl: previous.projectUrl, revision: previous.revision, screens: previous.screens } : null,
        instructions: `${prepared?.record.how === 'changed' ? 'The feedback asks for a different look: apply it with the newly chosen style direction while keeping the screens and journeys.' : 'Apply feedback to the previous visual direction if provided.'} Preserve agreed scope; if feedback conflicts with requirements, return an error. Create a separate review revision, not a replacement of approved frames.` }),
      schema: { type: 'object', additionalProperties: false, required: ['projectUrl', 'screens', 'coverage', 'error'], properties: {
        projectUrl: { type: ['string', 'null'] }, error: { type: ['string', 'null'] },
        screens: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['name', 'nodeId', 'file', 'requirementKeys'], properties: {
          name: { type: 'string' }, nodeId: { type: 'string' }, file: { type: 'string' }, requirementKeys: { type: 'array', items: { type: 'string' } },
        } } }, coverage: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['key', 'screens', 'criteria', 'noScreenReason'], properties: {
          key: { type: 'string' }, screens: { type: 'array', items: { type: 'string' } }, criteria: { type: 'array', items: { type: 'string' } },
          noScreenReason: { type: ['string', 'null'] },
        } } },
      } }, timeoutMs: drawingTimeoutMs(config, provider),
      makeSession: { directory: dir, mcpConfig: config.mcpConfig, binary: makeRunnerBinary(), authDirectory: config.authDirectory, maxBudgetUsd: config.maxBudgetUsd, maxTurns: config.maxTurns, ...figmaDesignerModel(config, provider) },
    }); } finally { stopUploads(); }
    fs.writeFileSync(resultFile, JSON.stringify(result));
  }
  run.check();
  // The brief the designer worked from (its session could have changed the file); a recorded result being saved gets
  // its brief from the recorded style direction, and none is chosen now.
  if (prepared) fs.writeFileSync(path.join(dir, DESIGN_BRIEF_FILE), prepared.brief);
  const designBrief = prepared ?? await prepareDesignBrief(run, dir, kit, { prototypeJson: brief.PrototypeJson, feedback, revision: run.input.previousRevision != null, choose: false });
  const style = designBrief ? { style: styleOfRecord(designBrief.record) } : {};
  const briefText = designBrief ? { designBrief: designBrief.brief } : {};
  // Older checkpoints retain their exact metadata/hash shape during recovery.
  const enrichedArtifact = fs.existsSync(started) && JSON.parse(fs.readFileSync(started, 'utf8')).artifactVersion === 2;
  if (result.error && /workspace selection required/i.test(String(result.error))) {
    throw new JobFailure('The engine owner must choose a Figma workspace for the planner before file creation. No design was created.', 'design.figmaWorkspaceRequired');
  }
  if (result.error && /^Figma capability unavailable:/i.test(String(result.error))) {
    throw new JobFailure(String(result.error).slice(0, 240), 'design.figmaCapabilityUnavailable');
  }
  const read = (name: string) => { const f = path.join(dir, name); if (fs.lstatSync(f).isSymbolicLink() || fs.statSync(f).size > 200000) throw new Error('Invalid handoff'); return fs.readFileSync(f, 'utf8').trim(); };
  for (const name of ['recovered-empty-file.json', 'recovered-host-upload.json', 'recovered-account-access.json', 'recovered-upload-permission.json']) {
    const record = path.join(dir, name);
    if (!fs.existsSync(record)) continue;
    const expected = figmaDesignUrl(JSON.parse(fs.readFileSync(record, 'utf8')).projectUrl);
    const actual = figmaDesignUrl(result.projectUrl);
    if (!expected || !actual || new URL(actual).pathname.split('/')[2] !== new URL(expected).pathname.split('/')[2]) {
      throw new JobFailure('Recovery returned a different Figma destination. No revision was saved.', 'design.figmaInvalidResult');
    }
  }
  if (result.error && /Starter.plan MCP limit|MCP.*(?:limit|allowance)/i.test(String(result.error))) {
    if (Array.isArray(result.screens) && result.screens.length && figmaDesignUrl(result.projectUrl)) {
      const nativeReceipt = path.join(dir, 'native-frame-receipt.json');
      const receipt = JSON.parse(fs.readFileSync(fs.existsSync(nativeReceipt) ? nativeReceipt : path.join(dir, 'figma-upload-response.json'), 'utf8'));
      const ids: string[] = fs.existsSync(nativeReceipt)
        ? receipt.projectUrl === result.projectUrl && Array.isArray(receipt.nodeIds) ? receipt.nodeIds : []
        : receipt.ok && receipt.data?.success ? receipt.data.nodeIds : [];
      const exported = readScreenExports(dir, result.screens, intent.requirements.map((r) => r.key), { incomplete: true, observedNodeIds: ids, viewport: enrichedArtifact });
      const revision = createHash('sha256').update(JSON.stringify({ jobId: run.id, source, exported, reviewComplete: false })).digest('hex');
      const partial = { provider: 'figma-design', projectId: run.projectId, projectUrl: result.projectUrl, revision, source, jobId: run.id,
        previewUrl: screenPreviewPath(run.projectId, revision), screens: exported.map(({ png, ...s }: any) => s), reviewComplete: false, totalScreens: ids.length, artifactFileId: 'pending', ...style };
      if (!parseFigmaScreens(partial)) throw new JobFailure('Invalid incomplete screen preview.', 'design.figmaInvalidResult');
      const artifact = { ...partial, screens: exported, html: '', uxPlan: read('ux-plan.md'),
        designMaster: read('design-master.md'), intent, coverage: [], ...briefText };
      const stored = path.join(dir, 'partial-storage.json');
      const checkpoint = fs.existsSync(stored) ? JSON.parse(fs.readFileSync(stored, 'utf8')) : null;
      partial.artifactFileId = checkpoint?.revision === revision ? checkpoint.id : await run.putFile(`figma-screens-incomplete-${run.id}.json`, 'application/json', Buffer.from(JSON.stringify(artifact)));
      fs.writeFileSync(stored, JSON.stringify({ revision, id: partial.artifactFileId }));
      await run.update('DesignBrief', String(brief.ItemId), { PrototypeJson: JSON.stringify(partial), Status: 'draft' });
    }
    throw new JobFailure('Figma MCP request allowance was reached. Preserve the existing frames and resume their exports and visual corrections after access is restored.', 'design.figmaRateLimited');
  }
  if (result.error || !figmaDesignUrl(result.projectUrl) || !Array.isArray(result.screens) || !result.screens.length || result.screens.length > 80 || !Array.isArray(result.coverage)) {
    throw new JobFailure('Figma did not return a complete screen design and requirements mapping. Recover the recorded result before retrying.', 'design.figmaInvalidResult');
  }
  // The requirement map is checked against the intent (tolerant of how criteria were copied, strict on what is
  // covered). Its findings are kept next to the result, so a failed check can be read without another paid run.
  const keys = intent.requirements.map((r) => r.key);
  const planned = result.screens.map((s: any) => s && Array.isArray(s.requirementKeys)
    ? { ...s, requirementKeys: [...new Set(s.requirementKeys.map((k: unknown) => resolveRequirementKey(keys, k) ?? k))] } : s);
  const check = checkDesignCoverage(intent, resolveCoverageScreens(planned, result.coverage), {
    manifest: planned.filter((s: any) => s && typeof s.nodeId === 'string' && Array.isArray(s.requirementKeys)),
    screenRefs: planned.flatMap((s: any) => [s?.name, s?.nodeId, s?.file].filter((v) => typeof v === 'string')),
  });
  fs.writeFileSync(path.join(dir, 'coverage-check.json'), JSON.stringify({ ok: check.ok, problems: check.problems, ignored: check.ignored }, null, 2));
  if (!check.ok) {
    run.log(`design coverage: ${check.problems.length} problem(s), first: ${JSON.stringify(check.problems[0]).slice(0, 400)}`);
    throw new JobFailure(coverageFailureMessage(intent, check.problems), 'design.coverageIncomplete');
  }
  if (check.ignored.length) run.log(`design coverage: ${check.ignored.length} map line(s) named no acceptance criterion and were left out`);
  result.coverage = check.coverage;
  // A screen the map names for a requirement shows that requirement, even when the screen's own key list left it out.
  result.screens = planned.map((s: any) => s && Array.isArray(s.requirementKeys) ? { ...s, requirementKeys: [...new Set([...s.requirementKeys,
    ...check.coverage.filter((c) => c.screens.includes(s.nodeId)).map((c) => c.key)])] } : s);
  const noScreen = check.coverage.filter((c) => !c.screens.length)
    .map((c) => ({ key: c.key, title: (intent.requirements.find((r) => r.key === c.key)?.title ?? '').slice(0, 300), reason: String(c.noScreenReason) }));
  // The design review: every screen is scored against the brief and the house principles, and those below the bar are
  // polished in the same Figma file and checked again before anything is saved (designReview.ts). Only a job that
  // drew with this step reviews; a recorded result of an older job is saved exactly as it was.
  if (reviewWanted(started)) await reviewDesign(run, { dir, config, kit, prepared: designBrief, projectUrl: String(result.projectUrl), screens: result.screens });
  const screens = readScreenExports(dir, result.screens, keys, { viewport: enrichedArtifact });
  if (new Set(screens.map((s: any) => s.nodeId)).size !== screens.length || !result.coverage.every((c: any) => c.screens.every((id: string) => screens.some((s: any) => s.nodeId === id && s.requirementKeys.includes(c.key))))) throw new JobFailure('Coverage names missing screen frames.', 'design.figmaInvalidResult');

  const uxPlan = read('ux-plan.md'), designMaster = read('design-master.md');
  let tokens = null;
  if (enrichedArtifact && fs.existsSync(path.join(dir, 'design-tokens.json'))) {
    try { tokens = parseDesignTokens(JSON.parse(read('design-tokens.json'))); } catch { /* Optional metadata must not break recovery. */ }
    if (!tokens) run.log('design tokens: invalid optional metadata ignored; using the existing design handoff');
  }
  if (!uxPlan || !designMaster) throw new JobFailure('The design handoff is missing.', 'design.figmaMissingArtifacts');
  // Requirements without a screen are part of the revision (and its hash) only when there are any, so a revision
  // recovered from an older result keeps its exact hash.
  const withNoScreen = noScreen.length ? { noScreen } : {};
  const revision = createHash('sha256').update(JSON.stringify({ jobId: run.id, source, projectUrl: result.projectUrl, screens, uxPlan, designMaster, ...(tokens ? { tokens } : {}), ...withNoScreen })).digest('hex');
  const html = screenGallery(screens);
  const artifact = { provider: 'figma-design', projectId: run.projectId, projectUrl: result.projectUrl, revision, source, jobId: run.id, screens, coverage: result.coverage, intent, uxPlan, designMaster, html: '', ...(tokens ? { tokens } : {}), ...withNoScreen, ...style, ...briefText };
  const stored = path.join(dir, 'storage.json');
  const artifactFileId = fs.existsSync(stored) ? JSON.parse(fs.readFileSync(stored, 'utf8')).id : await run.putFile(`figma-screens-${run.id}.json`, 'application/json', Buffer.from(JSON.stringify(artifact)));
  fs.writeFileSync(stored, JSON.stringify({ id: artifactFileId }));
  // Save only the recorded exports; the preview service rebuilds the gallery from the private artifact.
  fs.writeFileSync(path.join(dir, 'preview.html'), html);
  const latest = factoryDesignSource(designIntentOf(run.p));
  if (latest !== source) throw new JobFailure('Requirements changed during design generation.', 'design.stale');
  const prototype = { provider: 'figma-design', projectId: run.projectId, projectUrl: result.projectUrl, revision, source, jobId: run.id, artifactFileId,
    previewUrl: screenPreviewPath(run.projectId, revision), screens: screens.map(({ png, ...s }: any) => s), ...withNoScreen, ...style };
  if (!parseFigmaScreens(prototype)) throw new JobFailure('Invalid screen revision.', 'design.figmaInvalidResult');
  await run.update('DesignBrief', String(brief.ItemId), { PrototypeJson: JSON.stringify(prototype), Status: 'draft' });
  finishFigmaWrite(config, operation, run.id);
  return { outputs: [`DesignBrief:${brief.ItemId}`, `StorageObject:${artifactFileId}`], message: 'Screen designs are ready in Look & feel. Review and approve this revision before development.' };
}

/** The drawing session's time limit: MF_ENGINE_FIGMA_TIMEOUT_MINUTES, else an hour on Claude (the strongest model at high
 *  effort draws carefully) and 15 minutes on Codex. A polish round gets half of it, at least 10 minutes. */
export function drawingTimeoutMs(config: Partial<Pick<FigmaEngineConfig, 'timeoutMinutes'>>, provider: string): number {
  return config.timeoutMinutes ? config.timeoutMinutes * 60_000 : provider === 'claude' ? 60 * 60_000 : 15 * 60_000;
}
export const polishTimeoutMs = (drawingMs: number): number => Math.max(10 * 60_000, Math.round(drawingMs / 2));
const REVIEW_TIMEOUT_MS = 15 * 60_000;
/** The design brief the reviewer reads with the rubric (the whole brief is in design-brief.md). */
const REVIEW_BRIEF_MAX = 30_000;

function reviewWanted(started: string): boolean {
  try { return JSON.parse(fs.readFileSync(started, 'utf8')).designReview === 1; } catch { return false; }
}

/** Reviews and polishes the drawn screens (designReview.ts), then writes the result into design-master.md. */
async function reviewDesign(run: JobRun, o: { dir: string; config: FigmaEngineConfig; kit: DesignKit; prepared: PreparedDesignBrief | null; projectUrl: string; screens: unknown }): Promise<void> {
  const screens: ReviewScreen[] = (Array.isArray(o.screens) ? o.screens : []).flatMap((s: any): ReviewScreen[] => {
    if (!s || typeof s.name !== 'string' || typeof s.nodeId !== 'string' || typeof s.file !== 'string' || !/^[A-Za-z0-9_-]+\.png$/.test(s.file)) return [];
    const png = pngInfo(path.join(o.dir, s.file));
    return png ? [{ name: s.name, nodeId: s.nodeId, file: s.file, width: png.width, height: png.height, bytes: png.bytes.length }] : [];
  });
  if (!screens.length) return;
  const provider = makeRunnerProvider();
  const prepared = o.prepared;
  let state: ReviewState;
  if (provider !== 'claude') {
    state = notReviewedState(screens, 'Not reviewed: the screen review and polishing run with the Claude designer, and this design was drawn with another runner.');
    fs.writeFileSync(path.join(o.dir, REVIEW_STATE_FILE), `${JSON.stringify(state, null, 2)}\n`);
    run.log('design review: skipped, the review runs with the Claude designer only');
  } else {
    const model = figmaDesignerModel(o.config, provider);
    const brand = brandColourOf(prepared?.facts.brand ?? []);
    const rubric = reviewRubric({ principles: o.kit.principles, style: prepared ? { name: prepared.style.name, file: prepared.style.file, text: prepared.style.text } : null,
      recipes: prepared?.recipes.length ? prepared.recipes : o.kit.recipes, brand });
    // the system prompt goes to the CLI as one argument: the brief gives way first when the house material is long
    const briefOf = (max: number) => !prepared || max <= 0 ? null : prepared.brief.length > max ? `${prepared.brief.slice(0, max)}\n\n(The brief goes on; judge content against what is shown here.)` : prepared.brief;
    const room = DESIGNER_SYSTEM_MAX_BYTES - Buffer.byteLength(reviewSystem(rubric, null)) - 1_000;
    const system = reviewSystem(rubric, briefOf(Math.min(REVIEW_BRIEF_MAX, Math.floor(room / 3))));
    const runner = makeRunner();
    const polishMs = polishTimeoutMs(drawingTimeoutMs(o.config, provider));
    state = await runDesignReview({
      dir: o.dir, screens, rubric, brand,
      review: ({ round, score, reference }) => runner({ system, prompt: reviewPrompt({ round, score, reference }), schema: REVIEW_SCHEMA,
        images: reviewImages(o.dir, score, reference), timeoutMs: REVIEW_TIMEOUT_MS, signal: run.signal, log: (l) => run.log(l), ...model }),
      polish: ({ round, screens: failing, others }) => runner({
        system: designerSystem({ kit: o.kit, prepared, withSkill: false, instructions: polishInstructions({ projectUrl: o.projectUrl, round, brand }) }),
        prompt: polishRequest({ directory: o.dir, projectUrl: o.projectUrl, round, screens: failing, others, brand }),
        schema: POLISH_SCHEMA, timeoutMs: polishMs, signal: run.signal, log: (l) => run.log(l),
        makeSession: { directory: o.dir, mcpConfig: o.config.mcpConfig, binary: makeRunnerBinary(), authDirectory: o.config.authDirectory,
          maxBudgetUsd: o.config.maxBudgetUsd, maxTurns: o.config.maxTurns, ...model },
      }),
      step: (progress, message) => run.step(progress, message),
      log: (line) => run.log(line),
      stopped: (e) => e instanceof JobGone || !!run.signal?.aborted || (e instanceof Error && e.message === 'cancelled'),
      final: (e) => e instanceof JobFailure && e.code === 'ai.capacity',
      now: () => run.iso(),
    });
  }
  writeReviewSection(o.dir, reviewSection(state, { styleName: prepared?.style.name ?? null }));
  run.check();
}
