import { describe, expect, it } from 'vitest';
import { JobRun } from '../../server/local/engine/run.ts';
import { makeWorld } from './harness';
import { createJobs } from '../../functions/_lib/jobs';
import { bindIds } from '../../functions/_lib/ids';

describe('preview build-host affinity', () => {
  it('keeps a normal delivery retry on its original host and counts the next attempt once', async () => {
    const world = await makeWorld();
    world.engine.stop();
    try {
      const project = world.project('Driver Delivery App');
      const id = String(world.rows('EngineJob', String(project.ItemId)).find((job) => job.Kind === 'build.run' && ['queued', 'claimed', 'running'].includes(String(job.Status)))!.ItemId);
      await world.gw.update('EngineJob', id, { Status: 'failed', Attempts: 1, ClaimedBy: 'local-worker', ActiveKey: id });
      const jobs = createJobs({ gw: world.gw as never, raw: world.gw, workspaceId: String(project.WorkspaceId),
        caller: { userId: String(project.CreatedByUserId) }, now: world.now,
        ids: bindIds({ fn: 'project', op: 'job.retry', requestId: 'retry-host' }) });
      await jobs.retry(id);
      expect(world.get('EngineJob', id)).toMatchObject({ Status: 'claimed', Attempts: 2, ClaimedBy: 'local-worker' });
    } finally { world.close(); }
  });
  it('reserves a build preview for the host holding its compiled files', async () => {
    const world = await makeWorld();
    world.engine.stop();
    try {
      const project = world.project('Driver Delivery App');
      const jobId = String(world.rows('EngineJob', String(project.ItemId)).find((job) => job.Kind === 'build.run')!.ItemId);
      await world.gw.update('EngineJob', jobId, { Status: 'running', Attempts: 1, ClaimedBy: 'local-worker' });
      const run = new JobRun({ store: world.store, gateway: world.gw, config: () => world.config, now: world.now,
        log: () => {}, sleep: async () => {}, projectFolder: () => { throw new Error('Not used by queuing'); } },
        world.get('EngineJob', jobId), new AbortController().signal);
      const previewId = await run.queueJob({ kind: 'preview.deploy', input: { projectId: project.ItemId, version: '0.2.0' }, target: { type: 'milestone', id: 'milestone-two' }, requestKey: 'preview:host-affinity' });
      expect(world.get('EngineJob', previewId)).toMatchObject({ Status: 'claimed', Attempts: 1, ClaimedBy: 'local-worker' });
    } finally { world.close(); }
  });
});
