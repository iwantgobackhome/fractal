import { describe, expect, it } from 'vitest';
import { readSse } from './hub-api';

function stream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

describe('readSse', () => {
  it('reassembles events split across chunks', async () => {
    const events = [];
    const body = stream(['event: delta\ndata: {"type":"delta","te', 'xt":"수식 "}\n\nevent: delta\ndata: {"type":"delta","text":"설명"}\n', '\nevent: done\ndata: {"type":"done","answer":{"text":"수식 설명","provider":"claude","model":"sonnet","inputTokens":null,"outputTokens":null,"durationMs":1},"latex":"E=mc^2"}\n\n']);
    for await (const event of readSse(body)) events.push(event);
    expect(events.map((e) => e.type)).toEqual(['delta', 'delta', 'done']);
    expect(events[1]).toEqual({ type: 'delta', text: '설명' });
    expect(events[2]).toMatchObject({ latex: 'E=mc^2' });
  });
});
