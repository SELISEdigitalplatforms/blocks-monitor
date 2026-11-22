import fs from 'node:fs';
import path from 'node:path';
import { bootstrapService } from './privateMakeImport';
import { makeRecoveryClaim } from './makeRecovery';
import { figmaDesignUrl } from '../../../src/domain/figmaScreens';

/** Resume only a known failed upload with an explicitly recorded empty Figma destination. */
export async function recoverScreenJob(o: { root: string; env: Record<string, string | undefined>; projectId: string; jobId: string; approved: boolean }) {
  const service = await bootstrapService(o);
  const job = service.store.get('EngineJob', o.jobId);
  const workerId = o.env.MF_ENGINE_WORKER_ID || o.env.MF_FIGMA_DESIGN_WORKER_ID || o.env.MF_FACTORY_DESIGN_WORKER_ID;
  if (!job || job.ProjectId !== o.projectId || job.Kind !== 'design.generate' || job.Status !== 'failed' || job.ClaimedBy !== workerId) throw new Error('The requested job is not a failed job of the configured screen designer.');
  if (JSON.parse(String(job.InputJson)).workflow !== 'screens') throw new Error('Not a native screen-design job.');
  if (service.store.rows('EngineJob').some((j) => j.ProjectId === o.projectId && j.Kind === 'design.generate' && ['queued', 'claimed', 'running'].includes(String(j.Status)))) throw new Error('Another design job is active.');
  const directory = path.join(o.env.MF_ENGINE_ROOT || path.join(o.root, 'data', 'figma-designer', 'engine-root'), 'projects', String(job.WorkspaceId), o.projectId, 'artifacts', 'figma-screens', o.jobId);
  const result = JSON.parse(fs.readFileSync(path.join(directory, 'result.json'), 'utf8').replace(/^\uFEFF/, ''));
  const previewOnly = /MCP.*limit/i.test(String(result.error)) && result.screens?.length > 0;
  if ((!previewOnly && (!/could not resolve mcp\.figma\.com/i.test(String(result.error)) || result.screens?.length !== 0)) || !figmaDesignUrl(result.projectUrl)) throw new Error('The saved result does not establish a recoverable upload or exported preview.');
  if (!previewOnly && fs.existsSync(path.join(directory, 'recovered-host-upload.json'))) throw new Error('This recovery was already started; inspect its records instead of repeating it.');
  const summary = { projectId: o.projectId, jobId: o.jobId, destination: result.projectUrl, workflow: 'screens', createsAnotherFile: false, previewOnly };
  if (!o.approved) return { ...summary, dryRun: true };
  await service.raw.update('EngineJob', o.jobId, { ...makeRecoveryClaim(String(job.TargetId), new Date()), Message: 'Recovering the existing Figma file using the host upload service.' });
  return { ...summary, state: 'claimed', designApproved: false };
}
