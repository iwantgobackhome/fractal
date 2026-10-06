import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import type { AiProvider, CompleteInput, ProviderDelta } from '../packages/hub/src/ai/provider';
import { ProviderRegistry } from '../packages/hub/src/ai/registry';
import { FtsLibrarySearch } from '../packages/hub/src/ai/library-search';
import { JsonSettingsStore } from '../packages/hub/src/ai/settings';
import { createApiServer } from '../packages/hub/src/api/index';
import { servedAssets } from '../packages/hub/src/main';
import { JobManager } from '../packages/hub/src/jobs/state';
import { SqlitePaperStore } from '../packages/hub/src/store/sqlite';
import { TranslationPipeline } from '../packages/hub/src/translation/index';
import type { Connection, PaperChat, Translator, Usage } from '@fractal/shared';

const root = resolve(import.meta.dirname, '..');
const model = 'gpt-6-sol';
const connection: Connection = { status: 'subscription', modelIds: [model], defaultModelId: model, limits: null };
const usage: Usage = { inputTokens: null, outputTokens: null, limits: null, observedAt: null };

function pdf(): Buffer {
  const title = 'Fractal Browser Smoke Paper';
  const stream = [
    'BT /F1 22 Tf 50 735 Td (Fractal Browser Smoke Paper) Tj ET',
    'BT /F1 15 Tf 50 685 Td (A readable line for highlighting and notes.) Tj ET',
    'BT /F1 15 Tf 50 660 Td (The measured result is forty two.) Tj ET',
  ].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Title (${title}) >>`,
  ];
  let content = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(content));
    content += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(content);
  content += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) content += `${String(offset).padStart(10, '0')} 00000 n \n`;
  content += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(content);
}

class FakeProvider implements AiProvider {
  readonly id: 'codex' | 'claude';
  constructor(id: 'codex' | 'claude') {
    this.id = id;
  }
  async status() {
    return { id: this.id, installed: true, loggedIn: true, version: 'e2e-stub' };
  }
  async listModels() {
    return [{ id: this.id === 'codex' ? model : 'sonnet', label: 'Stub model' }];
  }
  async *complete(_input: CompleteInput): AsyncIterable<ProviderDelta> {
    yield { type: 'text', text: 'The result is ' };
    await new Promise((resolve) => setTimeout(resolve, 1200));
    yield { type: 'text', text: 'forty two [p.1].' };
  }
  async usage() {
    return null;
  }
}

async function main(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'fractal-e2e-'));
  process.env.FRACTAL_DATA = directory;
  const store = new SqlitePaperStore(directory, join(directory, 'empty-paperread'));
  store.ensureRoot();
  const jobs = new JobManager(store);
  const translator: Translator = {
    connection: async () => connection,
    translate: async () => ({ text: 'stub', usage }),
    translatePage: async () => ({ results: [], usage }),
    disconnect: async () => {},
  };
  const chat: PaperChat = {
    ask: async (input) => {
      const text = 'The result is forty two [p.1].';
      input.onText?.(text);
      return { text, usage: { inputTokens: 1, cachedInputTokens: null, outputTokens: 8 } };
    },
    forget: async () => {},
  };
  const registry = new ProviderRegistry([new FakeProvider('codex'), new FakeProvider('claude')], new JsonSettingsStore(directory));
  const pipeline = new TranslationPipeline({ store, jobs, translator });
  const html = join(root, 'packages/ui/dist/index.html');
  const server = createApiServer({
    store,
    jobs,
    translator,
    pipeline,
    paperChat: chat,
    aiRegistry: registry,
    librarySearch: new FtsLibrarySearch(store),
    session: {
      startLogin: async () => {
        throw new Error('Login is disabled in e2e');
      },
      getLogin: async () => {
        throw new Error('Login is disabled in e2e');
      },
      cancelLogin: async () => {
        throw new Error('Login is disabled in e2e');
      },
      logout: async () => ({ connection }),
    },
    acquirer: {
      identify: (input) => (store.getPaper(input) === null ? null : input),
      resolve: async () => {
        throw new Error('Network acquire is disabled in e2e');
      },
      acquire: async () => {
        throw new Error('Network acquire is disabled in e2e');
      },
      reextract: async () => {
        throw new Error('Network acquire is disabled in e2e');
      },
    },
    clientHtml: () => readFileSync(html, 'utf8'),
    clientAssets: servedAssets(join(root, 'packages/ui/dist/assets')),
    log: () => {},
  });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let page: Awaited<ReturnType<Awaited<ReturnType<typeof chromium.launch>>['newPage']>> | undefined;
  try {
    const address = await server.listen(0);
    const url = `http://127.0.0.1:${address.port}`;
    const response = await fetch(`${url}/api/papers/upload`, {
      method: 'POST',
      headers: { Origin: url, 'x-paperread-token': server.token, 'Content-Type': 'application/pdf' },
      body: new Uint8Array(pdf()),
    });
    if (response.status !== 201) throw new Error(`PDF upload failed: ${response.status} ${await response.text()}`);
    const {
      data: { paper },
    } = (await response.json()) as { data: { paper: { paperKey: string } } };

    browser = await chromium.launch({ channel: process.env.FRACTAL_E2E_CHANNEL || 'msedge', headless: true });
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on('pageerror', (error) => console.error('Browser error:', error));
    page.setDefaultTimeout(15_000);
    await page.route('**/*', (route) => (new URL(route.request().url()).origin === url ? route.continue() : route.abort()));

    // A fresh install: Korean interface, first-run guide not finished (hub and browser agree).
    await fetch(`${url}/api/preferences`, {
      method: 'PUT',
      headers: { Origin: url, 'x-paperread-token': server.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ uiLanguage: 'ko', translationLanguage: 'ko', answerLanguage: 'auto', onboardingCompleted: false }),
    }).then((reply) => {
      if (!reply.ok && reply.status !== 404) throw new Error(`preferences PUT failed: ${reply.status}`);
    });
    await page.addInitScript(() => {
      if (sessionStorage.getItem('e2e-seeded') !== null) return;
      sessionStorage.setItem('e2e-seeded', '1');
      localStorage.setItem('fractal.uiLanguage', 'ko');
      localStorage.setItem(
        'fractal.preferences',
        JSON.stringify({ uiLanguage: 'ko', translationLanguage: 'ko', answerLanguage: 'auto', onboardingCompleted: false }),
      );
    });

    await page.goto(url);
    await page.locator('.welcome').waitFor();
    await page.locator('.welcome__top button').filter({ hasText: '건너뛰기' }).click();
    await page.locator('.discovery-desk').waitFor();
    console.log('PASS welcome guide shows first and can be skipped');
    console.log('PASS home renders');

    await page.goto(`${url}/#/library`);
    await page.locator('.index-tabs button').filter({ hasText: '이 기기의 논문' }).click();
    await page.locator('.research-entry').filter({ hasText: 'Fractal Browser Smoke Paper' }).waitFor();
    console.log('PASS library lists uploaded paper');

    await page.locator('.entry-read').click();
    await page.waitForURL(`**/#/paper/${encodeURIComponent(paper.paperKey)}`);
    const canvas = page.locator('.pdf-page[data-page="1"] canvas');
    await canvas.waitFor().catch(async (error) => {
      console.error('Reader page:', (await page.locator('body').innerText()).slice(0, 1200));
      throw error;
    });
    await page.locator('.textLayer span').filter({ hasText: 'A readable line' }).waitFor();
    assert.ok((await canvas.evaluate((element) => (element as HTMLCanvasElement).width)) > 0);
    console.log('PASS reader draws page 1');

    async function selectText(text = 'A readable line') {
      const span = page.locator('.textLayer span').filter({ hasText: text }).first();
      await span.scrollIntoViewIfNeeded();
      const box = await span.boundingBox();
      assert.ok(box);
      await page.mouse.move(box.x + 5, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + Math.min(box.width - 5, 190), box.y + box.height / 2, { steps: 8 });
      await page.mouse.up();
      await page.locator('.selection-menu:visible').waitFor();
    }
    await selectText();
    console.log('PASS drag opens selection menu');
    await page.locator('.selection-menu .hl-yellow').click();
    await page.locator('.highlight-box').first().waitFor();
    const highlights = (await (await fetch(`${url}/api/papers/${paper.paperKey}/highlights`)).json()) as { data: unknown[] };
    assert.ok(highlights.data.length > 0);
    console.log('PASS highlight is visible and persisted through API');

    await selectText();
    await page.locator('.selection-menu button').filter({ hasText: '메모' }).click();
    const editor = page.locator('.sticky-note textarea');
    await editor.waitFor();
    await editor.fill('Browser smoke note');
    await editor.blur();
    await page.locator('.reader-bar__action[aria-controls]').first().click();
    await page.locator('.panel-tabs [role="tab"]').first().click();
    await page.locator('.note__text').filter({ hasText: 'Browser smoke note' }).waitFor();
    console.log('PASS memo saves and appears in notes');

    await page.locator('.reader-bar__action[aria-controls]').first().click();
    page.once('dialog', (dialog) => void dialog.accept());
    await page.locator('.sticky-note button').filter({ hasText: '메모 삭제' }).click();
    await page.locator('.sticky-note').waitFor({ state: 'detached' });
    await selectText('The measured result');
    await page.locator('.selection-menu button').filter({ hasText: '질문' }).click();
    const popup = page.locator('.answer-popup').first();
    await popup.waitFor();
    // Ask attaches the passage to the next question instead of sending it.
    await popup.locator('.research-attachment').filter({ hasText: 'The measured res' }).waitFor();
    assert.equal(await popup.locator('.research-turn').count(), 0);
    const question = popup.getByRole('textbox', { name: '질문', exact: true });
    await question.fill('What is the measured result?');
    await popup.locator('button[type="submit"]').click();
    await popup.locator('.research-turn__user').filter({ hasText: 'What is the measured result?' }).waitFor();
    await popup.locator('.research-turn__quote').first().waitFor();
    assert.equal(await question.inputValue(), '');
    assert.equal(await popup.locator('.research-attachment').count(), 0);
    await popup.locator('.research-turn .md').filter({ hasText: 'The result is' }).waitFor();
    assert.match(await popup.locator('.research-turn__answer [role="status"]').first().innerText(), /작성 중/);
    await popup.locator('.research-turn .md').filter({ hasText: 'forty two' }).waitFor();
    console.log('PASS text drag Ask attaches a quote; sending streams an answer and clears the input');

    await popup.locator('.answer-popup__header').scrollIntoViewIfNeeded();
    const before = await popup.boundingBox();
    const heading = await popup.locator('.answer-popup__header strong').boundingBox();
    assert.ok(before && heading);
    await page.mouse.move(heading.x + 20, heading.y + heading.height / 2);
    await page.mouse.down();
    await page.mouse.move(heading.x + 100, heading.y + heading.height / 2 + 45, { steps: 8 });
    await page.mouse.up();
    const after = await popup.boundingBox();
    assert.ok(after && Math.hypot(after.x - before.x, after.y - before.y) > 20);
    console.log('PASS popup header drag changes position');
    const scrollBefore = await page
      .locator('.pane-body')
      .first()
      .evaluate((el) => el.scrollTop);
    await page
      .locator('.pane-body')
      .first()
      .evaluate((element) => {
        element.scrollTop += 60;
      });
    const scrolled = await popup.boundingBox();
    const scrollAfter = await page
      .locator('.pane-body')
      .first()
      .evaluate((el) => el.scrollTop);
    assert.ok(scrolled && scrollAfter > scrollBefore && Math.abs(scrolled.x - after.x) < 1 && Math.abs(scrolled.y - after.y + scrollAfter - scrollBefore) < 2);
    console.log('PASS dragged card scrolls with its original page');
    await popup.hover();
    await page.locator('.answer-source-highlight').first().waitFor();
    const qaDir = resolve(root, 'packages/ui/qa/answer-cards');
    await mkdir(qaDir, { recursive: true });
    await page.screenshot({ path: join(qaDir, 'source-highlight.png') });
    await popup.getByRole('button', { name: '답변 접기', exact: true }).click();
    assert.equal(await popup.locator('.answer-popup__content').isVisible(), false);
    // The collapsed marker is almost all button: dragging from its centre must move it.
    const collapsedMarker = popup.getByRole('button', { name: '답변 펼치기', exact: true });
    const markerBefore = await collapsedMarker.boundingBox();
    assert.ok(markerBefore);
    await page.mouse.move(markerBefore.x + markerBefore.width / 2, markerBefore.y + markerBefore.height / 2);
    await page.mouse.down();
    await page.mouse.move(markerBefore.x + markerBefore.width / 2 - 90, markerBefore.y + markerBefore.height / 2 + 70, { steps: 8 });
    await page.mouse.up();
    const markerAfter = await collapsedMarker.boundingBox();
    assert.ok(markerAfter && Math.hypot(markerAfter.x - markerBefore.x, markerAfter.y - markerBefore.y) > 40);
    assert.equal(await popup.locator('.answer-popup__content').isVisible(), false);
    console.log('PASS collapsed marker drags from its centre without expanding');
    await collapsedMarker.click();
    assert.equal(await popup.locator('.answer-popup__content').isVisible(), true);
    console.log('PASS popup collapses and expands');
    await page.keyboard.press('Escape');
    assert.equal(await popup.locator('.answer-popup__content').isVisible(), false);
    await popup.getByRole('button', { name: '답변 펼치기', exact: true }).click();
    console.log('PASS Escape collapses the popup');

    const modelPicker = popup.getByRole('combobox', { name: '질문 모델', exact: true });
    await modelPicker.click();
    const modelList = page.getByRole('listbox', { name: '질문 모델', exact: true });
    await modelList.waitFor();
    // Background refreshes (translation polling, catalog changes) re-render the app; the open
    // model list must survive them.
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.dispatchEvent(new Event('fractal:catalog-changed')));
      await page.waitForTimeout(400);
    }
    assert.equal(await modelList.isVisible(), true);
    await modelPicker.press('Escape');
    assert.equal(await popup.locator('.answer-popup__content').isVisible(), true);
    console.log('PASS popup model list stays open across reader updates');

    await question.fill('Why is that the result?');
    // Editing the input never hides earlier turns.
    assert.equal(await popup.locator('.research-turn').count(), 1);
    await popup.locator('button[type="submit"]').click();
    await popup.locator('.research-turn__user').filter({ hasText: 'Why is that the result?' }).waitFor();
    await page.waitForFunction(() => document.querySelectorAll('.answer-popup .research-turn .md').length >= 2);
    assert.equal(await popup.locator('.research-turn').count(), 2);
    console.log('PASS popup follow-up joins the same conversation');
    await popup.getByRole('button', { name: '답변 접기', exact: true }).click();
    assert.equal(await popup.getByRole('button', { name: '답변 펼치기', exact: true }).innerText(), '?');
    await selectText('The measured result');
    await page.locator('.selection-menu button').filter({ hasText: '질문' }).click();
    await page.waitForFunction(() => document.querySelectorAll('.answer-popup').length === 2);
    console.log('PASS second Ask retains the first card');
    const second = page.locator('.answer-popup').nth(1);
    await second.getByRole('textbox', { name: '질문', exact: true }).fill('Second card question');
    await second.locator('button[type="submit"]').click();
    await second.locator('.research-turn .md').first().waitFor();
    await page.screenshot({ path: join(qaDir, 'multiple-cards.png') });
    page.once('dialog', (dialog) => void dialog.accept());
    await second.getByRole('button', { name: '답변 삭제', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.answer-popup').length === 1);
    await popup.getByRole('button', { name: '답변 펼치기', exact: true }).click();
    page.once('dialog', (dialog) => void dialog.accept());
    await popup.getByRole('button', { name: '답변 삭제', exact: true }).click();
    await popup.waitFor({ state: 'detached' });
    console.log('PASS delete removes only the card');
    await page.locator('.reader-bar__action[aria-controls]').first().click();
    await page.locator('.panel-tabs [role="tab"]').filter({ hasText: '기록' }).click();
    await page.locator('.research-panel .research-thread').filter({ hasText: 'What is the measured result?' }).filter({ hasText: '2' }).waitFor();
    console.log('PASS popup conversation is listed in research history');
    await page.locator('.research-thread').filter({ hasText: 'What is the measured result?' }).click();
    await popup.waitFor();
    await popup.locator('.research-turn__user').filter({ hasText: 'Why is that the result?' }).waitFor();
    assert.equal(await popup.locator('.research-turn').count(), 2);
    await page.screenshot({ path: join(qaDir, 'history-reopened.png') });
    console.log('PASS History reopens the deleted card and its original conversation');
    page.once('dialog', (dialog) => void dialog.accept());
    await popup.getByRole('button', { name: '답변 삭제', exact: true }).click();
    await popup.waitFor({ state: 'detached' });

    await page.locator('.highlight-box').first().scrollIntoViewIfNeeded();
    const highlightBox = await page.locator('.highlight-box').first().boundingBox();
    assert.ok(highlightBox);
    await page.mouse.click(highlightBox.x + highlightBox.width / 2, highlightBox.y + highlightBox.height / 2);
    await page.locator('.highlight-popover').waitFor();
    await page.locator('.highlight-popover button').filter({ hasText: '삭제' }).click();
    await page.waitForFunction(() => !document.querySelector('.highlight-box'));
    const remaining = (await (await fetch(`${url}/api/papers/${paper.paperKey}/highlights`)).json()) as { data: unknown[] };
    assert.equal(remaining.data.length, 0);
    console.log('PASS clicking a highlight opens Delete and API confirms removal');

    await page.locator('.original-tools button').filter({ hasText: '영역' }).click();
    const regionPage = await page.locator('.pdf-page[data-page="1"]').boundingBox();
    assert.ok(regionPage);
    await page.mouse.move(regionPage.x + 70, regionPage.y + 210);
    await page.mouse.down();
    await page.mouse.move(regionPage.x + 240, regionPage.y + 300, { steps: 8 });
    const live = page.locator('.selection-live');
    await live.waitFor();
    const liveBox = await live.boundingBox();
    assert.ok(liveBox && liveBox.width > 100 && liveBox.height > 50);
    console.log('PASS region rectangle is visible before mouseup');
    await page.mouse.up();
    await page.locator('.selection-menu').waitFor();
    assert.equal(await live.count(), 0);
    await page.keyboard.press('Escape');

    // Seed saved placements directly so restore is covered even when the Hub placement
    // route is being integrated in a parallel worktree.
    const history = store.listHistory(paper.paperKey);
    const roots = history
      .filter((entry) => entry.question === 'What is the measured result?' || entry.question === 'Second card question')
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    assert.equal(roots.length, 2);
    const hadPlacementRoute = roots.every((entry) => entry.placement !== undefined);
    console.log(hadPlacementRoute ? 'PASS placement endpoint persisted card states' : 'NOTE placement route absent; client retained placements in memory');
    roots.forEach((entry, index) =>
      store.putHistory({
        ...entry,
        placement: { page: 1, x: index ? 0.75 : 0.35, y: 0.18, state: index ? 'collapsed' : 'open', updatedAt: new Date().toISOString() },
      }),
    );
    const countBeforeRestore = history.length;
    await page.reload();
    await page.waitForFunction(() => document.querySelectorAll('.answer-popup').length === 2);
    await page.locator('.answer-popup:not(.answer-popup--collapsed) .research-turn__user').filter({ hasText: 'Why is that the result?' }).waitFor();
    const marker = page.locator('.answer-popup--collapsed');
    assert.equal(await marker.getByRole('button', { name: '답변 펼치기', exact: true }).innerText(), '?');
    await page.screenshot({ path: join(qaDir, 'restored-cards.png') });
    assert.equal(store.listHistory(paper.paperKey).length, countBeforeRestore);
    console.log('PASS reader reopen restores saved open and collapsed cards without asking again');

    await page.goto(`${url}/#/settings`);
    await page.locator('#settings-ai').waitFor();
    await page.getByText('e2e-stub').first().waitFor();
    await page.locator('#settings-appearance').getByRole('combobox').click();
    await page.getByRole('option', { name: '어둡게', exact: true }).click();
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
    console.log('PASS settings providers and dark theme');
  } catch (error) {
    // Keep what the browser showed when a step failed.
    const shot = join(tmpdir(), 'fractal-e2e-failure.png');
    await page?.screenshot({ path: shot }).catch(() => undefined);
    console.error(`Screenshot of the failing step: ${shot}`);
    throw error;
  } finally {
    await browser?.close();
    await server.close();
    store.db.close();
    await rm(directory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
