/** Reproduce cached-byte mismatch using ONLY the independent reviewer's retained public store. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {startService} from '../../../../packages/hub/src/main';
import type {SqlitePaperStore} from '../../../../packages/hub/src/store/sqlite';
const root=resolve(import.meta.dirname,'../../../..');
const evidenceRoot=join(root,'docs/implementation/qa/pdf-acquisition/evidence');
const baseline=JSON.parse(await readFile(join(evidenceRoot,'browser/verification.json'),'utf8'));
assert.ok(baseline.privateRoot.startsWith(join(root,'data/qa-pdf-acquisition')));
const request=JSON.parse(await readFile(join(root,'docs/implementation/backend/pdf-acquisition/live-case.json'),'utf8')).request;
const key=baseline.cases[0].paperKey,sha=(value:Uint8Array)=>createHash('sha256').update(value).digest('hex');
const original=await readFile(join(baseline.privateRoot,'publisher-original.pdf'));
const hash=sha(original),cacheFile=join(baseline.privateRoot,'hub/pdfs',`${hash}.pdf`);
assert.equal(sha(await readFile(cacheFile)),hash);
process.env.NODE_ENV='test';process.env.FRACTAL_DATA=baseline.privateRoot;process.env.PAPERREAD_DATA=join(baseline.privateRoot,'empty-legacy');
const service=await startService({dataDirectory:join(baseline.privateRoot,'hub'),port:0,startBackground:false,allowRealCli:false,log:()=>{}});
const store=service.store as SqlitePaperStore;
const identity=()=>JSON.parse(execFileSync('powershell.exe',['-NoProfile','-Command',`Get-CimInstance Win32_Process -Filter "ProcessId = ${process.pid}" | Select-Object ProcessId,ParentProcessId,ExecutablePath,CommandLine,CreationDate | ConvertTo-Json -Compress`],{encoding:'utf8'}).trim());
const port=Number(new URL(service.url).port),listeners=()=>execFileSync('powershell.exe',['-NoProfile','-Command',`@(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue) | Select-Object LocalAddress,LocalPort,OwningProcess | ConvertTo-Json -Compress; exit 0`],{encoding:'utf8'}).trim();
const evidence:any={source:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),startedAt:new Date().toISOString(),paperKey:key,originalHash:hash,owner:'backend',priority:'P1',controlledLocalCorruption:true,publicOriginalProvenance:baseline.reference,helperIdentity:identity(),listenersBefore:listeners()};
try {
  const altered=Buffer.concat([original,Buffer.from('\n% independent-QA-controlled-cached-byte-change\n')]);await writeFile(cacheFile,altered);
  evidence.alteredHash=sha(altered);
  const response=await fetch(service.url+'/api/publications/open',{method:'POST',headers:{origin:service.url,'x-paperread-token':service.token,'content-type':'application/json'},body:JSON.stringify(request)});
  evidence.response={status:response.status,body:await response.json()};
  const pdf=await fetch(service.url+`/api/papers/${key}/pdf`);const bytes=new Uint8Array(await pdf.arrayBuffer());
  evidence.served={status:pdf.status,bytes:bytes.length,sha256:sha(bytes),etag:pdf.headers.get('etag')};
  evidence.paper=store.getPaper(key);evidence.record=store.getLibrary(key);
  evidence.expected='Cached acquisition must reject bytes whose SHA-256 differs from the canonical Paper hash, without changing the hash/key or saved/read/user state.';
  evidence.actual='Acquisition returns success hasPdf=true with the original canonical hash, while the PDF route serves different cached bytes and an ETag for the altered hash.';
  evidence.reproduced=response.status===200&&evidence.response.body.data?.hasPdf===true&&evidence.paper.pdfSha256!==evidence.served.sha256;
  assert.equal(evidence.reproduced,true);
} finally {
  await writeFile(cacheFile,original);assert.equal(sha(await readFile(cacheFile)),hash);
  evidence.restoredOriginal=true;evidence.helperBeforeStop=identity();evidence.listenersBeforeStop=listeners();await service.stop();evidence.listenersAfterStop=listeners();assert.equal(evidence.listenersAfterStop,'');evidence.finishedAt=new Date().toISOString();
  await writeFile(join(evidenceRoot,'cached-integrity.json'),JSON.stringify(evidence,null,2));console.log(`cached integrity mismatch reproduced=${evidence.reproduced}; original restored; owned service closed`);
}
