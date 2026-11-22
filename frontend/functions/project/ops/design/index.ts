// Design area of mf-project. DESIGN_OPS holds the defineOp-made ops that functions/_lib's build discovers.
import type { LaneOp } from '../requirements/ports';
import { toDefinedOps } from '../requirements/bind';
import { confirmDesignBrief, saveDesignBrief } from './brief';
import { commitSample, deleteSample, presignSample, sampleUrl } from './samples';
import { generateDesign } from './generate';
import { designContext } from './context';
import { designPreview } from './preview';

/** The lane ops by name (kept for the unit tests). */
export const LANE_OPS: Record<string, LaneOp> = {
  'designBrief.save': saveDesignBrief,
  'designBrief.confirm': confirmDesignBrief,
  'designBrief.generate': generateDesign,
  'sample.presign': presignSample,
  'sample.commit': commitSample,
  'sample.url': sampleUrl,
  'sample.delete': deleteSample,
};
export const DESIGN_OPS = [...toDefinedOps(LANE_OPS), designContext, designPreview];
