import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { readScreenExports } from '../../server/local/engine/ai/screenArtifacts';
let dir: string;
const row = { name: 'Orders', nodeId: '1:2', file: 'screen.png', requirementKeys: ['R-1'] };
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'screen-artifact-test-'));
  fs.writeFileSync(path.join(dir, 'screen.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6VwAAAABJRU5ErkJggg==', 'base64'));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
it('reads complete mapped exports and explicitly permits incomplete unmapped previews', () => {
  expect(readScreenExports(dir, [row], ['R-1'])[0].nodeId).toBe('1:2');
  expect(() => readScreenExports(dir, [{ ...row, requirementKeys: [] }], ['R-1'])).toThrow();
  expect(readScreenExports(dir, [{ ...row, requirementKeys: [] }], ['R-1'], { incomplete: true, observedNodeIds: ['1:2'] })).toHaveLength(1);
});
it('derives opt-in viewport metadata from PNG bytes without changing legacy export shapes', () => {
  expect(readScreenExports(dir, [row], ['R-1'])[0]).not.toHaveProperty('viewport');
  const claimed = { ...row, viewport: { width: 1440, height: 1000 } };
  expect(readScreenExports(dir, [claimed], ['R-1'], { viewport: true })[0].viewport).toEqual({ width: 1, height: 1 });
});
it('rejects traversal, duplicate frames, unknown requirements and unobserved frames', () => {
  expect(() => readScreenExports(dir, [{ ...row, file: '../screen.png' }], ['R-1'])).toThrow();
  expect(() => readScreenExports(dir, [row, row], ['R-1'])).toThrow();
  expect(() => readScreenExports(dir, [row], ['R-2'])).toThrow();
  expect(() => readScreenExports(dir, [row], ['R-1'], { observedNodeIds: ['2:2'] })).toThrow();
});
it('rejects non-PNG bytes and invalid image dimensions', () => {
  fs.writeFileSync(path.join(dir, 'screen.png'), '<html>not a PNG</html>');
  expect(() => readScreenExports(dir, [row], ['R-1'])).toThrow();
});
