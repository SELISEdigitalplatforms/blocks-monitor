import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { JobRun } from '../../server/local/engine/run';
import { designIntent, factoryDesignSource } from '../../src/domain/factoryDesign';

const mocks = vi.hoisted(() => ({ runner: vi.fn(), reserve: vi.fn(), provider: vi.fn(() => 'codex') }));
vi.mock('../../server/local/engine/ai/makeRunner.ts', () => ({ makeRunner: () => mocks.runner, makeRunnerBinary: () => 'unused', makeRunnerProvider: mocks.provider }));
vi.mock('../../server/local/engine/ai/figmaConfig.ts', () => ({
  figmaEngineConfig: () => ({}), reserveFigmaIteration: mocks.reserve,
  assertFigmaWriteAvailable: vi.fn(), claimFigmaWrite: vi.fn(), finishFigmaWrite: vi.fn(), figmaDesignerModel: () => ({}),
  FigmaConfigurationError: class extends Error {},
}));
vi.mock('../../server/local/engine/ai/figmaUpload.ts', () => ({ startFigmaUploadBridge: () => () => {} }));
import { generateFigmaScreens } from '../../server/local/engine/kinds/scope/figmaScreens';

let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'native-design-compat-')); vi.clearAllMocks(); mocks.provider.mockReturnValue('codex'); });
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6VwAAAABJRU5ErkJggg==';
const tokens = { version: 1, colors: { primary: '#123456' }, fontFamily: { body: 'Inter' }, fontSize: { body: '1rem' }, spacing: { control: '8px' }, borderRadius: { control: '4px' } };
function fixture() {
  const project = { Goal: 'Manage requests' };
  const requirements = [{ Key: 'R1', Title: 'Requests', Text: 'List requests', AcceptanceCriteria: ['Requests are visible'] }];
  const source = factoryDesignSource(designIntent(project, null, requirements, []));
  const result = { projectUrl: 'https://www.figma.com/design/abc/Requests', error: null,
    screens: [{ name: 'Requests', nodeId: '1:2', file: 'screen.png', requirementKeys: ['R1'] }],
    coverage: [{ key: 'R1', screens: ['1:2'], criteria: ['Requests are visible'] }] };
  const dir = path.join(root, 'figma-screens', 'job1');
  const putFile = vi.fn(async (..._args: unknown[]) => 'artifact1');
  const update = vi.fn(async (..._args: unknown[]) => {});
  const run = { id: 'job1', projectId: 'project1', input: { source },
    p: { project, objective: () => null, requirements: () => requirements, rows: () => [] },
    folder: () => ({ artifacts: root }), step: vi.fn(async () => {}), now: () => new Date('2026-11-03T00:00:00Z'),
    iso: () => '2026-11-03T00:00:00Z', check: vi.fn(), log: vi.fn(), putFile, update,
  } as unknown as JobRun;
  const write = (metadata?: unknown) => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'screen.png'), Buffer.from(png, 'base64'));
    fs.writeFileSync(path.join(dir, 'ux-plan.md'), 'UX plan');
    fs.writeFileSync(path.join(dir, 'design-master.md'), 'Design master');
    if (metadata !== undefined) fs.writeFileSync(path.join(dir, 'design-tokens.json'), JSON.stringify(metadata));
  };
  return { run, source, result, dir, putFile, update, write };
}

