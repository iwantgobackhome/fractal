import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import type { AiProvider, CompleteInput, ProviderDelta } from '../../../packages/hub/src/ai/provider';
import { ProviderRegistry } from '../../../packages/hub/src/ai/registry';
import { FtsLibrarySearch } from '../../../packages/hub/src/ai/library-search';
import { JsonSettingsStore } from '../../../packages/hub/src/ai/settings';
import { createApiServer } from '../../../packages/hub/src/api/index';
import { servedAssets } from '../../../packages/hub/src/main';
import { JobManager } from '../../../packages/hub/src/jobs/state';
import { SqlitePaperStore } from '../../../packages/hub/src/store/sqlite';
import { TranslationPipeline } from '../../../packages/hub/src/translation/index';
import type { Connection, PaperChat, Translator, Usage } from '@fractal/shared';

const root = resolve(import.meta.dirname, '../../..');
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

    browser = await chromium.launch({ channel: process.env.FRACTAL_E2E_CHANNEL || 'chrome', headless: true });
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on('pageerror', (error) => console.error('Browser error:', error));
    page.setDefaultTimeout(15_000);
    await page.route('**/*', (route) => (new URL(route.request().url()).origin === url ? route.continue() : route.abort()));

    const requestThreads = new Map<string, string>();
    await page.route('**/api/papers/*/ask', async (route) => {
      const body = route.request().postDataJSON();
      requestThreads.set(body.requestId, body.threadId);
      await route.continue();
    });
    await page.route('**/api/papers/*/history', async (route) => {
      const response = await route.fetch();
      const result = await response.json();
      if (Array.isArray(result.data?.history))
        for (const entry of result.data.history) if (requestThreads.has(entry.requestId)) entry.context.threadId = requestThreads.get(entry.requestId);
      await route.fulfill({ response, json: result });
    });
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

    await page.locator('.reader-bar__action[aria-controls]').first().click();
    await page.locator('.panel-tabs [role="tab"]').filter({ hasText: '질문' }).click();
    const panel = page.locator('.chat-dock .research-panel');
    await panel.locator('textarea').fill('이 논문의 핵심 결과는 무엇인가요?');
    await panel.getByRole('button', { name: '전송', exact: true }).click();
    await panel.locator('.research-turn .md').filter({ hasText: 'forty two' }).waitFor();
    assert.equal(await panel.locator('textarea').inputValue(), '');
    await panel.locator('textarea').fill('이 결과를 어떻게 해석하면 좋을까요?');
    assert.equal(await panel.locator('.research-turn').count(), 1);
    await panel.getByRole('button', { name: '전송', exact: true }).click();
    await page.waitForFunction(
      () =>
        document.querySelectorAll('.chat-dock .research-turn .md').length === 2 &&
        [...document.querySelectorAll('.chat-dock .research-turn .md')].every((e) => e.textContent?.includes('forty two')),
    );
    assert.equal(await panel.locator('textarea').inputValue(), '');
    // Restore a persisted unsent attachment alongside the two retained turns.
    await page.evaluate((paperKey) => {
      const key = `fractal.research.${paperKey}`;
      const draft = JSON.parse(localStorage.getItem(key)!);
      draft.context = { id: 12345, page: 1, from: 'translation', text: '측정된 결과는 42이며, 이 결과의 의미를 다음 질문에서 확인합니다.' };
      draft.text = '이 인용문에 대해 더 설명해 주세요.';
      localStorage.setItem(key, JSON.stringify(draft));
    }, paper.paperKey);
    await page.reload();
    await page.locator('.reader-bar__action[aria-controls]').first().click();
    await page.locator('.panel-tabs [role="tab"]').filter({ hasText: '질문' }).click();
    await panel.locator('.research-turn').nth(1).waitFor();
    await panel.locator('.research-attachment').waitFor();
    await page.screenshot({ path: join(root, 'packages/ui/qa/question-thread/thread-with-chip.png') });
    await panel.locator('textarea').fill('');
    assert.equal(await panel.locator('.research-turn').count(), 2);
    await panel.getByRole('button', { name: '인용 제거' }).click();
    assert.equal(await panel.locator('.research-turn').count(), 2);
    const handle = page.getByRole('separator', { name: '질문 패널 너비 조절' });
    const before = await page.locator('.chat-dock').boundingBox();
    const box = await handle.boundingBox();
    assert.ok(before && box);
    await page.mouse.move(box.x + 3, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x - 180, box.y + box.height / 2, { steps: 10 });
    await page.mouse.up();
    const after = await page.locator('.chat-dock').boundingBox();
    assert.ok(after && after.width > before.width + 100);
    await page.screenshot({ path: join(root, 'packages/ui/qa/question-thread/resized-panel.png') });
    await handle.focus();
    await page.keyboard.press('ArrowRight');
    const keyboard = await page.locator('.chat-dock').boundingBox();
    assert.ok(keyboard && keyboard.width < after.width);
    await handle.dblclick();
    assert.equal(Math.round((await page.locator('.chat-dock').boundingBox())!.width), 380);
    await page.locator('.panel-tabs [role="tab"]').filter({ hasText: '기록' }).click();
    assert.equal(await panel.locator('.research-thread').count(), 1);
    await panel.locator('.research-thread').click();
    assert.equal(await panel.locator('.research-turn').count(), 2);
    await panel.getByRole('button', { name: '+ 새 질문', exact: true }).click();
    assert.equal(await panel.locator('.research-turn').count(), 0);
    // Passage Ask attaches and focuses; it does not send until the user submits.
    const span = page.locator('.textLayer span').filter({ hasText: 'The measured result' }).first();
    const selectionBox = await span.boundingBox();
    assert.ok(selectionBox);
    await page.mouse.move(selectionBox.x + 5, selectionBox.y + selectionBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(selectionBox.x + 170, selectionBox.y + selectionBox.height / 2, { steps: 8 });
    await page.mouse.up();
    await page.locator('.selection-menu button').filter({ hasText: '질문' }).click();
    const popup = page.locator('.answer-popup');
    await popup.locator('.research-attachment').waitFor();
    assert.equal(await popup.locator('.research-turn').count(), 0);
    assert.ok(await popup.locator('textarea').evaluate((element) => element === document.activeElement));
    await popup.locator('textarea').fill('이 구절을 설명해 주세요.');
    await popup.getByRole('button', { name: '전송', exact: true }).click();
    await popup.locator('.research-turn .md').filter({ hasText: 'forty two' }).waitFor();
    assert.equal(await popup.locator('.research-attachment').count(), 0);
    await popup.locator('textarea').fill('추가 질문입니다.');
    await popup.getByRole('button', { name: '전송', exact: true }).click();
    await popup.locator('.research-turn').nth(1).waitFor();
    await popup.getByRole('button', { name: '답변 닫기', exact: true }).click();
    await page.goto(`${url}/#/settings`);
    await page.locator('#pref-answer').waitFor();
    await page.locator('.settings-custom-language summary').click();
    await page.getByRole('textbox', { name: 'BCP47 언어 코드', exact: true }).fill('en-GB');
    await page.getByRole('button', { name: '언어 적용', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#pref-answer')?.textContent?.includes('en-GB'));
    await page.locator('.settings-custom-language').scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(root, 'packages/ui/qa/question-thread/settings-answer-language.png') });
    console.log(
      'PASS two-turn thread, draft restore, chip removal, send clear, resize pointer/keyboard/reset, grouped history, new question, popup attachments and follow-up, Settings custom answer language',
    );
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
