import type { IncomingMessage } from 'node:http';
import type { PdfTextLayoutService } from '../../pdf/text-layout-service';
import { HttpError } from '../errors';
import { invalidInput } from '../../store/errors';
import { assertSafeKey } from '../../store/validate';
import { json, type Result } from './types';

export async function handlePdfText(method: string, segments: string[], request: IncomingMessage, service: PdfTextLayoutService): Promise<Result | undefined> {
  if (method !== 'GET' || segments.length !== 4 || segments[0] !== 'api' || segments[1] !== 'papers' || segments[3] !== 'text-layout') return undefined;
  const values = new URL(request.url ?? '/', 'http://localhost').searchParams.getAll('page');
  if (values.length !== 1 || !/^[1-9]\d*$/.test(values[0])) throw invalidInput('Specify one positive integer page query parameter');
  let key: string;
  try {
    key = decodeURIComponent(segments[2]);
  } catch {
    throw invalidInput('Invalid paper key encoding');
  }
  assertSafeKey(key);
  try {
    return json(await service.read(key, Number(values[0])));
  } catch (cause) {
    if ((cause as { error?: { code: string } })?.error?.code === 'BUSY')
      throw new HttpError(503, { code: 'BUSY', message: 'Text geometry is busy; retry this page shortly', retryable: true });
    throw cause;
  }
}
