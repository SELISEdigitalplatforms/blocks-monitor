// The screen design job and its requirement map: a map copied with screen references still saves the revision, a
// requirement without a screen is saved with its reason, and an incomplete map fails without saving anything while the
// recorded result stays for a re-check that needs no new model or Figma work.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JobRun } from '../../server/local/engine/run';
import { COVERAGE_FAILURE_PREFIX, designIntent, factoryDesignSource } from '../../src/domain/factoryDesign';
import { parseFigmaScreens } from '../../src/domain/figmaScreens';

const mocks = vi.hoisted(() => ({ runner: vi.fn(), reserve: vi.fn() }));
vi.mock('../../server/local/engine/ai/makeRunner.ts', () => ({ makeRunner: () => mocks.runner, makeRunnerBinary: () => 'unused', makeRunnerProvider: () => 'claude' }));
vi.mock('../../server/local/engine/ai/figmaConfig.ts', () => ({
  figmaEngineConfig: () => ({}), reserveFigmaIteration: mocks.reserve,
  assertFigmaWriteAvailable: vi.fn(), claimFigmaWrite: vi.fn(), finishFigmaWrite: vi.fn(), figmaDesignerModel: () => ({}),
  FigmaConfigurationError: class extends Error {},
}));
vi.mock('../../server/local/engine/ai/figmaUpload.ts', () => ({ startFigmaUploadBridge: () => () => {} }));
import { COVERAGE_RULES, generateFigmaScreens } from '../../server/local/engine/kinds/scope/figmaScreens';

let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'design-coverage-')); vi.clearAllMocks(); });
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6VwAAAABJRU5ErkJggg==';
const REASON = 'The staff list arrives from the HR system every night in the background; nobody works with it on a screen.';
function fixture() {
  const project = { Goal: 'Approve leave quickly' };
  const requirements = [
    { Key: 'R1', Title: 'Approve leave', Text: 'Managers approve leave.', AcceptanceCriteria: ['Approvers see all their waiting requests', 'An approver can reject a request with a comment'] },
    { Key: 'R2', Title: 'Import staff', Text: 'Staff come from the HR system.', AcceptanceCriteria: ['The organogram feed is imported every night'] },
  ];
  const source = factoryDesignSource(designIntent(project, null, requirements, []));
  const result = { projectUrl: 'https://www.figma.com/design/abc/Leave', error: null,
    screens: [{ name: '01 Requests', nodeId: '3:2', file: 'requests.png', requirementKeys: ['r1'] }],
    coverage: [
      { key: 'R1', screens: ['3:2'], criteria: ['Approvers see all their waiting requests (3:2 l…', 'AC2'], noScreenReason: null },
      { key: 'R2', screens: [], criteria: ['AC1'], noScreenReason: REASON },
    ] };
  const dir = path.join(root, 'figma-screens', 'job1');
  const putFile = vi.fn(async (..._args: unknown[]) => 'artifact1');
  const update = vi.fn(async (..._args: unknown[]) => {});
  const run = { id: 'job1', projectId: 'project1', input: { source },
    p: { project, objective: () => null, requirements: () => requirements, rows: () => [] },
    folder: () => ({ artifacts: root }), step: vi.fn(async () => {}), now: () => new Date('2026-11-05T00:00:00Z'),
    iso: () => '2026-11-05T00:00:00Z', check: vi.fn(), log: vi.fn(), putFile, update,
  } as unknown as JobRun;
  const write = () => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'requests.png'), Buffer.from(png, 'base64'));
    fs.writeFileSync(path.join(dir, 'ux-plan.md'), 'UX plan');
    fs.writeFileSync(path.join(dir, 'design-master.md'), 'Design master');
  };
  return { run, result, dir, putFile, update, write };
}

