import fs from 'node:fs';
import path from 'node:path';
import { JobFailure } from '../run';

export interface ExportedScreen { name: string; nodeId: string; requirementKeys: string[]; png: string; viewport?: { width: number; height: number } }
/** One boundary for complete and incomplete exports; never trust model-supplied paths or image bytes. */
export function readScreenExports(directory: string, rows: unknown, requirementKeys: readonly string[], options: { incomplete?: boolean; observedNodeIds?: readonly string[]; viewport?: boolean } = {}): ExportedScreen[] {
  const invalid = () => new JobFailure('Screen exports have invalid metadata, paths, PNG bytes or size.', 'design.figmaInvalidResult');
  if (!Array.isArray(rows) || !rows.length || rows.length > 80) throw invalid();
  let total = 0;
  const ids = new Set<string>();
  return rows.map((s: any) => {
    if (!s || typeof s.name !== 'string' || !s.name.trim() || s.name.length > 200 || !/^\d+:\d+$/.test(s.nodeId) || ids.has(s.nodeId) ||
      (options.observedNodeIds && !options.observedNodeIds.includes(s.nodeId)) || typeof s.file !== 'string' || !/^[A-Za-z0-9_-]+\.png$/.test(s.file) ||
      !Array.isArray(s.requirementKeys) || (!options.incomplete && !s.requirementKeys.length) || !s.requirementKeys.every((k: unknown) => typeof k === 'string' && requirementKeys.includes(k))) throw invalid();
    ids.add(s.nodeId);
    let bytes: Buffer;
    try {
      const file = path.join(directory, s.file), stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 5 * 1024 * 1024) throw invalid();
      bytes = fs.readFileSync(file);
    } catch { throw invalid(); }
    total += bytes.length;
    if (total > 15 * 1024 * 1024 || bytes.length < 24 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' ||
      bytes.readUInt32BE(16) < 1 || bytes.readUInt32BE(16) > 20000 || bytes.readUInt32BE(20) < 1 || bytes.readUInt32BE(20) > 100000) throw invalid();
    // Dimensions come from exported bytes, not the model's claimed viewport.
    return { name: s.name, nodeId: s.nodeId, requirementKeys: s.requirementKeys, png: bytes.toString('base64'),
      ...(options.viewport ? { viewport: { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) } } : {}) };
  });
}
