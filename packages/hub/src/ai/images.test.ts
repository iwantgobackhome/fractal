import { describe, expect, it } from 'vitest';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { buildClaudeImageMessage } from './claude';
import { buildCodexQuestionInput } from '../codex/chat';
import { prepareQuestionImage } from './images';
import { ProviderRegistry } from './registry';
import type { AiProvider, CompleteInput, ProviderDelta } from './provider';

const crop = () => createCanvas(32, 32).toBuffer('image/png').toString('base64');
describe('image questions', () => {
  it('builds Claude stream-json with PNG image blocks and text', () => {
    expect(JSON.parse(buildClaudeImageMessage('Explain figure', [crop()]))).toEqual({
      type: 'user',
      message: {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: crop() } },
          { type: 'text', text: 'Explain figure' },
        ],
      },
    });
  });
  it('builds Codex v2 image inputs using data URLs without local files', () => {
    expect(buildCodexQuestionInput('Question', ['png'])).toEqual([
      { type: 'text', text: 'Question', text_elements: [] },
      { type: 'image', url: 'data:image/png;base64,png' },
    ]);
  });
  it('caps the longest side and rejects oversized decoded dimensions', async () => {
    const data = createCanvas(2000, 1000).toBuffer('image/png').toString('base64');
    const result = Buffer.from(await prepareQuestionImage(data), 'base64');
    const image = await loadImage(result);
    expect([image.width, image.height]).toEqual([1600, 800]);
    expect(result.length).toBeLessThanOrEqual(1_500_000);
    await expect(prepareQuestionImage('not-png')).rejects.toThrow('Invalid PNG');
    const huge = Buffer.from(crop(), 'base64');
    huge.writeUInt32BE(2000000, 16);
    await expect(prepareQuestionImage(huge.toString('base64'))).rejects.toThrow('dimensions');
  });
  it('falls back once for an unsupported image model and reports metadata', async () => {
    const seen: CompleteInput[] = [];
    const provider: AiProvider = {
      id: 'codex',
      status: async () => ({ id: 'codex', installed: true, loggedIn: true, version: 'test' }),
      listModels: async () => [{ id: 'model', label: 'Model' }],
      usage: async () => null,
      async *complete(input): AsyncIterable<ProviderDelta> {
        seen.push(input);
        if (input.images?.length)
          throw Object.assign(new Error('Official program request failed'), { officialMessage: 'This model does not support image input' });
        yield { type: 'text', text: 'Text answer' };
      },
    };
    const settings = { default: { provider: 'codex' as const, model: 'model' }, overrides: {} };
    const registry = new ProviderRegistry([provider], { read: async () => settings, write: async () => {} });
    const deltas = [];
    for await (const delta of registry.complete('explain', { system: 'Context', messages: [], images: [crop()] })) deltas.push(delta);
    expect(seen.map((input) => input.images?.length)).toEqual([1, 0]);
    expect(deltas[0]).toMatchObject({ imageFallbackReason: expect.stringContaining('text context') });
    expect(deltas[1]).toEqual({ type: 'text', text: 'Text answer' });
  });
});
