import { invalidInput } from '../store/errors';

export function imageMediaType(data: string): 'image/png' | 'image/jpeg' {
  return Buffer.from(data, 'base64')[0] === 0xff ? 'image/jpeg' : 'image/png';
}

/** Validate transport and headers without decoding pixels or loading native modules. */
export async function prepareQuestionImage(data: string): Promise<string> {
  if (data.length > 2_800_000 || data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data))
    throw invalidInput('Image attachment must contain valid base64');
  const bytes = Buffer.from(data, 'base64');
  if (bytes.toString('base64') !== data) throw invalidInput('Image attachment must contain valid base64');
  if (bytes.length > 2_000_000) throw invalidInput('Image attachment exceeds 2 MB; resize it before sending');
  let width = 0,
    height = 0;
  if (
    bytes.length >= 33 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    bytes.readUInt32BE(8) === 13 &&
    bytes.toString('ascii', 12, 16) === 'IHDR'
  ) {
    width = bytes.readUInt32BE(16);
    height = bytes.readUInt32BE(20);
  } else if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    let offset = 2;
    while (offset < bytes.length) {
      if (bytes[offset++] !== 0xff) break;
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) break;
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && length >= 8) {
        height = bytes.readUInt16BE(offset + 3);
        width = bytes.readUInt16BE(offset + 5);
        break;
      }
      offset += length;
    }
  }
  if (!width || !height) throw invalidInput('Image attachment must have a valid PNG or JPEG header');
  if (width > 4096 || height > 4096) throw invalidInput('Image attachment dimensions exceed 4096 pixels; resize it before sending');
  return data;
}

export function isUnsupportedImageError(error: unknown): boolean {
  const officialMessage = (error as { officialMessage?: unknown } | null)?.officialMessage;
  const message = `${error instanceof Error ? error.message : String(error)} ${typeof officialMessage === 'string' ? officialMessage : ''}`;
  return /(?:image|vision|multimodal).*(?:not supported|unsupported|does not support|not available)|(?:not supported|unsupported|does not support).*(?:image|vision|multimodal)/i.test(
    message,
  );
}
