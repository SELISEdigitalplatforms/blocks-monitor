import { defineLaneOp, OpError, addChanged, argString } from '../requirements/ports';
import { loadDesignBrief, loadRequirements } from '../requirements/loaders';
import { wire } from '../requirements/records';
import { automaticDesignDirection, designSource, rawDesignRequirements } from '../../../../src/domain/figmaMake';
import { factoryDesignSource, parseProductPrototype } from '../../../../src/domain/factoryDesign';
import { loadDesignIntent } from './context';

/** A step action, never generic client-built EngineJob input. Provider writes happen only on the owner engine. */
export const generateDesign = defineLaneOp({
  op: 'designBrief.generate',
  permission: 'design.edit',
  requireOpenStep: true,
  prefetch: (env: any) => Promise.all([loadDesignBrief(env), loadRequirements(env)]),
  parse(raw: any) {
    const feedback = raw?.feedback ?? '';
    if (typeof feedback !== 'string' || feedback.length > 4000) {
      throw new OpError('invalid_input', 'input.invalid', { field: 'feedback' });
    }
    const workflow = raw?.workflow ?? 'figma';
    if (!['screens', 'figma', 'factory'].includes(workflow)) throw new OpError('invalid_input', 'input.invalid', { field: 'workflow' });
    return { projectId: argString(raw, 'projectId'), feedback: feedback.trim(), workflow };
  },
  async run(ctx: any, args: any) {
    const [found, rows] = await Promise.all([loadDesignBrief(ctx), loadRequirements(ctx)]);
    const requirements = rawDesignRequirements(rows);
    if (!requirements.length) {
      throw new OpError('invalid_input', 'design.notConfirmable', { reason: 'no_requirements' });
    }
    const instructions = automaticDesignDirection(requirements);
    const brief = found ?? await ctx.db.insert('DesignBrief', { ProjectId: ctx.project.id, Mode: 'figma', Instructions: instructions, SampleFileIds: [], Status: 'draft' });
    const previous = parseProductPrototype(brief.PrototypeJson);
    if (previous && !previous.source.startsWith('pending:') && !args.feedback) throw new OpError('invalid_input', 'design.feedbackRequired');
    const intent = args.workflow !== 'figma' ? await loadDesignIntent(ctx.db, ctx.project.id) : null;
    const source = intent ? factoryDesignSource(intent) : designSource(instructions, requirements);
    const { job: queued, created } = await ctx.deps.jobs.create({
      workspaceId: ctx.workspaceId, projectId: ctx.project.id, kind: 'design.generate',
      targetKey: brief.ItemId, actorUserId: ctx.actorUserId,
      input: { projectId: ctx.project.id, designBriefId: brief.ItemId, source, feedback: args.feedback, workflow: args.workflow, ...(intent ? { intent } : {}),
        requirementKeys: requirements.map((r) => r.key), previousRevision: previous?.revision ?? null, requestType: previous ? 'design-change' : 'initial-design' },
    });
    const job = created ? queued : (await ctx.db.find('EngineJob', { ItemId: queued.ItemId, ProjectId: ctx.project.id }, { limit: 1 }))[0];
    // A legacy screenshot job may still own this brief's active key. Do not present it as a Make request or
    // switch its brief underneath the running writer. The page will reconcile after it finishes.
    if (!created) {
      let input: any;
      try { input = typeof job.InputJson === 'string' ? JSON.parse(job.InputJson) : job.InputJson; } catch { /* invalid legacy input */ }
      if (!input?.source) throw new OpError('conflict', 'design.previousJobRunning');
    }
    const updated = await ctx.db.update('DesignBrief', brief.ItemId, {
      Status: 'draft',
      Mode: 'figma', Instructions: instructions,
      // Retain the prior reference for refinement, but do not let an in-flight replacement be approved.
      ...(previous ? { PrototypeJson: JSON.stringify({ ...previous, source: `pending:${job.ItemId}` }) } : {}),
    });
    const changed: any = {};
    addChanged(changed, 'EngineJob', wire(job));
    addChanged(changed, 'DesignBrief', wire(updated));
    ctx.deps.audit({ targetType: 'engine-job', targetId: job.ItemId, details: { kind: 'design.generate', existing: !created } });
    return { jobId: job.ItemId, created, changed };
  },
});
