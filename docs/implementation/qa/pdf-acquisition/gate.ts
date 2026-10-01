/** Independent real HTTP/browser check. Only discovery metadata and pre-existing user edits are fixtures. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { chromium } from 'playwright-core';
import { startService } from '../../../../packages/hub/src/main';
import { isoWeek } from '../../../../packages/hub/src/feed/index';
import { publicGet } from '../../../../packages/hub/src/publication/network';
import type { SqlitePaperStore } from '../../../../packages/hub/src/store/sqlite';

const root = resolve(import.meta.dirname, '../../../..');
const mode = process.argv[2] ?? 'browser';
const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-');
const privateRoot = join(root, 'data/qa-pdf-acquisition', `${mode}-${stamp}`);
const output = join(root, 'docs/implementation/qa/pdf-acquisition/evidence', mode);
await mkdir(privateRoot, { recursive: true }); await mkdir(output, { recursive: true });
const source = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const identity = (pid: number) => JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-Command',
  `Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" | Select-Object ProcessId,ParentProcessId,ExecutablePath,CommandLine,CreationDate | ConvertTo-Json -Compress`], {encoding:'utf8'}).trim() || 'null');
const listeners = (port: number) => execFileSync('powershell.exe', ['-NoProfile', '-Command',
  `@(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue) | Select-Object LocalAddress,LocalPort,OwningProcess | ConvertTo-Json -Compress; exit 0`], {encoding:'utf8'}).trim();
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const caseFile = JSON.parse(await readFile(join(root, 'docs/implementation/backend/pdf-acquisition/live-case.json'), 'utf8'));
const publisher = caseFile.request;
const large = {title:'WorldAuditBench: Interactive 3D World Auditing with Multimodal Agents', authors:[],
  url:'https://arxiv.org/abs/2609.40325v1', arxivId:'2609.40325', publication:{year:2026,venue:null,
    publicationKind:'preprint',publicationDate:'2026-09-30',oaAvailability:'open',oaPdfUrl:'https://arxiv.org/pdf/2609.40325v1'}};
const failed = {title:'Independent actual missing publisher URL boundary',authors:[],
  url:'https://proceedings.mlr.press/v70/nonexistent-qa-publication.html',publication:{year:null,venue:null,publicationKind:'unknown',publicationDate:null,oaAvailability:'unknown',oaPdfUrl:null}};
const evidence: any = {source, mode, startedAt:new Date().toISOString(), seededPdfBytes:false, privateRoot,
  helperIdentity:identity(process.pid), externalNavigation:[], cases:[], errors:[]};
process.env.NODE_ENV = 'test';
process.env.FRACTAL_DATA = privateRoot;
process.env.PAPERREAD_DATA = join(privateRoot, 'empty-legacy');
const service = await startService({dataDirectory:join(privateRoot,'hub'),port:0,indexHtml:join(root,'packages/ui/dist/index.html'),startBackground:false,allowRealCli:false,log:()=>{}});
const store = service.store as SqlitePaperStore;
const origin = service.url, port = Number(new URL(origin).port);
evidence.origin = origin; evidence.listenersBefore = listeners(port);
async function http(path:string, body?:unknown, method = body === undefined ? 'GET' : 'POST') {
  const started = Date.now(); const response = await fetch(origin+path, {method,
    headers:{origin,'x-paperread-token':service.token,...(body===undefined?{}:{'content-type':'application/json'})},
    body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(180_000)});
  const json = await response.json(); return {status:response.status,elapsedMs:Date.now()-started,...json};
}
async function api(path:string, body?:unknown, method?:string) {const result=await http(path,body,method); assert.ok(result.status<300,JSON.stringify(result)); return result.data;}
async function reference(url:string,filename:string) {
  const started=Date.now(); const downloaded=await publicGet(url,{timeoutMs:60_000});
  assert.ok(downloaded.bytes.subarray(0,1024).includes(Buffer.from('%PDF-')));
  await writeFile(join(privateRoot,filename),downloaded.bytes);
  return {url:downloaded.url,contentType:downloaded.contentType,bytes:downloaded.bytes.length,sha256:hash(downloaded.bytes),elapsedMs:Date.now()-started};
}
let context:Awaited<ReturnType<typeof chromium.launchPersistentContext>>|undefined;
try {
  if (mode === 'large') {
    evidence.reference=await reference(large.publication.oaPdfUrl,'worldauditbench-original.pdf');
    assert.equal(evidence.reference.bytes,49668700);
    assert.equal(evidence.reference.sha256,'d9fdc657534201a7e1df44080ae52fb1c168b791b56581ebf2ddf35d0b087901');
    console.log(`exact public PDF verified ${evidence.reference.elapsedMs}ms`);
    const requests=await Promise.all([http('/api/publications/open',large),http('/api/publications/open',large)]);
    evidence.cases.push({name:'exact-large-concurrent-HTTP',request:large,responses:requests});
    console.log(`exact application responses ${requests.map(r=>`${r.status}/${r.elapsedMs}ms`).join(',')}`);
    if(requests[0].status===200) {
      assert.equal(requests[1].data.paperKey,requests[0].data.paperKey);
      const value=requests[0].data; assert.equal(value.paper.pdfSha256,evidence.reference.sha256);
      assert.equal(value.record.saved,false); assert.equal(value.record.lastReadAt,null);
      const pdf=await fetch(origin+`/api/papers/${value.paperKey}/pdf`); const bytes=new Uint8Array(await pdf.arrayBuffer());
      assert.equal(hash(bytes),evidence.reference.sha256); assert.equal(bytes.length,49668700);
      const again=await api('/api/publications/open',large); assert.equal(again.paperKey,value.paperKey);
      evidence.cachedKey=again.paperKey; evidence.servedHash=hash(bytes);
    }
    evidence.library=store.listLibrary(); evidence.papers=store.listPapers();
  } else {
    store.putPreferences({uiLanguage:'en',onboardingCompleted:true,translationLanguage:'ko',answerLanguage:'auto'});
    const items=[publisher,failed];
    let savedBefore:any=null, savedHistory:any=null, savedMemo:any=null;
    if(mode==='saved') {
      const admitted=await api('/api/library/bookmarks',publisher);
      const parent=await api('/api/library/folders',{id:randomUUID(),name:'Retained parent',parentId:null});
      const child=await api('/api/library/folders',{id:randomUUID(),name:'Retained nested child',parentId:parent.id});
      await api(`/api/library/${admitted.paperKey}`,{tags:['independent-retained-tag'],collections:[child.id],bibtexKey:'retainedUserCitation',status:'read',readProgress:{page:2,fraction:0.2},lastReadAt:'2026-09-01T00:00:00.000Z'},'PATCH');
      savedBefore=await api(`/api/library/${admitted.paperKey}`);
      const now=new Date().toISOString();
      savedHistory={id:randomUUID(),paperKey:admitted.paperKey,kind:'question',question:'Retained independent question',text:'Retained answer history',status:'completed',createdAt:now,updatedAt:now,completedAt:now,requestId:null,context:{},answer:null,error:null,rev:1,deviceId:'hub',deleted:false};
      savedHistory=store.putHistory(savedHistory);
      savedMemo={id:randomUUID(),paperKey:admitted.paperKey,kind:'memo',page:1,text:'Retained independent memo',rect:null,quote:null,updatedAt:now,deleted:false,rev:1,deviceId:'hub'};
      // Explicit legacy user annotation fixture; no PDF bytes or successful reader state is seeded.
      store.db.prepare('INSERT INTO annotations VALUES(?,?,?)').run(savedMemo.id,savedMemo.paperKey,JSON.stringify(savedMemo));
      evidence.savedBefore=savedBefore;
    }
    const week=isoWeek(new Date()),now=new Date().toISOString();
    for(const [index,item] of items.entries())store.db.prepare('INSERT INTO feed_items VALUES(?,?,?)').run(week,`qa-public-${index}`,JSON.stringify({...item,id:`qa-public-${index}`,kind:'paper',categories:['cs.CL'],source:'openAlex',publishedAt:now,dateBasis:'observed',popularity:0,image:null,abstract:'Independent review metadata. PDF bytes are downloaded from the public publisher.'}));
    for(const [key,value] of Object.entries({interests:{categories:['cs.CL'],topics:[],authors:[],custom:[]},settings:{sources:{arxiv:false,huggingFace:false,news:false,recommendations:false,openAlex:false,crossref:false},customRssFeeds:[],digestEnabled:false,refreshIntervalHours:6,translateNewsTitles:false},[`generated:${week}`]:now,sourceStatus:[]}))store.db.prepare('INSERT OR REPLACE INTO feed_meta VALUES(?,?)').run(key,JSON.stringify(value));
    evidence.reference=await reference(caseFile.publisher.pdfUrl,'publisher-original.pdf');
    assert.equal(evidence.reference.sha256,caseFile.after.sha256);
    context=await chromium.launchPersistentContext(join(privateRoot,'browser-profile'),{executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,viewport:{width:1440,height:900}});
    const page=await context.newPage();
    evidence.browserIdentity=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-Command',
      `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${privateRoot}*browser-profile*' } | Select-Object ProcessId,ParentProcessId,ExecutablePath,CommandLine,CreationDate | ConvertTo-Json -Compress`],{encoding:'utf8'}).trim()||'null');
    await page.addInitScript('window.__name = (value) => value');
    const mutations:any[]=[];
    page.on('pageerror',error=>evidence.errors.push(error.message));
    page.on('popup',popup=>evidence.externalNavigation.push(popup.url()));
    page.on('request',request=>{const url=new URL(request.url());if(url.origin!==origin)evidence.externalNavigation.push(request.url()); if(request.method()!=='GET')mutations.push({path:url.pathname,method:request.method()});});
    await page.goto(origin+'/#/home'); const row=page.locator('[data-feed-id="qa-public-0"]'); await row.waitFor();
    await page.screenshot({path:join(output,'discovery.png')});
    const canonical=caseFile.after.paperKey;
    if(mode!=='saved')assert.equal(store.getLibrary(canonical),null,'publication starts unbookmarked');
    const opened=page.waitForResponse(r=>r.url().endsWith('/api/publications/open'),{timeout:120_000});
    const start=Date.now(); await row.getByRole('button',{name:'Read PDF',exact:true}).focus(); await page.keyboard.press('Enter');
    await row.getByRole('status').waitFor(); assert.equal(await row.locator('.publication-actions').getAttribute('aria-busy'),'true');
    const response=await opened;const value=(await response.json()).data;
    assert.ok(response.ok(),JSON.stringify(await response.json()));assert.equal(value.paperKey,canonical);assert.equal(value.paper.pdfSha256,evidence.reference.sha256);
    if(savedBefore){for(const key of ['saved','savedAt','tags','collections','lastReadAt','readProgress','bibtexKey','status'])assert.deepEqual(value.record[key],savedBefore[key],`preserve ${key}`);}else{assert.equal(value.record.saved,false);assert.equal(value.record.lastReadAt,null);}
    await page.locator('[data-testid="pdf-body"] canvas').first().waitFor({timeout:60_000});
    assert.equal(decodeURIComponent(new URL(page.url()).hash.split('/').at(-1)!),canonical);
    await page.waitForFunction(()=>document.querySelector('canvas')?.width!>0);
    let readRecord:any;for(let i=0;i<40;i++){readRecord=await api(`/api/library/${canonical}`);if(readRecord.lastReadAt&&readRecord.lastReadAt!==savedBefore?.lastReadAt)break;await page.waitForTimeout(100);}
    assert.ok(readRecord.lastReadAt);assert.equal(readRecord.saved,mode==='saved');
    const served=await fetch(origin+`/api/papers/${canonical}/pdf`);const bytes=new Uint8Array(await served.arrayBuffer());assert.equal(hash(bytes),evidence.reference.sha256);
    assert.equal(bytes.length,evidence.reference.bytes);
    await page.screenshot({path:join(output,'reader.png')});
    evidence.cases.push({name:'actual-passive-publisher-browser-open',elapsedMs:Date.now()-start,paperKey:canonical,response:value,readRecord,servedHash:hash(bytes),servedBytes:bytes.length});
    if(savedHistory){assert.deepEqual(store.getHistory(savedHistory.id),savedHistory);assert.deepEqual(store.getAnnotation(savedMemo.id),savedMemo);evidence.preserved={history:savedHistory,memo:savedMemo,folders:store.listFolders()};}
    await page.goto(origin+'/#/home');await row.waitFor();const prior=mutations.length;
    await row.getByRole('button',{name:'Read PDF',exact:true}).click();await page.locator('[data-testid="pdf-body"] canvas').first().waitFor();
    assert.equal(decodeURIComponent(new URL(page.url()).hash.split('/').at(-1)!),canonical);
    assert.ok(!mutations.slice(prior).some(r=>r.path==='/api/publications/open'));evidence.cachedReopen={paperKey:canonical,acquisitionSkipped:true};
    await page.goto(origin+'/#/home');const failureRow=page.locator('[data-feed-id="qa-public-1"]');await failureRow.waitFor();
    const failResponse=page.waitForResponse(r=>r.url().endsWith('/api/publications/open'),{timeout:120_000});
    await failureRow.getByRole('button',{name:'Read PDF',exact:true}).focus();await page.keyboard.press('Enter');const fail=await failResponse;
    await failureRow.getByRole('alert').waitFor();assert.equal(new URL(page.url()).hash,'#/home');
    assert.ok(await failureRow.getByRole('button',{name:'Retry Read PDF',exact:true}).isEnabled());
    assert.ok(await failureRow.getByRole('link',{name:'Publication source',exact:true}).isVisible());
    const failRecord=store.listLibrary().find(r=>r.title===failed.title)!;assert.equal(failRecord.saved,false);assert.equal(failRecord.lastReadAt,null);assert.equal(store.getPaper(failRecord.paperKey),null);
    await page.screenshot({path:join(output,'failure.png')});evidence.cases.push({name:'actual-public-404-failure',status:fail.status(),body:await fail.json(),record:failRecord,alert:await failureRow.getByRole('alert').innerText(),focused:await failureRow.getByRole('alert').evaluate(el=>el===document.activeElement)});
    assert.deepEqual(evidence.externalNavigation,[]);assert.deepEqual(evidence.errors,[]);assert.ok(!mutations.some(r=>/\/save$|\/bookmarks$/.test(r.path)));evidence.mutations=mutations;
    evidence.library=store.listLibrary(); evidence.papers=store.listPapers();
  }
  evidence.status='passed';
} catch(error){evidence.status='failed';evidence.error=error instanceof Error?error.stack:String(error);process.exitCode=1;}
finally {
  await writeFile(join(output,'verification.json'),JSON.stringify(evidence,null,2));
  evidence.listenersBeforeStop=listeners(port);evidence.helperBeforeStop=identity(process.pid);
  await context?.close();await service.stop();evidence.listenersAfterStop=listeners(port);assert.equal(evidence.listenersAfterStop,'');
  evidence.cleanup='Closed only owned Browser and Service handles; private profile/SQLite/public PDF bytes preserved';evidence.finishedAt=new Date().toISOString();
  await writeFile(join(output,'verification.json'),JSON.stringify(evidence,null,2));console.log(`${mode}: ${evidence.status}; ${join(output,'verification.json')}`);
}