it.each(['codex', 'claude'].flatMap(provider => [undefined, tokens, { version: 99 }].map(metadata => ({ provider, metadata }))))('generates a complete native revision with provider and tokens %j', async ({ provider, metadata }) => {
  mocks.provider.mockReturnValue(provider);
  const t = fixture();
  // the design review answers a passing score for every screen it sees (the Claude designer only)
  const scores = { colour: 9, composition: 9, typography: 9, space: 9, hierarchy: 9, consistency: 9, content: 9, craft: 9, accessibility: 9 };
  const counts = { supportHues: 0, nestedBoxes: 0, truncatedTexts: 0, blocks: 3 };
  mocks.runner.mockImplementation(async (req: any) => req.images
    ? { screens: [{ file: 'screen.png', verdict: 'Ready.', counts, accent: '#123456', onBrand: true, scores, ship: true, fixes: [] }] }
    : (t.write(metadata), t.result));
  await generateFigmaScreens(t.run, { ItemId: 'brief1' });
  expect(mocks.runner).toHaveBeenCalledTimes(provider === 'claude' ? 2 : 1);
  if (provider === 'claude') expect(mocks.runner.mock.calls[1][0].images).toHaveLength(1);
  const system = mocks.runner.mock.calls[0][0].system;
  expect(system).toContain(provider === 'claude' ? 'drawn with use_figma' : 'native editable layers with html_to_figma');
  expect(system).toContain(provider === 'claude' ? 'ReadMcpResourceTool' : 'get_figma_skill');
  expect(system).toContain('native-frame-receipt.json');
  const artifact = JSON.parse(Buffer.from(t.putFile.mock.calls[0][2] as Uint8Array).toString());
  expect(artifact.screens[0].viewport).toEqual({ width: 1, height: 1 });
  expect(artifact.tokens).toEqual(metadata === tokens ? tokens : undefined);
  expect(t.update.mock.calls[0][2]).toMatchObject({ Status: 'draft' });
});

it('reports missing native capabilities specifically without saving a fabricated preview', async () => {
  const t = fixture();
  mocks.runner.mockResolvedValue({ projectUrl: null, screens: [], coverage: [], error: 'Figma capability unavailable: PNG export' });
  await expect(generateFigmaScreens(t.run, { ItemId: 'brief1' })).rejects.toMatchObject({ code: 'design.figmaCapabilityUnavailable' });
  expect(t.putFile).not.toHaveBeenCalled();
  expect(t.update).not.toHaveBeenCalled();
});

it('resumes an interrupted native revision in its recorded file', async () => {
  const t = fixture(); t.write();
  fs.writeFileSync(path.join(t.dir, 'started.json'), JSON.stringify({ source: t.source, jobId: 'job1', artifactVersion: 2 }));
  fs.writeFileSync(path.join(t.dir, 'native-frame-receipt.json'), JSON.stringify({ projectUrl: t.result.projectUrl, nodeIds: ['1:2'] }));
  mocks.runner.mockResolvedValue(t.result);
  await generateFigmaScreens(t.run, { ItemId: 'brief1' });
  const system = mocks.runner.mock.calls[0][0].system;
  expect(system).toContain(`RECOVERY: Reuse only the recorded file ${t.result.projectUrl}`);
  expect(system).toContain('Do not restart planning, redraw the revision');
  expect(t.update).toHaveBeenCalled();
});

it('recovers an old checkpoint without new model calls, token adoption or revision-hash changes', async () => {
  const t = fixture(); t.write(tokens);
  fs.writeFileSync(path.join(t.dir, 'started.json'), JSON.stringify({ source: t.source, jobId: 'job1' }));
  fs.writeFileSync(path.join(t.dir, 'result.json'), JSON.stringify(t.result));
  const screens = [{ name: 'Requests', nodeId: '1:2', requirementKeys: ['R1'], png }];
  const revision = createHash('sha256').update(JSON.stringify({ jobId: 'job1', source: t.source,
    projectUrl: t.result.projectUrl, screens, uxPlan: 'UX plan', designMaster: 'Design master' })).digest('hex');
  await generateFigmaScreens(t.run, { ItemId: 'brief1' });
  expect(mocks.runner).not.toHaveBeenCalled();
  expect(mocks.reserve).not.toHaveBeenCalled();
  const artifact = JSON.parse(Buffer.from(t.putFile.mock.calls[0][2] as Uint8Array).toString());
  expect(artifact.revision).toBe(revision);
  expect(artifact.tokens).toBeUndefined();
  expect(artifact.screens[0]).not.toHaveProperty('viewport');
});

