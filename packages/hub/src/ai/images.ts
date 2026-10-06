import { createCanvas, loadImage } from '@napi-rs/canvas';

/** Decode only PNG crops, bound decoded dimensions, and shrink before provider transport. */
export async function prepareQuestionImage(data: string): Promise<string> {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw new Error('Invalid PNG attachment');
  const bytes = Buffer.from(data, 'base64');
  if (bytes.length > 3_000_000 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || bytes.length < 24)
    throw new Error('Invalid PNG attachment');
  const width = bytes.readUInt32BE(16),
    height = bytes.readUInt32BE(20);
  if (!width || !height || width * height > 32_000_000) throw new Error('PNG attachment dimensions are too large');
  const image = await loadImage(bytes);
  let scale = Math.min(1, 1600 / Math.max(width, height));
  for (let attempt = 0; attempt < 8; attempt++) {
    const canvas = createCanvas(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)));
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    const result = await canvas.encode('png');
    if (result.length <= 1_500_000) return result.toString('base64');
    scale *= 0.7;
  }
  throw new Error('PNG attachment could not be reduced');
}

export function isUnsupportedImageError(error: unknown): boolean {
  const officialMessage = (error as { officialMessage?: unknown } | null)?.officialMessage;
  const message = `${error instanceof Error ? error.message : String(error)} ${typeof officialMessage === 'string' ? officialMessage : ''}`;
  return /(?:image|vision|multimodal).*(?:not supported|unsupported|does not support|not available)|(?:not supported|unsupported|does not support).*(?:image|vision|multimodal)/i.test(
    message,
  );
}
