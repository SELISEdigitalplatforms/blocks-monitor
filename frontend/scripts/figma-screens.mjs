// One explicitly requested project revision through the existing local engine, without a queue consumer.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, loadEnv } from 'vite';
const root = fileURLToPath(new URL('../', import.meta.url));
const [projectId, mode] = process.argv.slice(2);
const resume = process.argv[4] === '--resume';
if (!/^[A-Za-z0-9_-]{1,64}$/.test(projectId ?? '') || !['--dry-run', '--yes'].includes(mode) || process.argv.length !== (resume ? 5 : 4) || (resume && mode !== '--yes')) throw new Error('Usage: node scripts/figma-screens.mjs <projectId> --dry-run|--yes [--resume]');
const env = { ...loadEnv('development', root, ''), ...process.env };
for (const [key, value] of Object.entries(env)) if (process.env[key] === undefined) process.env[key] = value;
Object.assign(process.env, { MF_BLOCKS_PROVISIONING_ENABLED: 'false', MF_ENGINE_ROOT: path.join(root, 'data', 'local-planner', 'engine-root') });
if (resume) {
  const { readFileSync } = await import('node:fs');
  const checkpoint = JSON.parse(readFileSync(path.join(root, 'data', 'local-planner', 'figma-screens.json'), 'utf8'));
  if (checkpoint.projectId !== projectId || checkpoint.state !== 'failed') throw new Error('Only the recorded failed project job may be resumed.');
  process.env.MF_ENGINE_FIGMA_RESUME_JOB = checkpoint.jobId;
}
const server = await createServer({ configFile: false, root, logLevel: 'error', appType: 'custom', cacheDir: path.join(root, '.vite-cache', 'figma-screens'),
  resolve: { alias: { '@': path.join(root, 'src') } }, optimizeDeps: { noDiscovery: true, entries: [], include: [] }, server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
try {
  const { runFactoryRevision } = await server.ssrLoadModule('/server/blocks/engineWorker/factoryDesignRun.ts');
  console.log(JSON.stringify(await runFactoryRevision({ root, env, projectId, approved: mode === '--yes', workflow: 'screens',
    feedback: 'Create professional native Figma Design screens from the complete recorded requirements using the embedded planner UI/UX skill. Preserve agreed scope and supplied brand references. Export all screen previews for Look & feel and prepare the development handoff. Do not approve the design or publish a website.' }), null, 2));
} catch (error) { console.error(error instanceof Error ? error.message : 'Figma screen generation failed.'); process.exitCode = 1; }
finally { await server.close(); }
