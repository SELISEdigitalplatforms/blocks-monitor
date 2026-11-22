import fs from 'node:fs';
import { loadEnv } from 'vite';
import { createBlocksClient } from '@seliseblocks/client';
const id = '78116837-5117-43b8-a2a3-d1da300a3165';
const env = loadEnv('development', process.cwd(), '');
const options = { apiUrl: env.VITE_BLOCKS_API_URL, xBlocksKey: env.MF_BLOCKS_TENANT };
const auth = await createBlocksClient(options).auth.oidc.clientCredentials({clientId:env.MF_SVC_CLIENT_ID,clientSecret:env.MF_SVC_CLIENT_SECRET});
const client = createBlocksClient({...options,accessToken:auth.access_token||auth.accessToken});
const response = await client.data.collection('EngineJob',{fields:['Kind','Status','Attempts','ProjectId','WorkspaceId','TargetId','InputJson']}).get(id);
if(response.errors?.length) throw new Error('Job read failed');
const row = response.data.getEngineJobs.items[0];
if(row?.Kind !== 'design.generate' || row.Status !== 'failed' || row.Attempts >= 3) throw new Error('Job is not retryable');
const directory = `${env.MF_ENGINE_ROOT}/projects/${row.WorkspaceId}/${row.ProjectId}/artifacts/figma-screens/${id}`;
const checkpoint = JSON.parse(fs.readFileSync(`${directory}/started.json`,'utf8'));
const receipt = JSON.parse(fs.readFileSync(`${directory}/native-frame-receipt.json`,'utf8'));
if(checkpoint.source !== JSON.parse(row.InputJson).source || checkpoint.jobId !== id || !receipt.nodeIds.length) throw new Error('Invalid native checkpoint');
const worker = env.MF_FIGMA_DESIGN_WORKER_ID || env.MF_FACTORY_DESIGN_WORKER_ID;
const patch = {Status:'claimed',Progress:10,Message:'Finishing the recorded native Figma revision.',Attempts:row.Attempts+1,ClaimedBy:worker,ClaimedAt:new Date().toISOString(),ErrorCode:'',ActiveKey:`design.generate:${row.TargetId||'project'}`};
console.log(JSON.stringify({jobId:id,destination:receipt.projectUrl,frames:receipt.nodeIds.length,worker,apply:process.argv.includes('--yes')}));
if(process.argv.includes('--yes')) {
 const result = await client.data.graphql({query:'mutation ResumeNative($filter: String, $input: EngineJobUpdateInput!) { updateEngineJob(filter:$filter,input:$input) { acknowledged totalImpactedData } }',variables:{filter:JSON.stringify({ItemId:id,Status:'failed',Attempts:row.Attempts}),input:patch}});
 if(result.errors?.length || result.data?.updateEngineJob?.totalImpactedData !== 1) throw new Error('Resume was not confirmed');
 console.log('Resumed the same recorded revision.');
}
