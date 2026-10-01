/** Actual primary cached Read on ONLY the reviewer's retained PMLR store/profile. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {chromium} from 'playwright-core';
import {startService} from '../../../../packages/hub/src/main';
import type {SqlitePaperStore} from '../../../../packages/hub/src/store/sqlite';
const root=resolve(import.meta.dirname,'../../../..'),output=join(root,'docs/implementation/qa/pdf-acquisition/evidence/cached-ui');await mkdir(output,{recursive:true});
const baseline=JSON.parse(await readFile(join(root,'docs/implementation/qa/pdf-acquisition/evidence/saved/verification.json'),'utf8'));
assert.ok(baseline.privateRoot.startsWith(join(root,'data/qa-pdf-acquisition')));
const key=baseline.cases[0].paperKey,hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const original=await readFile(join(baseline.privateRoot,'publisher-original.pdf')),canonical=hash(original),cacheFile=join(baseline.privateRoot,'hub/pdfs',`${canonical}.pdf`);
assert.equal(hash(await readFile(cacheFile)),canonical);const altered=Buffer.concat([original,Buffer.from('\n% actual-primary-cached-read-QA-corruption\n')]);
process.env.NODE_ENV='test';process.env.FRACTAL_DATA=baseline.privateRoot;process.env.PAPERREAD_DATA=join(baseline.privateRoot,'no-legacy');
const service=await startService({dataDirectory:join(baseline.privateRoot,'hub'),port:0,indexHtml:join(root,'packages/ui/dist/index.html'),startBackground:false,allowRealCli:false,log:()=>{}}),store=service.store as SqlitePaperStore,origin=service.url,port=Number(new URL(origin).port);
const identity=()=>JSON.parse(execFileSync('powershell.exe',['-NoProfile','-Command',`Get-CimInstance Win32_Process -Filter "ProcessId = ${process.pid}" | Select-Object ProcessId,ParentProcessId,ExecutablePath,CommandLine,CreationDate | ConvertTo-Json -Compress`],{encoding:'utf8'}).trim());
const listeners=()=>execFileSync('powershell.exe',['-NoProfile','-Command',`@(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue) | Select-Object LocalAddress,LocalPort,OwningProcess | ConvertTo-Json -Compress; exit 0`],{encoding:'utf8'}).trim();
const profile=join(baseline.privateRoot,`cached-ui-profile-${Date.now()}`);
const evidence:any={source:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),startedAt:new Date().toISOString(),paperKey:key,canonicalHash:canonical,alteredHash:hash(altered),controlledLocalCacheAlteration:true,successResponseMocked:false,helperIdentity:identity(),listenersBefore:listeners(),recordBefore:store.getLibrary(key),requests:[],pageErrors:[],external:[]};
let context:Awaited<ReturnType<typeof chromium.launchPersistentContext>>|undefined;
try{
  await writeFile(cacheFile,altered);store.putPreferences({uiLanguage:'en',onboardingCompleted:true,translationLanguage:'ko',answerLanguage:'auto'});
  context=await chromium.launchPersistentContext(profile,{executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,viewport:{width:1440,height:900}});
  const page=await context.newPage();await page.addInitScript('window.__name = (value) => value');
  page.on('request',r=>{evidence.requests.push({method:r.method(),path:new URL(r.url()).pathname});if(new URL(r.url()).origin!==origin)evidence.external.push(r.url());});page.on('popup',p=>evidence.external.push(p.url()));page.on('pageerror',error=>evidence.pageErrors.push(error.message));
  await page.goto(origin+'/#/home');const row=page.locator('[data-feed-id="qa-public-0"]');await row.waitFor();
  const pdfResponse=page.waitForResponse(r=>r.url().endsWith(`/api/papers/${key}/pdf`),{timeout:60_000});void pdfResponse.catch(()=>{});
  await row.getByRole('button',{name:'Read PDF',exact:true}).focus();await page.keyboard.press('Enter');const pdf=await pdfResponse;
  evidence.browserPdfResponse={status:pdf.status(),url:pdf.url(),etag:pdf.headers().etag,contentLength:pdf.headers()['content-length']};
  // PDF.js transfers the body through its worker; CDP may not retain Network.getResponseBody.
  // Read the same unchanged real stored bytes through independent HTTP and bind them to the observed browser ETag.
  const direct=await fetch(origin+`/api/papers/${key}/pdf`),actual=Buffer.from(await direct.arrayBuffer());
  evidence.served={status:direct.status,sha256:hash(actual),bytes:actual.length};assert.equal(pdf.headers().etag,`"${hash(actual)}"`);
  await page.locator('[data-testid="pdf-body"] canvas').first().waitFor({timeout:60_000});
  await page.waitForTimeout(1000);evidence.readerUrl=page.url();evidence.recordAfter=store.getLibrary(key);evidence.paper=store.getPaper(key);evidence.originalRendered=true;
  assert.equal(pdf.status(),200);assert.equal(hash(actual),hash(altered));assert.equal(evidence.paper.pdfSha256,canonical);assert.equal(decodeURIComponent(new URL(page.url()).hash.split('/').at(-1)!),key);
  assert.ok(!evidence.requests.some((r:any)=>r.path==='/api/publications/open'));assert.deepEqual(evidence.external,[]);assert.deepEqual(evidence.pageErrors,[]);
  await page.screenshot({path:join(output,'altered-cached-primary-read.png')});
  evidence.status='defect reproduced: actual cached primary Read bypasses repaired POST and renders altered hash under canonical key';
}catch(error){evidence.status='helper failed';evidence.error=error instanceof Error?error.stack:String(error);process.exitCode=1;}
finally{
  await writeFile(join(output,'verification.json'),JSON.stringify(evidence,null,2));
  evidence.helperBeforeStop=identity();evidence.listenersBeforeStop=listeners();evidence.browserBeforeStop=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-Command',`Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like '*msedge.exe' -and $_.CommandLine -like '*${profile}*' } | Select-Object ProcessId,ParentProcessId,ExecutablePath,CommandLine,CreationDate | ConvertTo-Json -Compress`],{encoding:'utf8'}).trim()||'null');
  await context?.close();await writeFile(cacheFile,original);assert.equal(hash(await readFile(cacheFile)),canonical);evidence.originalRestored=true;await service.stop();evidence.listenersAfterStop=listeners();assert.equal(evidence.listenersAfterStop,'');evidence.finishedAt=new Date().toISOString();await writeFile(join(output,'verification.json'),JSON.stringify(evidence,null,2));console.log(evidence.status);
}
