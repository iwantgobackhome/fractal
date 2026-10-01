/** Actual primary cached Read on ONLY the reviewer's retained PMLR store/profile. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {chromium} from 'playwright-core';
import {startService} from '../../../../packages/hub/src/main';
import type {SqlitePaperStore} from '../../../../packages/hub/src/store/sqlite';
const closure=process.argv.includes('--closure');
const root=resolve(import.meta.dirname,'../../../..'),output=join(root,`docs/implementation/qa/pdf-acquisition/evidence/${closure?'cached-ui-closure':'cached-ui'}`);await mkdir(output,{recursive:true});
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
const snapshot=()=>({paper:store.getPaper(key),record:store.getLibrary(key),history:store.listHistory(key),annotations:store.listAnnotations(key),folders:store.listFolders()});
const before=snapshot();evidence.preservedBefore=before;
let context:Awaited<ReturnType<typeof chromium.launchPersistentContext>>|undefined;
try{
  await writeFile(cacheFile,altered);store.putPreferences({uiLanguage:'en',onboardingCompleted:true,translationLanguage:'ko',answerLanguage:'auto'});
  if(closure){
    evidence.httpRefusals=[];
    for(const headers of [{},{range:'bytes=0-63'},{'if-none-match':`"${hash(altered)}"`},{'if-none-match':`"${canonical}"`},{range:'bytes=0-63','if-range':`"${hash(altered)}"`}]){
      const response=await fetch(origin+`/api/papers/${key}/pdf`,{headers});const body=await response.json();
      evidence.httpRefusals.push({headers,status:response.status,contentType:response.headers.get('content-type'),etag:response.headers.get('etag'),body});
      assert.equal(response.status,409);assert.equal(body.error.code,'SOURCE_CHANGED');assert.equal(body.data,undefined);assert.equal(response.headers.get('etag'),null);
    }
    assert.deepEqual(snapshot(),before);assert.equal(hash(await readFile(cacheFile)),hash(altered));
  }
  context=await chromium.launchPersistentContext(profile,{executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,viewport:{width:1440,height:900}});
  const page=await context.newPage();await page.addInitScript('window.__name = (value) => value');
  page.on('request',r=>{evidence.requests.push({method:r.method(),path:new URL(r.url()).pathname});if(new URL(r.url()).origin!==origin)evidence.external.push(r.url());});page.on('popup',p=>evidence.external.push(p.url()));page.on('pageerror',error=>evidence.pageErrors.push(error.message));
  await page.goto(origin+'/#/home');const row=page.locator('[data-feed-id="qa-public-0"]');await row.waitFor();
  const pdfResponse=page.waitForResponse(r=>r.url().endsWith(`/api/papers/${key}/pdf`),{timeout:60_000});void pdfResponse.catch(()=>{});
  await row.getByRole('button',{name:'Read PDF',exact:true}).focus();await page.keyboard.press('Enter');const pdf=await pdfResponse;
  evidence.browserPdfResponse={status:pdf.status(),url:pdf.url(),etag:pdf.headers().etag,contentLength:pdf.headers()['content-length']};
  if(closure){
    assert.equal(pdf.status(),409);
    const message=page.getByText(evidence.httpRefusals[0].body.error.message,{exact:true});
    await message.waitFor({timeout:30_000});await page.waitForTimeout(1000);
    assert.equal(await page.locator('[data-testid="pdf-body"] canvas').count(),0);assert.deepEqual(snapshot(),before);
    evidence.refusedReaderUrl=page.url();evidence.originalRenderedOnRefusal=false;evidence.preservedAfterRefusal=snapshot();evidence.refusalMessage=await message.textContent();
    assert.ok(!evidence.requests.some((r:any)=>r.path==='/api/publications/open'));assert.deepEqual(evidence.external,[]);
    await page.screenshot({path:join(output,'corrupt-cached-primary-read-refused.png')});
    await writeFile(cacheFile,original);
    const full=await fetch(origin+`/api/papers/${key}/pdf`);const actual=Buffer.from(await full.arrayBuffer());assert.equal(full.status,200);assert.equal(hash(actual),canonical);assert.deepEqual(actual,original);
    const range=await fetch(origin+`/api/papers/${key}/pdf`,{headers:{range:'bytes=0-63'}});assert.equal(range.status,206);assert.deepEqual(Buffer.from(await range.arrayBuffer()),original.subarray(0,64));
    const conditional=await fetch(origin+`/api/papers/${key}/pdf`,{headers:{'if-none-match':`"${canonical}"`}});assert.equal(conditional.status,304);assert.equal((await conditional.arrayBuffer()).byteLength,0);
    evidence.restoredHttp={full:full.status,range:range.status,conditional:conditional.status,sha256:hash(actual),bytes:actual.length};assert.deepEqual(snapshot(),before);
    await page.goto(origin+'/?qaCachedClosure=restored#/home');const restoredRow=page.locator('[data-feed-id="qa-public-0"]');await restoredRow.waitFor();
    await restoredRow.getByRole('button',{name:'Read PDF',exact:true}).focus();await page.keyboard.press('Enter');
    await page.locator('[data-testid="pdf-body"] canvas').first().waitFor({timeout:60_000});await page.waitForTimeout(1000);
    const after=snapshot();assert.equal(after.paper?.pdfSha256,canonical);assert.equal(after.record?.saved,before.record?.saved);
    assert.notEqual(after.record?.lastReadAt,before.record?.lastReadAt);
    // Actual reader may update Recent/progress only; metadata, history, memo and canonical paper survive.
    const readFields=['lastReadAt','readProgress','status','updatedAt','rev'];
    const withoutRead=(record:any)=>Object.fromEntries(Object.entries(record).filter(([name])=>!readFields.includes(name)));
    assert.deepEqual(withoutRead(after.record),withoutRead(before.record));assert.deepEqual(after.paper,before.paper);assert.deepEqual(after.history,before.history);assert.deepEqual(after.annotations,before.annotations);assert.deepEqual(after.folders,before.folders);
    evidence.recordAfterRestoredReader=after.record;evidence.readerUrl=page.url();evidence.restoredOriginalRendered=true;assert.deepEqual(evidence.external,[]);assert.deepEqual(evidence.pageErrors,[]);
    await page.screenshot({path:join(output,'restored-cached-original-reader.png')});
    evidence.status='passed: corrupted full/range/conditional PDF refused; actual primary cached Read no PDF/no Recent and all saved metadata intact; restored real original renders with stable identity and actual reader Recent';
  }else{
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
  }
}catch(error){evidence.status='helper failed';evidence.error=error instanceof Error?error.stack:String(error);process.exitCode=1;}
finally{
  await writeFile(join(output,'verification.json'),JSON.stringify(evidence,null,2));
  evidence.helperBeforeStop=identity();evidence.listenersBeforeStop=listeners();evidence.browserBeforeStop=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-Command',`Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like '*msedge.exe' -and $_.CommandLine -like '*${profile}*' } | Select-Object ProcessId,ParentProcessId,ExecutablePath,CommandLine,CreationDate | ConvertTo-Json -Compress`],{encoding:'utf8'}).trim()||'null');
  await context?.close();await writeFile(cacheFile,original);assert.equal(hash(await readFile(cacheFile)),canonical);evidence.originalRestored=true;await service.stop();evidence.listenersAfterStop=listeners();assert.equal(evidence.listenersAfterStop,'');evidence.finishedAt=new Date().toISOString();await writeFile(join(output,'verification.json'),JSON.stringify(evidence,null,2));console.log(evidence.status);
}
