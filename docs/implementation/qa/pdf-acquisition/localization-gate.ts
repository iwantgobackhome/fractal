/** Actual public non-PDF page and application UI; no route/response replacement. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {chromium} from 'playwright-core';
import {startService} from '../../../../packages/hub/src/main';
import {isoWeek} from '../../../../packages/hub/src/feed/index';
import type {SqlitePaperStore} from '../../../../packages/hub/src/store/sqlite';
const root=resolve(import.meta.dirname,'../../../..'),profile=join(root,'data/qa-pdf-acquisition',`localization-${Date.now()}`),output=join(root,'docs/implementation/qa/pdf-acquisition/evidence/localization');
await mkdir(profile,{recursive:true});await mkdir(output,{recursive:true});process.env.NODE_ENV='test';process.env.FRACTAL_DATA=profile;process.env.PAPERREAD_DATA=join(profile,'no-legacy');
const identity=()=>JSON.parse(execFileSync('powershell.exe',['-NoProfile','-Command',`Get-CimInstance Win32_Process -Filter "ProcessId = ${process.pid}" | Select-Object ProcessId,ParentProcessId,ExecutablePath,CommandLine,CreationDate | ConvertTo-Json -Compress`],{encoding:'utf8'}).trim());
const service=await startService({dataDirectory:join(profile,'hub'),port:0,indexHtml:join(root,'packages/ui/dist/index.html'),startBackground:false,allowRealCli:false,log:()=>{}}),store=service.store as SqlitePaperStore,origin=service.url,port=Number(new URL(origin).port);
const listeners=()=>execFileSync('powershell.exe',['-NoProfile','-Command',`@(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue) | Select-Object LocalAddress,LocalPort,OwningProcess | ConvertTo-Json -Compress; exit 0`],{encoding:'utf8'}).trim();
const evidence:any={source:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),startedAt:new Date().toISOString(),profile,helperIdentity:identity(),listenersBefore:listeners(),cases:[],external:[],pageErrors:[],successMocked:false,publicPage:'https://example.org/'};
const week=isoWeek(new Date()),now=new Date().toISOString();
store.db.prepare('INSERT INTO feed_items VALUES(?,?,?)').run(week,'qa-live-failure',JSON.stringify({id:'qa-live-failure',title:'Actual public landing page without a main PDF',authors:[],url:evidence.publicPage,kind:'paper',categories:['cs.CL'],source:'user',publishedAt:now,dateBasis:'observed',popularity:0,image:null,abstract:'A real public HTML source used solely to check truthful PDF acquisition failure.',publication:{year:null,venue:null,publicationKind:'unknown',publicationDate:null,oaAvailability:'unknown',oaPdfUrl:null}}));
for(const [key,value] of Object.entries({interests:{categories:['cs.CL'],topics:[],authors:[],custom:[]},settings:{sources:{arxiv:false,huggingFace:false,news:false,recommendations:false,openAlex:false,crossref:false},customRssFeeds:[],digestEnabled:false,refreshIntervalHours:6,translateNewsTitles:false},[`generated:${week}`]:now,sourceStatus:[]}))store.db.prepare('INSERT OR REPLACE INTO feed_meta VALUES(?,?)').run(key,JSON.stringify(value));
let context:Awaited<ReturnType<typeof chromium.launchPersistentContext>>|undefined;
try {
  context=await chromium.launchPersistentContext(join(profile,'browser-profile'),{executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,viewport:{width:1440,height:900}});
  const page=await context.newPage();await page.addInitScript('window.__name = (value) => value');
  page.on('request',request=>{if(new URL(request.url()).origin!==origin)evidence.external.push(request.url());});page.on('popup',popup=>evidence.external.push(popup.url()));page.on('pageerror',error=>evidence.pageErrors.push(error.message));
  for(const language of ['en','ko'] as const){
    store.putPreferences({uiLanguage:language,onboardingCompleted:true,translationLanguage:'ko',answerLanguage:'auto'});
    await page.goto(origin+`/?qaLanguage=${language}#/home`);const row=page.locator('[data-feed-id="qa-live-failure"]');await row.waitFor();
    const reply=page.waitForResponse(response=>response.url().endsWith('/api/publications/open'),{timeout:90_000});
    void reply.catch(()=>{}); // Keep a failed locator's pending observer from hiding its durable failure evidence.
    await row.getByRole('button',{name:language==='en'?'Read PDF':'PDF 읽기',exact:true}).focus();await page.keyboard.press('Enter');
    const response=await reply,body=await response.json();await row.getByRole('alert').waitFor();
    assert.equal(response.status(),400);assert.equal(body.error.code,'INVALID_INPUT');assert.ok(body.error.message.includes(language==='en'?'one main PDF':'논문 PDF를 하나로 확인'));assert.ok(body.error.message.length<240);
    assert.equal(new URL(page.url()).hash,'#/home');assert.equal(await row.getByRole('alert').evaluate(el=>el===document.activeElement),true);
    assert.ok(await row.getByRole('button',{name:language==='en'?'Retry Read PDF':'PDF 읽기 다시 시도',exact:true}).isEnabled());
    const record=store.listLibrary()[0];assert.equal(record.saved,false);assert.equal(record.lastReadAt,null);assert.deepEqual(store.listPapers(),[]);
    await page.screenshot({path:join(output,`${language}-actual-source-failure.png`)});
    evidence.cases.push({language,status:response.status(),body,alert:await row.getByRole('alert').innerText(),record,readerOpened:false,sourceFallbackVisible:await row.locator('.publication-actions').getByRole('link').isVisible()});
  }
  const invalid=await fetch(origin+'/api/publications/open',{method:'POST',headers:{origin,'x-paperread-token':service.token,'content-type':'application/json'},body:JSON.stringify({title:''})});
  evidence.genericValidation={status:invalid.status,body:await invalid.json()};assert.equal(evidence.genericValidation.body.error.message,'요청 형식이 올바르지 않습니다.');
  assert.deepEqual(evidence.external,[]);assert.deepEqual(evidence.pageErrors,[]);evidence.status='passed';
}catch(error){evidence.status='failed';evidence.error=error instanceof Error?error.stack:String(error);process.exitCode=1;}
finally{
  await writeFile(join(output,'verification.json'),JSON.stringify(evidence,null,2));
  evidence.helperBeforeStop=identity();evidence.listenersBeforeStop=listeners();
  evidence.browserBeforeStop=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-Command',`Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like '*msedge.exe' -and $_.CommandLine -like '*${profile}*' } | Select-Object ProcessId,ParentProcessId,ExecutablePath,CommandLine,CreationDate | ConvertTo-Json -Compress`],{encoding:'utf8'}).trim()||'null');
  await context?.close();await service.stop();evidence.listenersAfterStop=listeners();assert.equal(evidence.listenersAfterStop,'');evidence.finishedAt=new Date().toISOString();await writeFile(join(output,'verification.json'),JSON.stringify(evidence,null,2));console.log(`localized actual source failure: ${evidence.status}`);
}
