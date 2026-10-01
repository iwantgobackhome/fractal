/** Independent, bounded public-PDF pointer regression; Range only measures pixels. */
import assert from 'node:assert/strict';
import { access, mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chromium, _electron, type Page } from 'playwright-core';
import { startService } from '../../../../packages/hub/src/main';
import { extractPdf } from '../../../../packages/hub/src/pdf/index';

const root = resolve('.'), owned = join(root, 'docs/implementation/qa/integrated');
const output = join(owned, 'word-pointer-evidence');
await mkdir(output, { recursive: true });
const directory = await mkdtemp(join(owned, 'runtime/word-pointer-'));
process.env.FRACTAL_DATA = directory;
process.env.PAPERREAD_DATA = join(directory, 'empty-legacy');
process.env.NODE_ENV = 'test'; // Disable real provider CLIs/accounts in both actual Hub processes.
const bytes = await readFile(join(root, 'dist/qa-word-selection-input/attention-1706.03762.pdf'));
const hash = createHash('sha256').update(bytes).digest('hex');
assert.equal(hash, 'bdfaa68d8984f0dc02beaca527b76f207d99b666d31d1da728ee0728182df697');
const key = `pdf-${createHash('sha256').update('https://arxiv.org/pdf/1706.03762').digest('hex')}-${hash}`;
const service = await startService({ dataDirectory: directory, port: 0, indexHtml: join(root, 'packages/ui/dist/index.html'), allowRealCli: false, startBackground: false, log() {} });
const text = 'The dominant sequence transduction models are based on complex recurrent or';
const evidence: any = { sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), pdf: { bytes: bytes.length, sha256: hash }, cases: [], screenshots: [], errors: [], profile: directory, initialHub: service.url,
  scope: 'Independent E browser and own Electron development build; real Hub/PDF.js/SQLite, native pointer and system clipboard; Windows packaged gate separate' };
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let electron: Awaited<ReturnType<typeof _electron.launch>> | undefined;
let running = true;
async function screenshot(page: Page, label: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500); // Capture completed drawer/layout transitions.
  const path = join(output, label + '.png');
  await page.screenshot({ path });
  evidence.screenshots.push({ file: label + '.png', sha256: createHash('sha256').update(await readFile(path)).digest('hex') });
}
async function selection(page: Page) {
  return page.evaluate(() => {
    const s = getSelection()!, r = s.getRangeAt(0), box = r.getBoundingClientRect();
    return { text: s.toString(), start: r.startOffset, end: r.endOffset, backwards: s.anchorNode === r.endContainer && s.anchorOffset === r.endOffset,
      box: { x: box.x, y: box.y, width: box.width, height: box.height } };
  });
}
async function drag(page: Page, from: number, to: number, label: string, clipboard: () => Promise<string>, drift = false) {
  await page.keyboard.press('Escape');
  await page.evaluate(() => getSelection()?.removeAllRanges());
  await page.waitForTimeout(250);
  const points = await page.evaluate(({ text, from, to }) => {
    const span = [...document.querySelectorAll<HTMLElement>('[data-testid="text-layer-1"] span')].find(node => node.textContent === text)!;
    assertSpan(span);
    function assertSpan(node: HTMLElement) { if (!node?.firstChild) throw Error('Public academic run not rendered'); }
    span.scrollIntoView({ block: 'center' });
    const point = (offset: number) => {
      const r = document.createRange(); r.setStart(span.firstChild!, offset); r.setEnd(span.firstChild!, offset + 1);
      const b = r.getBoundingClientRect();
      for (const fraction of [.05, .15, .3]) {
        const p = { x: b.left + b.width * fraction, y: b.top + b.height / 2 };
        const caret = document.caretRangeFromPoint(p.x, p.y);
        if (caret?.startContainer === span.firstChild && caret.startOffset === offset) return p;
      }
      throw Error('No measured native caret pixel at requested endpoint');
    };
    return { from: point(from), to: point(to), metadata: { ...span.dataset }, runBox: span.getBoundingClientRect().toJSON() };
  }, { text, from, to });
  await page.mouse.move(points.from.x, points.from.y); await page.mouse.down();
  await page.mouse.move(points.to.x, points.to.y, { steps: 17 });
  const before = await selection(page);
  const expected = text.slice(Math.min(from, to), Math.max(from, to));
  assert.equal(before.text, expected, 'Actual native drag before release');
  await page.mouse.up();
  if (drift) await page.mouse.move(points.to.x + 110, points.to.y + 6);
  await page.locator('.selection-menu').waitFor();
  await page.waitForTimeout(100);
  const after = await selection(page);
  assert.equal(after.text, expected, 'Native selection remains exact after release/hover');
  assert.equal(after.start, Math.min(from, to)); assert.equal(after.end, Math.max(from, to));
  await page.keyboard.press('Control+C');
  const ctrlCopy = await clipboard(); assert.equal(ctrlCopy, expected);
  const result = { label, expected, before, after, ctrlCopy, points, drift };
  evidence.cases.push(result);
  return result;
}
async function run(page: Page, origin: string, kind: string, clipboard: () => Promise<string>) {
  await page.addInitScript('window.__name = (value) => value');
  page.on('pageerror', error => evidence.errors.push({ kind, message: error.message }));
  await page.goto(origin + '/#/paper/' + encodeURIComponent(key));
  await page.locator('[data-testid="pdf-body"] canvas').first().waitFor();
  await page.locator('.reader-bar__views button').first().click();
  await page.getByRole('button', { name: 'T', exact: true }).click();
  await page.locator('[data-testid="text-layer-1"] span[data-boundaries]').first().waitFor();
  const layout = await page.evaluate(async (key) => (await (await fetch(`/api/papers/${encodeURIComponent(key)}/text-layout?page=1`)).json()).data, key);
  assert.equal(layout.pdfSha256, hash);
  const run = layout.page.runs.find((r: any) => layout.page.text.slice(r.start, r.end) === text);
  assert.equal(run.granularity, 'run');
  assert.deepEqual(layout.page.boundaries.filter((n: number) => n >= run.start && n <= run.end), [run.start, run.end]);
  evidence[kind + 'Layout'] = { physicalPage: layout.page.page, extractionVersion: layout.extractionVersion, run };
  const word = await drag(page, 4, 12, kind + '-word-release-drift', clipboard, true);
  await screenshot(page, kind + '-word');
  await page.locator('.selection-menu').getByRole('button', { name: 'Copy', exact: true }).click();
  const menuCopy = await clipboard(); assert.equal(menuCopy, 'dominant'); Object.assign(word, { menuCopy });
  await page.locator('.selection-menu').waitFor({ state: 'hidden' });
  const partial = await drag(page, 11, 5, kind + '-backward-partial', clipboard);
  await page.locator('.selection-menu').getByRole('button', { name: 'Copy', exact: true }).click();
  const partialMenu = await clipboard(); assert.equal(partialMenu, 'ominan'); Object.assign(partial, { menuCopy: partialMenu });
  await page.locator('.selection-menu').waitFor({ state: 'hidden' });
  await drag(page, 4, 12, kind + '-persist-highlight', clipboard);
  await page.getByRole('button', { name: 'Yellow highlight', exact: true }).click();
  await page.locator('.highlight-marker').first().waitFor();
  const saved = await page.evaluate(async (key) => (await (await fetch(`/api/papers/${encodeURIComponent(key)}/highlights`)).json()).data.at(-1), key);
  assert.equal(saved.text, 'dominant'); assert.equal(saved.provenance.pdfSha256, hash);
  assert.equal(saved.provenance.coordinateSpace, 'rendered-page-normalized-v1'); assert.equal(saved.provenance.layoutRange, undefined);
  assert.equal(saved.page, 1); assert.ok(saved.rects[0].width < run.quad[2][0] - run.quad[0][0]);
  await page.reload(); await page.locator('.highlight-marker').first().waitFor();
  await page.locator('.highlight-marker').last().click(); await page.locator('.highlight-excerpt').waitFor();
  assert.equal(await page.locator('.highlight-excerpt').textContent(), 'dominant');
  evidence[kind + 'Highlight'] = { saved, renderedRects: await page.locator('.highlight-box').evaluateAll(nodes => nodes.map(node => node.getAttribute('style'))) };
  await screenshot(page, kind + '-reopened-highlight'); await page.keyboard.press('Escape');
  await drag(page, 11, 5, kind + '-question-quote', clipboard);
  await page.locator('.selection-menu').getByRole('button', { name: 'Ask', exact: true }).click();
  await page.locator('.research-context').waitFor();
  const draft = await page.evaluate(key => JSON.parse(localStorage.getItem(`fractal.research.${key}`)!).context, key);
  assert.equal(draft.text, 'ominan'); assert.equal(draft.provenance.pdfSha256, hash);
  assert.equal(draft.provenance.coordinateSpace, 'rendered-page-normalized-v1'); assert.equal(draft.provenance.layoutRange, undefined);
  await page.getByRole('button', { name: 'Close research panel' }).click();
  await page.reload(); await page.locator('.reader-bar').getByRole('button', { name: 'Ask', exact: true }).click();
  await page.locator('.research-context').waitFor(); assert.ok((await page.locator('.research-context').textContent())?.includes('ominan'));
  const reopened = await page.evaluate(key => JSON.parse(localStorage.getItem(`fractal.research.${key}`)!).context, key);
  assert.deepEqual(reopened, draft); evidence[kind + 'Quote'] = reopened;
  await page.locator('[data-testid="pdf-body"] canvas').first().waitFor();
  await screenshot(page, kind + '-reopened-quote');
}
try {
  service.store.putPreferences({ uiLanguage: 'en', translationLanguage: 'en', onboardingCompleted: true, answerLanguage: 'auto' });
  const extracted = await extractPdf(bytes, key);
  service.store.savePaper({ paperKey: key, title: 'Attention Is All You Need', authors: ['Ashish Vaswani et al.'], sourceKind: 'publication', arxivId: null, version: null,
    sourceUrl: 'https://arxiv.org/pdf/1706.03762', pdfSha256: hash, pageCount: extracted.coverage.totalPages, extractionVersion: extracted.extractionVersion,
    status: 'ready', coverage: extracted.coverage, createdAt: new Date().toISOString() }, bytes);
  service.store.saveBlocks(key, extracted.blocks);
  browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: service.url });
  await page.route('**/*', route => route.request().url().startsWith(service.url) || route.request().url().startsWith('blob:') ? route.continue() : route.abort());
  await run(page, service.url, 'browser', () => page.evaluate(() => navigator.clipboard.readText()));
  await browser.close(); browser = undefined; await service.stop(); running = false;
  evidence.browserStatus = 'passed';
  await writeFile(join(output, 'verification.json'), JSON.stringify(evidence, null, 2) + '\n');
  const executablePath = join(root, 'node_modules/electron/dist/electron.exe');
  const available = await access(executablePath).then(() => true, () => false);
  if (!available) {
    evidence.electronNotExecuted = 'Own node_modules/electron/dist/electron.exe is absent; no peer binary or optional download substituted. Accepted owner packaged proof remains a separate gate.';
    assert.deepEqual(evidence.errors, []);
    evidence.status = 'passed browser gates; native Electron not executed';
  } else {
  const profile = join(directory, 'electron-profile');
  electron = await _electron.launch({ executablePath, args: [root], env: { ...process.env, FRACTAL_DESKTOP_PROFILE: profile }, timeout: 60000 });
  const native = await electron.firstWindow(); await native.waitForLoadState('domcontentloaded');
  evidence.electronIdentity = await electron.evaluate(({ app }) => ({ pid: process.pid, executable: process.execPath, profile: app.getPath('userData'), packaged: app.isPackaged, appPath: app.getAppPath() }));
  assert.equal(resolve(evidence.electronIdentity.profile), resolve(profile));
  evidence.electronProcess = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process -Filter "ProcessId = ${evidence.electronIdentity.pid}" | Select-Object ProcessId,ExecutablePath,CommandLine,CreationDate | ConvertTo-Json -Compress`], { encoding: 'utf8' }));
  evidence.electronHub = new URL(native.url()).origin;
  await run(native, evidence.electronHub, 'electron', () => electron!.evaluate(({ clipboard }) => clipboard.readText()));
  assert.deepEqual(evidence.errors, []); evidence.status = 'passed';
  }
} catch (error) { evidence.status = 'failed'; evidence.failure = String(error); throw error; }
finally {
  if (browser) await browser.close();
  if (electron) { const process = electron.process(); await electron.close(); evidence.electronExited = process.exitCode !== null; }
  if (running) await service.stop();
  evidence.resources = 'Scoped own browser/Electron/service handles closed; ignored disposable profile/public PDF retained; no peer devices/processes/accounts operated';
  await writeFile(join(output, 'verification.json'), JSON.stringify(evidence, null, 2) + '\n');
}
console.log(`Independent real public-PDF pointer/copy/highlight/quote: ${evidence.status}`);
