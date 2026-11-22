// Directions are planner-owned. The team reviews and approves a current Figma Make revision.
import { defineLaneOp, OpError, addChanged, argString } from '../requirements/ports';
import { loadDesignBrief, loadRequirements } from '../requirements/loaders';
import { wire } from '../requirements/records';
import { automaticDesignDirection, designSource, parseMakePrototype, rawDesignRequirements } from '../../../../src/domain/figmaMake';
import { designSourceCurrent, parseProductPrototype } from '../../../../src/domain/factoryDesign';
import { loadDesignSources } from './context';

export const saveDesignBrief = defineLaneOp({
  op: 'designBrief.save',
  permission: 'design.edit',
  requireOpenStep: true,
  parse(raw: any) { return { projectId: argString(raw, 'projectId') }; },
  async run() {
    throw new OpError('invalid_input', 'design.plannerOwned');
  },
});

export const confirmDesignBrief = defineLaneOp({
  op: 'designBrief.confirm',
  permission: 'design.edit',
  requireOpenStep: true,
  prefetch: (env: any) => Promise.all([loadDesignBrief(env), loadRequirements(env)]),
  parse(raw: any) { return { projectId: argString(raw, 'projectId') }; },
  async run(ctx: any) {
    const [row, rows] = await Promise.all([loadDesignBrief(ctx), loadRequirements(ctx)]);
    const requirements = rawDesignRequirements(rows);
    const candidate = parseProductPrototype(row?.PrototypeJson);
    const factory = candidate?.provider !== 'figma-make' ? candidate : null;
    const prototype = factory ?? parseMakePrototype(row?.PrototypeJson);
    const sources = factory ? await loadDesignSources(ctx.db, ctx.project.id) : { source: designSource(automaticDesignDirection(requirements), requirements) };
    if (!row || row.Mode !== 'figma' || !requirements.length || !prototype || !designSourceCurrent(prototype.source, sources) || (prototype.provider === 'figma-design' && prototype.reviewComplete === false)) {
      throw new OpError('invalid_input', 'design.notConfirmable', { reason: 'prototype_stale' });
    }
    const alreadyConfirmed = row.Status === 'confirmed';
    const updated = alreadyConfirmed ? row : await ctx.db.update('DesignBrief', row.ItemId, {
      Status: 'confirmed', ConfirmedByUserId: ctx.actorUserId, ConfirmedAt: ctx.now.toISOString(),
    });
    const changed: any = {};
    addChanged(changed, 'DesignBrief', wire(updated));
    ctx.deps.audit?.({ targetType: 'design-brief', targetId: row.ItemId, details: { mode: 'figma', status: 'confirmed', revision: prototype.revision, source: prototype.source } });
    return { alreadyConfirmed, changed };
  },
});
