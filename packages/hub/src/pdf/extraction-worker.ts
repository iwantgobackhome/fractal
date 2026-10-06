import { parentPort, workerData } from 'node:worker_threads';
import { extractPdfInProcess, type ExtractionOptions } from './index';

const { bytes, paperKey, options } = workerData as { bytes: Uint8Array; paperKey: string; options: ExtractionOptions };
try {
  const result = await extractPdfInProcess(
    bytes,
    paperKey,
    { ...options, onProgress: (completed, total) => parentPort!.postMessage({ progress: [completed, total] }) },
    false,
  );
  parentPort!.postMessage({ result });
} catch (cause) {
  const error = cause as { code?: string; message?: string; retryable?: boolean; reason?: string };
  parentPort!.postMessage({ error: { code: error.code, message: error.message, retryable: error.retryable, reason: error.reason } });
}
