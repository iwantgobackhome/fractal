import { describe, expect, it } from 'vitest';
import { buildClaudeImageMessage } from './claude';
import { buildCodexQuestionInput } from '../codex/chat';
import { prepareQuestionImage } from './images';
import { ProviderRegistry } from './registry';
import type { AiProvider, CompleteInput, ProviderDelta } from './provider';

const crop = () => 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKElEQVR4nO3NsQ0AAAzCMP5/un0CNkuZ41wybXsHAAAAAAAAAAAAxR4yw/wuPL6QkAAAAABJRU5ErkJggg==';
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
  it('validates headers without changing pixels and rejects excessive dimensions, bytes and malformed base64', async () => {
    await expect(prepareQuestionImage(crop())).resolves.toBe(crop());
    await expect(prepareQuestionImage('not-png')).rejects.toThrow('base64');
    const huge = Buffer.from(crop(), 'base64');
    huge.writeUInt32BE(4097, 16);
    await expect(prepareQuestionImage(huge.toString('base64'))).rejects.toThrow('dimensions');
    await expect(prepareQuestionImage(Buffer.alloc(2_000_001).toString('base64'))).rejects.toThrow('2 MB');
    await expect(prepareQuestionImage(Buffer.from('invalid header').toString('base64'))).rejects.toThrow('PNG or JPEG');
  });
  it('accepts JPEG SOF headers and builds both providers with JPEG media types', async () => {
    const jpeg = Buffer.from([255, 216, 255, 192, 0, 11, 8, 0, 32, 0, 32, 1, 1, 17, 0, 255, 217]).toString('base64');
    await expect(prepareQuestionImage(jpeg)).resolves.toBe(jpeg);
    expect(JSON.parse(buildClaudeImageMessage('Question', [jpeg])).message.content[0].source.media_type).toBe('image/jpeg');
    expect(buildCodexQuestionInput('Question', [jpeg])[1]).toEqual({ type: 'image', url: `data:image/jpeg;base64,${jpeg}` });
    await expect(prepareQuestionImage(Buffer.from([255, 216, 255, 192, 0, 11]).toString('base64'))).rejects.toThrow('header');
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
