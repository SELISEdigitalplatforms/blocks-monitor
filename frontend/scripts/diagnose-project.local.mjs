import { loadEnv } from 'vite';
import { createBlocksClient } from '@seliseblocks/client';
import { readFile } from 'node:fs/promises';
const e = loadEnv('development', process.cwd(), '');
const options = { apiUrl: e.VITE_BLOCKS_API_URL, xBlocksKey: e.MF_BLOCKS_TENANT || e.VITE_BLOCKS_PROJECT_KEY };
try {
  const auth = await createBlocksClient(options).auth.oidc.clientCredentials({ clientId: e.MF_SVC_CLIENT_ID, clientSecret: e.MF_SVC_CLIENT_SECRET });
  const client = createBlocksClient({ ...options, accessToken: auth.access_token || auth.accessToken });
  for (const name of ['Project', 'DocNote', 'Operation', 'AuditEvent']) {
    const local = JSON.parse(await readFile(`blocks/data/schemas/${name}.json`, 'utf8'));
    try {
      await client.data.collection(name, { fields: local.fields.map(f => f.name) }).list({ pageSize: 1 });
      console.log(JSON.stringify({ schema: name, read: 'ok' }));
    } catch (error) {
      console.log(JSON.stringify({ schema: name, status: error.status, keys: Object.keys(error), code: error.code }));
    }
  }
} catch (error) {
  console.log(JSON.stringify({ errorClass: error.name, status: error.status, code: error.code }));
  process.exitCode = 1;
}
