import { expect, it } from 'vitest';
import { makeRunnerBinary, makeRunnerProvider } from '../../server/local/engine/ai/makeRunner';

it('keeps an explicit Figma runner independent of an absolute general engine binary', () => {
  const env = { AI_RUNNER: '/opt/general/claude', AI_RUNNER_BINARY: '/opt/general/claude', MF_ENGINE_FIGMA_RUNNER: 'codex' };
  expect(makeRunnerProvider(env)).toBe('codex');
  expect(makeRunnerBinary(env)).not.toBe('/opt/general/claude');
  expect(makeRunnerBinary({ ...env, MF_ENGINE_FIGMA_BINARY: '/opt/figma/codex' })).toBe('/opt/figma/codex');
});
