import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { defaultPreferences } from '@fractal/shared';
import { SqlitePaperStore } from '../store/sqlite';
import { localizeError } from './localize';
import { PROMPT_VERSION, translationPromptVersion } from '../translation/index';
import { translationPrompt, translationPagePrompt } from '../translation/prompt';
import { createApiServer, type ApiServerOptions } from './index';
import { JobManager } from '../jobs/state';
import { TranslationPipeline } from '../translation/index';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));
const root = () => {
  const path = mkdtempSync(join(tmpdir(), 'fractal-preferences-'));
  roots.push(path);
  return path;
};

describe('language preferences', () => {
  it('serves GET and PUT through the guarded HTTP API', async () => {
    const store = new SqlitePaperStore(root());
    const jobs = new JobManager(store);
    const translator = {
      connection: async () => ({ status: 'signed_out', modelIds: [], defaultModelId: null, limits: null }),
      disconnect: async () => {},
    } as unknown as ApiServerOptions['translator'];
    const server = createApiServer({
      store,
      jobs,
      translator,
      pipeline: new TranslationPipeline({ store, jobs, translator }),
      paperChat: {
        ask: async () => {
          throw new Error('unused');
        },
        forget: async () => {},
      },
      acquirer: {} as ApiServerOptions['acquirer'],
      token: 'a'.repeat(64),
    });
    const address = await server.listen(0);
    const url = `http://127.0.0.1:${address.port}`;
    try {
      const before = await (await fetch(`${url}/api/preferences`)).json();
      expect(before.data).toEqual(defaultPreferences());
      const value = { uiLanguage: 'en', translationLanguage: 'fr', answerLanguage: 'auto', onboardingCompleted: true };
      const response = await fetch(`${url}/api/preferences`, {
        method: 'PUT',
        headers: { Origin: url, 'x-paperread-token': server.token, 'content-type': 'application/json' },
        body: JSON.stringify(value),
      });
      expect(response.status).toBe(200);
      expect((await response.json()).data).toEqual(value);
      expect((await (await fetch(`${url}/api/preferences`)).json()).data).toEqual(value);
    } finally {
      await server.close();
      store.db.close();
    }
  });

  it('uses OS locale defaults and persists a complete preference round trip in migration 6', () => {
    expect(defaultPreferences('ko-KR')).toEqual({ uiLanguage: 'ko', translationLanguage: 'ko', answerLanguage: 'auto', onboardingCompleted: false });
    expect(defaultPreferences('en-US').translationLanguage).toBe('en');
    const path = root();
    const store = new SqlitePaperStore(path);
    expect(store.getPreferences()).toEqual(defaultPreferences());
    const value = { uiLanguage: 'en' as const, translationLanguage: 'zh-Hant' as const, answerLanguage: 'ja' as const, onboardingCompleted: true };
    expect(store.putPreferences(value)).toEqual(value);
    store.db.close();
    const reopened = new SqlitePaperStore(path);
    expect(reopened.getPreferences()).toEqual(value);
    expect(reopened.db.prepare('SELECT count(*) n FROM migrations WHERE version=6').get()).toMatchObject({ n: 1 });
    reopened.db.close();
  });

  it('keeps Korean prompts intact and gives other languages distinct identities and faithful rules', () => {
    const block = { blockId: 'b1', sourceText: 'The value is 42 [1].' } as Parameters<typeof translationPrompt>[0]['block'];
    const input = { block, context: 'A paper', modelId: 'gpt-6-sol' };
    expect(translationPrompt(input)).toEqual(translationPrompt({ ...input, targetLanguage: 'ko' }));
    expect(translationPrompt(input)).toContain('원문 문단 전체를 한국어로 충실히 번역합니다.');
    expect(translationPrompt({ ...input, targetLanguage: 'ja' })).toContain('faithfully into Japanese');
    expect(translationPagePrompt({ paragraphs: [{ number: 1, block }], context: '', modelId: 'gpt-6-sol', targetLanguage: 'fr' })).toContain(
      'faithfully into French',
    );
    expect(translationPromptVersion('ko')).toBe(PROMPT_VERSION);
    expect(translationPromptVersion('en')).not.toBe(translationPromptVersion('ja'));
  });

  it('keeps completed translations for both languages when switching back', () => {
    const store = new SqlitePaperStore(root());
    const key = '2501.00001v1';
    const sourceText = 'A measured result.';
    const sourceHash = createHash('sha256').update(sourceText).digest('hex');
    store.savePaper({
      paperKey: key,
      arxivId: '2501.00001',
      version: 1,
      title: 'A Paper',
      authors: [],
      sourceUrl: 'https://arxiv.org/pdf/2501.00001v1',
      pdfSha256: sourceHash,
      pageCount: 1,
      extractionVersion: 'test',
      status: 'ready',
      coverage: { totalPages: 1, textPages: 1, unsupportedPages: [] },
      createdAt: new Date().toISOString(),
    });
    store.saveBlocks(key, [
      {
        blockId: 'b1',
        paperKey: key,
        order: 0,
        kind: 'paragraph',
        sourceText,
        sourceHash,
        regions: [{ page: 1, x: 0, y: 0, width: 1, height: 0.1 }],
        alignment: 'exact',
        translatable: true,
        fontFamily: 'serif',
        fontWeight: 'normal',
        fontSize: 0.1,
        pageOrdinal: 1,
      },
    ]);
    const jobs = new JobManager(store);
    const first = jobs.startJob(key, 'gpt-6-sol', translationPromptVersion('ko'));
    const completed = (text: string, promptVersion: string) => ({
      blockId: 'b1',
      sourceHash,
      modelId: 'gpt-6-sol',
      promptVersion,
      status: 'completed' as const,
      text,
      error: null,
      completedAt: new Date().toISOString(),
    });
    store.saveTranslation(key, completed('결과', translationPromptVersion('ko')));
    const second = jobs.restartJob(key, { modelId: 'gpt-6-sol', requestId: randomUUID(), expectedJobId: first.jobId }, translationPromptVersion('en'));
    store.saveTranslation(key, completed('Result', translationPromptVersion('en')));
    jobs.restartJob(key, { modelId: 'gpt-6-sol', requestId: randomUUID(), expectedJobId: second.jobId }, translationPromptVersion('ko'));
    expect(store.findReusableTranslation(key, 'b1', sourceHash, 'gpt-6-sol', translationPromptVersion('ko'))?.text).toBe('결과');
    expect(store.findReusableTranslation(key, 'b1', sourceHash, 'gpt-6-sol', translationPromptVersion('en'))?.text).toBe('Result');
    store.db.close();
  });

  it('localizes errors without changing their machine code', () => {
    const error = { code: 'UNSUPPORTED_PDF' as const, message: '스캔된 PDF입니다.', retryable: false };
    expect(localizeError(error, 'ko')).toEqual(error);
    expect(localizeError(error, 'en')).toEqual({ ...error, message: 'This PDF is not supported.' });
  });
});
