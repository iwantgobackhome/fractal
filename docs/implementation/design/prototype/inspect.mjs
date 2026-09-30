// Isolated headless Edge evidence. Does not control any Orca-managed browser page.
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const output = path.resolve(root, '../renders/iteration-02');
const base = process.argv[2] || 'http://127.0.0.1:47831/';
const browserFile = process.env.FRACTAL_REVIEW_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const profile = await mkdtemp(path.join(os.tmpdir(), 'fractal-design-review-'));
const child = spawn(browserFile, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
let ws;
let seq = 0;
const pending = new Map();
const diagnostics = [];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function command(method, params = {}) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, 15000);
    pending.set(id, { resolve: r => { clearTimeout(timer); resolve(r); }, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text + ': ' + result.exceptionDetails.exception?.description);
  return result.result.value;
}
async function navigate(query) {
  await command('Page.navigate', { url: base + query });
  for (let i = 0; i < 100; i++) {
    if (await evaluate('document.readyState === "complete" && !!document.querySelector(".workspace")')) break;
    await sleep(50);
  }
  await evaluate('document.fonts.ready.then(() => true)');
  await sleep(100);
}
try {
  await mkdir(output, { recursive: true });
  let port;
  for (let i = 0; i < 150; i++) {
    try { port = (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; } catch { await sleep(100); }
  }
  if (!port) throw new Error('Edge did not expose a CDP port');
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
  ws.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) {
      const request = pending.get(message.id);
      if (request) { pending.delete(message.id); message.error ? request.reject(new Error(JSON.stringify(message.error))) : request.resolve(message.result); }
    } else if (message.method === 'Runtime.exceptionThrown') diagnostics.push(message.params.exceptionDetails);
  });
  await command('Page.enable');
  await command('Runtime.enable');
  await navigate('?view=desktop-library');
  await evaluate('localStorage.clear()');
  const cases = [
    ['desktop-library', 1440, 1000, '?view=desktop-library'],
    ['desktop-reader', 1600, 1000, '?view=desktop-reader'],
    ['tablet-library', 1280, 900, '?view=tablet-library'],
    ['tablet-reader', 1280, 900, '?view=tablet-reader'],
    ['tablet-portrait-reader', 800, 1280, '?view=tablet-reader'],
    ['phone-library', 390, 844, '?view=phone'],
    ['phone-library-compact', 360, 800, '?view=phone'],
    ['phone-reader', 390, 844, '?view=phone&screen=reader'],
    ['phone-reader-dark', 360, 800, '?view=phone&screen=reader&theme=dark'],
    ['tablet-reader-sepia', 1280, 900, '?view=tablet-reader&theme=sepia'],
    ['phone-library-offline', 390, 844, '?view=phone&state=offline'],
    ['desktop-library-empty', 1440, 1000, '?view=desktop-library&state=empty'],
    ['desktop-library-loading', 1440, 1000, '?view=desktop-library&state=loading'],
    ['desktop-reader-error', 1600, 1000, '?view=desktop-reader&state=error'],
    ['tablet-discovery', 1280, 900, '?view=tablet-library&screen=discover'],
    ['phone-news', 390, 844, '?view=phone&screen=news'],
    ['phone-topics', 390, 844, '?view=phone&screen=topics'],
  ];
  const results = [];
  for (const [name, width, height, query] of cases) {
    await command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await evaluate('localStorage.clear()');
    await navigate(query);
    const evidence = await evaluate(`({ viewport:[innerWidth,innerHeight], title:document.title, horizontalOverflow:document.documentElement.scrollWidth>innerWidth, sourceVisible:!!document.querySelector('[data-scroll-pane="source"]')?.clientHeight, translationVisible:!!document.querySelector('[data-scroll-pane="translation"]')?.clientHeight, stickyCount:document.querySelectorAll('.sticky').length, heading:document.querySelector('h1')?.textContent, toolbarHeight:document.querySelector('.reader-toolbar')?.getBoundingClientRect().height, headerHeight:document.querySelector('.reader-header')?.getBoundingClientRect().height })`);
    const { data } = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(path.join(output, name + '.png'), Buffer.from(data, 'base64'));
    results.push({ file: name + '.png', width, height, query, ...evidence });
    process.stdout.write(`${name}: ${width}x${height}, overflow=${evidence.horizontalOverflow}\n`);
  }
  const assertions=[];
  async function assert(label, expression) {
    const actual=await evaluate(expression);
    assertions.push({label,passed:!!actual});
    if(!actual)throw new Error('Interaction failed: '+label);
    process.stdout.write('PASS '+label+'\n');
  }
  await command('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await evaluate('localStorage.clear()');await navigate('?view=desktop-library');
  await assert('paper in two folders',`papers.find(p=>p.id==='attention').folders.length===2`);
  await assert('reading an unsaved paper keeps it unsaved',`(()=>{const count=savedCount();openPaper('flash');return !currentPaper().saved&&savedCount()===count;})()`);
  await evaluate(`state.screen='library';render();document.querySelector('[data-action="folder-menu"][data-id="llm"]').click();document.querySelector('[data-action="folder-remove"]').click();`);
  await assert('folder removal explains retention and promotion',`document.querySelector('.dialog').textContent.includes('論文')||document.querySelector('.dialog').textContent.includes('논문은 보관함에 그대로')`);
  await assert('folder removal retains papers and promotes children',`(()=>{const count=savedCount();document.querySelector('[data-action="folder-confirm-remove"]').click();return savedCount()===count&&!folders.some(f=>f.id==='llm')&&folders.find(f=>f.id==='foundation').parent===null&&folders.find(f=>f.id==='rag-folder').parent===null;})()`);
  await evaluate(`document.querySelector('[data-action="folder-create"]').click();document.querySelector('#folder-name').value='추가한 폴더';document.querySelector('[data-action="folder-save-new"]').click();`);
  await assert('folder creation uses entered name',`folders.some(f=>f.name==='추가한 폴더')`);
  await evaluate(`openPaper('attention');state.panel=true;state.panelTab='questions';render();`);
  await evaluate(`document.querySelector('#question-draft').value='병렬 계산과 어텐션의 관계는?';document.querySelector('#question-draft').dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#question-form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));`);
  await assert('sending a new question archives old question',`state.history.length>=1&&state.activeQuestion==='병렬 계산과 어텐션의 관계는?'&&state.draft===''`);
  await evaluate(`const close=document.querySelector('[data-action="panel-close"]');close.click();document.querySelector('[data-action="panel-toggle"]').click();`);
  await assert('closing and reopening retains answer',`document.querySelector('.answer-question').textContent==='병렬 계산과 어텐션의 관계는?'`);
  await evaluate(`openPaper('rag');openPaper('attention');`);
  await assert('question history survives changing paper',`state.activeQuestion==='병렬 계산과 어텐션의 관계는?'&&state.history.length>=1`);
  await evaluate(`state.panel=true;state.panelTab='questions';render();document.querySelector('[data-action="figure-explain"]').click();`);
  await assert('figure question displays selected context',`document.querySelector('.context-quote').textContent.includes('그림 1')&&state.draft.includes('Q, K, V')`);
  await evaluate(`document.querySelector('#question-form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));document.querySelector('[data-action="new-question"]').click();state.panelTab='history';render();`);
  await assert('explanations and general questions share retained history',`state.history.some(h=>h.kind==='explanation')&&state.history.some(h=>h.kind==='question')`);
  await evaluate(`document.querySelector('[data-action="history-filter"][data-value="explanation"]').click();`);
  await assert('history kind filter excludes general questions',`state.historyFilter==='explanation'&&document.querySelectorAll('.history-item').length===state.history.filter(h=>h.kind==='explanation').length`);
  await evaluate(`state.panelTab='notes';render();document.querySelector('[data-action="collapse-note"]').click();`);
  await assert('sticky note collapses without deleting content',`document.querySelector('.sticky.collapsed')!==null&&state.notes[0].text.length>0`);
  await evaluate(`state.compactPane='translation';state.mode='translation';render();document.querySelector('[data-action="new-note"]').click();`);
  await assert('positioned annotations only anchor to original',`state.notes.every(n=>n.pane==='source')&&state.mode==='source'&&document.querySelector('.translation .sticky')===null`);
  await assert('translation does not imply copied original highlights',`document.querySelector('.translation mark')===null`);
  await evaluate(`state.panelTab='related';state.panel=true;render();document.querySelector('[data-action="related-busy"]').click();`);
  await assert('related busy state preserves cached results and retry',`state.relatedStatus==='busy'&&document.querySelectorAll('.related-item').length===3&&document.querySelector('[data-action="related-retry"]')!==null`);
  await command('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
  await evaluate('localStorage.clear()');await navigate('?view=phone&screen=reader');
  await evaluate(`state.panel=false;render();document.querySelector('[data-scroll-pane="source"]').scrollTop=350;`);await sleep(80);
  await evaluate(`document.querySelector('[data-action="mode"][data-value="translation"]').click();`);await sleep(80);
  await assert('compact translation switch retains reading position',`document.querySelector('[data-scroll-pane="translation"]').scrollTop>200&&state.page===3`);
  await evaluate(`document.querySelector('[data-action="mode"][data-value="source"]').click();`);await sleep(80);
  await assert('compact source switch restores reading position',`document.querySelector('[data-scroll-pane="source"]').scrollTop>200&&state.page===3`);
  await evaluate(`window.originalHeader=document.querySelector('.reader-header').getBoundingClientRect().height;window.originalToolbar=document.querySelector('.reader-toolbar').getBoundingClientRect().height;document.querySelector('[data-action="tool"][data-value="pen"]').click();document.querySelector('.ink-canvas[data-pane="source"]').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerType:'touch',clientX:100,clientY:400}));`);
  await assert('finger input leaves ink empty and viewport stable',`state.strokes.source.length===0&&document.querySelector('.reader-header').getBoundingClientRect().height===window.originalHeader&&document.querySelector('.reader-toolbar').getBoundingClientRect().height===window.originalToolbar`);
  await evaluate(`state.screen='library';render();`);
  await assert('phone navigation stays visible',`document.querySelector('.mobile-nav').getBoundingClientRect().bottom<=innerHeight+1&&document.querySelector('.mobile-nav').getBoundingClientRect().top>0`);
  await assert('phone secondary metadata is at least 12px',`['.entry-publication','.research-authors','.entry-status','.research-tags'].every(s=>parseFloat(getComputedStyle(document.querySelector(s)).fontSize)>=12)`);
  await evaluate(`document.querySelector('[data-action="sort-menu"]').click();`);
  await assert('custom selector has listbox options and focus',`document.querySelector('[role="listbox"]')!==null&&document.activeElement.getAttribute('role')==='option'`);
  await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await assert('Escape closes selector and restores focus',`document.querySelector('.popover')===null&&document.activeElement.dataset.action==='sort-menu'`);
  await evaluate(`document.querySelector('[data-action="add-paper"]').click();`);
  await assert('dialog exposes modality and labelled input',`document.querySelector('[role="dialog"]').getAttribute('aria-modal')==='true'&&document.querySelector('label[for="paper-link"]')!==null`);
  const report = { generatedAt: new Date().toISOString(), browser: 'Microsoft Edge headless, CDP', base, status: 'Scholarly iteration 02 accepted by coordinator for implementation handoff', results, assertions, diagnostics };
  await writeFile(path.join(output, 'inspection.json'), JSON.stringify(report, null, 2) + '\n');
  if (diagnostics.length) throw new Error('Browser runtime errors: ' + diagnostics.length);
} finally {
  if (ws?.readyState === WebSocket.OPEN) { try { await command('Browser.close'); } catch {} ws.close(); }
  child.kill();
  await sleep(300);
  // Only remove the exact task-specific temporary profile created above.
  if (path.resolve(profile).startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(profile).startsWith('fractal-design-review-')) {
    try { await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch {}
  }
}
