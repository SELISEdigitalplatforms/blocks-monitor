// One native-screen planner for all local MADP projects, with an identity separate from legacy engines.
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';
import fs from 'node:fs';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const env = { ...loadEnv('development', root, ''), ...process.env };
const workerId = env.MF_ENGINE_WORKER_ID || env.MF_FIGMA_DESIGN_WORKER_ID || env.MF_FACTORY_DESIGN_WORKER_ID || `madp-figma-${os.hostname().replace(/[^A-Za-z0-9-]/g, '').slice(0, 40)}`;
if (!/^[A-Za-z0-9_-]{1,100}$/.test(workerId) || workerId === env.MF_EXTRACTION_WORKER_ID) throw new Error('Configure a valid, distinct Figma worker identity.');
const hostDir = path.resolve(env.ENGINE_HOST_DIR || path.join(root, 'data', 'figma-designer', 'host'));
fs.mkdirSync(hostDir, { recursive: true });
const cutoffFile = path.join(hostDir, 'engine-since.txt');
const since = env.ENGINE_SINCE || (fs.existsSync(cutoffFile) ? fs.readFileSync(cutoffFile, 'utf8').trim() : new Date().toISOString());
if (!Number.isFinite(Date.parse(since))) throw new Error('ENGINE_SINCE must be an ISO timestamp.');
if (!fs.existsSync(cutoffFile)) fs.writeFileSync(cutoffFile, `${since}\n`, { flag: 'wx' });
Object.assign(process.env, { MF_ENGINE_WORKER_ID: workerId, MF_ENGINE_PROJECT_IDS: env.MF_ENGINE_PROJECT_IDS || '', MF_ENGINE_JOB_KINDS: env.MF_ENGINE_JOB_KINDS || 'design.generate,docs.generate',
  MF_ENGINE_EXCLUDED_JOB_KINDS: [env.MF_ENGINE_EXCLUDED_JOB_KINDS, 'engine.skills-sync'].filter(Boolean).join(','),
  MF_ENGINE_DESIGN_WORKFLOW: 'screens', MF_ENGINE_READ_ONLY: env.MF_ENGINE_READ_ONLY || '0', MF_BLOCKS_PROVISIONING_ENABLED: 'false',
  ENGINE_SINCE: since,
  ENGINE_HOST_DIR: hostDir,
  MF_ENGINE_ROOT: path.resolve(env.MF_ENGINE_ROOT || path.join(root, 'data', 'figma-designer', 'engine-root')),
});
await import('./start.mjs');
