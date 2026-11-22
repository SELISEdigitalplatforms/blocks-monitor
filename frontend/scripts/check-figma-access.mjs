// Read-only check through the planner's exact runner identity; no credential files or design writes.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';
import { figmaEngineConfig } from '../server/local/engine/ai/figmaConfig.ts';
import { makeRunner, makeRunnerBinary, makeRunnerProvider } from '../server/local/engine/ai/makeRunner.ts';
const fileKey = process.argv[2];
if (!/^[A-Za-z0-9_-]{1,128}$/.test(fileKey ?? '')) throw new Error('Provide an existing Figma Design file key.');
const root = fileURLToPath(new URL('../', import.meta.url));
const env = { ...loadEnv('development', root, ''), ...process.env };
for (const [key, value] of Object.entries(env)) if (process.env[key] === undefined) process.env[key] = value;
const config = figmaEngineConfig(env);
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'figma-access-'));
try {
  const result = await makeRunner(env)({
    system: 'Perform only read-only Figma access diagnostics. Never write, create, update, export, publish or upload. Never return identity, email, tokens, signed URLs or credentials. No shell or browser actions.',
    prompt: `Use official Figma whoami to report plan/seat types only (no names or identifiers). Then call get_metadata for fileKey ${fileKey}, nodeId 0:1, once to check the existing frame inventory. Report readable only on a successful actual read. Report rate_limited only on an explicit provider rate-limit response; access_denied on a permission response; otherwise unavailable. Do not infer permissions or quota from login alone. Do not invent a remaining request count or reset date. Do not retry or perform any additional reads.`,
    schema: { type: 'object', additionalProperties: false, required: ['authorization', 'planTypes', 'seatTypes', 'fileAccess', 'frameCount', 'detail'], properties: {
      authorization: { type: 'string', enum: ['ready', 'unavailable'] }, planTypes: { type: 'array', items: { type: 'string' } },
      seatTypes: { type: 'array', items: { type: 'string' } }, fileAccess: { type: 'string', enum: ['readable', 'access_denied', 'rate_limited', 'unavailable'] },
      frameCount: { type: ['integer', 'null'] }, detail: { type: 'string' },
    } }, timeoutMs: 120000,
    makeSession: { directory, mcpConfig: config.mcpConfig, binary: makeRunnerBinary(env), authDirectory: config.authDirectory,
      readOnly: true, inspectCapabilities: true, maxBudgetUsd: 0.5, maxTurns: 4 },
  });
  console.log(JSON.stringify({ runner: makeRunnerProvider(env), ...result }, null, 2));
  if (result.fileAccess !== 'readable') process.exitCode = 1;
} catch { console.error('Figma access check could not complete; no designs were changed.'); process.exitCode = 1; }
finally { fs.rmSync(directory, { recursive: true, force: true }); }