describe('screen design requirement map', () => {
  it('keeps an uncertain cancelled Figma write reserved for recovery without updating the preview', async () => {
    const t = fixture();
    const controller = new AbortController();
    Object.assign(t.run, { signal: controller.signal });
    mocks.runner.mockImplementation(async () => { controller.abort(); throw new Error('cancelled'); });
    await expect(generateFigmaScreens(t.run, { ItemId: 'brief1' })).rejects.toThrow('cancelled');
    const config = await import('../../server/local/engine/ai/figmaConfig.ts');
    expect(config.claimFigmaWrite).toHaveBeenCalled();
    expect(t.update).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(t.dir, 'started.json'))).toBe(true);
  });
  it('asks for criterion ids and an explicit reason for a requirement without a screen', async () => {
    const t = fixture();
    mocks.runner.mockImplementation(async () => { t.write(); return t.result; });
    await generateFigmaScreens(t.run, { ItemId: 'brief1' });
    const request = mocks.runner.mock.calls[0][0];
    expect(request.system).toContain(COVERAGE_RULES);
    expect(request.schema.properties.coverage.items.required).toContain('noScreenReason');
    expect(JSON.parse(request.prompt).coverageTemplate[0].criteria[1]).toEqual({ id: 'AC2', text: 'An approver can reject a request with a comment' });
  });

  it('saves a revision whose map copied criteria with screen references, keeping the requirement without a screen and its reason', async () => {
    const t = fixture();
    mocks.runner.mockImplementation(async () => { t.write(); return t.result; });
    await generateFigmaScreens(t.run, { ItemId: 'brief1' });
    const artifact = JSON.parse(Buffer.from(t.putFile.mock.calls[0][2] as Uint8Array).toString());
    expect(artifact.coverage).toEqual([
      { key: 'R1', screens: ['3:2'], criteria: ['Approvers see all their waiting requests', 'An approver can reject a request with a comment'], noScreenReason: null },
      { key: 'R2', screens: [], criteria: ['The organogram feed is imported every night'], noScreenReason: REASON },
    ]);
    expect(artifact.screens[0].requirementKeys).toEqual(['R1']);
    const prototype = JSON.parse(String((t.update.mock.calls[0][2] as { PrototypeJson: string }).PrototypeJson));
    expect(prototype.noScreen).toEqual([{ key: 'R2', title: 'Import staff', reason: REASON }]);
    expect(parseFigmaScreens(prototype)).not.toBeNull();
    expect(JSON.parse(fs.readFileSync(path.join(t.dir, 'coverage-check.json'), 'utf8'))).toMatchObject({ ok: true, problems: [] });
  });

  it('fails an incomplete map plainly without saving, and re-checks the recorded result without another model run', async () => {
    const t = fixture();
    const incomplete = { ...t.result, coverage: [t.result.coverage[0], { key: 'R2', screens: [], criteria: ['AC1'], noScreenReason: null }] };
    mocks.runner.mockImplementation(async () => { t.write(); return incomplete; });
    const failure = await generateFigmaScreens(t.run, { ItemId: 'brief1' }).catch((e) => e);
    expect(failure).toMatchObject({ code: 'design.coverageIncomplete' });
    expect(failure.message).toBe(`${COVERAGE_FAILURE_PREFIX}"Import staff" has no screen and no reason why none is needed.`);
    expect(failure.message.length).toBeLessThanOrEqual(200);
    expect(t.putFile).not.toHaveBeenCalled();
    expect(t.update).not.toHaveBeenCalled();
    expect(JSON.parse(fs.readFileSync(path.join(t.dir, 'coverage-check.json'), 'utf8')).problems).toEqual([{ kind: 'noScreens', key: 'R2' }]);
    // The same job, re-queued after its recorded map was corrected, is checked again without drawing again (the screens
    // that were never reviewed are reviewed now: the map failed before the review started).
    fs.writeFileSync(path.join(t.dir, 'result.json'), JSON.stringify(t.result));
    const scores = { colour: 9, composition: 9, typography: 9, space: 9, hierarchy: 9, consistency: 9, content: 9, craft: 9, accessibility: 9 };
    const counts = { supportHues: 0, nestedBoxes: 0, truncatedTexts: 0, blocks: 3 };
    mocks.runner.mockImplementation(async () => ({ screens: [{ file: 'requests.png', verdict: 'Ready.', counts, accent: '#123456', onBrand: true, scores, ship: true, fixes: [] }] }));
    await generateFigmaScreens(t.run, { ItemId: 'brief1' });
    const drawings = mocks.runner.mock.calls.filter(([req]) => req.schema.properties.coverage);
    expect(drawings).toHaveLength(1);
    expect(mocks.runner.mock.calls.filter(([req]) => req.images)).toHaveLength(1);
    expect(t.update).toHaveBeenCalledTimes(1);
  });

  it('still fails when a criterion is missing from the map', async () => {
    const t = fixture();
    const missing = { ...t.result, coverage: [{ ...t.result.coverage[0], criteria: ['AC1'] }, t.result.coverage[1]] };
    mocks.runner.mockImplementation(async () => { t.write(); return missing; });
    await expect(generateFigmaScreens(t.run, { ItemId: 'brief1' })).rejects.toMatchObject({ code: 'design.coverageIncomplete',
      message: `${COVERAGE_FAILURE_PREFIX}"Approve leave" leaves out "An approver can reject a request with a comment".` });
    expect(t.update).not.toHaveBeenCalled();
  });
});

