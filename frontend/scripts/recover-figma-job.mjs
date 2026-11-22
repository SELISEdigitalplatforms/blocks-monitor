import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, loadEnv } from 'vite';
const root = fileURLToPath(new URL('../', import.meta.url));
const [projectId, jobId, mode] = process.argv.slice(2);
if (![projectId, jobId].every((s) => /^[A-Za-z0-9_-]{1,64}$/.test(s ?? '')) || !['--dry-run', '--yes'].includes(mode) || process.argv.length !== 5) throw new Error('Usage: recover-figma-job.mjs <projectId> <jobId> --dry-run|--yes');
const env = { ...loadEnv('development', root, ''), ...process.env };
const server = await createServer({ configFile: false, root, logLevel: 'error', appType: 'custom', cacheDir: path.join(root, '.vite-cache', 'recover-figma-job'),
  resolve: { alias: { '@': path.join(root, 'src') } }, optimizeDeps: { noDiscovery: true, entries: [], include: [] }, server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
try {
  const { recoverScreenJob } = await server.ssrLoadModule('/server/blocks/engineWorker/recoverScreenJob.ts');
  console.log(JSON.stringify(await recoverScreenJob({ root, env, projectId, jobId, approved: mode === '--yes' }), null, 2));
} catch (error) { console.error(error instanceof Error ? error.message : 'Recovery check failed.'); process.exitCode = 1; }
finally { await server.close(); }
