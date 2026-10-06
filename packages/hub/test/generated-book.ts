import { deflateSync } from 'node:zlib';

/** Generated in memory only: real page trees, text streams and optional unique RGB images. */
export function generatedBook(pageCount: number, images = false): Buffer {
  const objects: Buffer[] = [];
  const add = (value: string | Buffer) => {
    objects.push(typeof value === 'string' ? Buffer.from(value) : value);
    return objects.length;
  };
  const stream = (data: Buffer, extra = '') =>
    Buffer.concat([Buffer.from(`<< /Length ${data.length} ${extra} >>\nstream\n`), data, Buffer.from('\nendstream')]);
  add('<< /Type /Catalog /Pages 2 0 R >>');
  add('');
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const kids: number[] = [];
  for (let page = 1; page <= pageCount; page++) {
    let image = 0;
    if (images) {
      const rgb = Buffer.alloc(128 * 128 * 3);
      let seed = page;
      for (let i = 0; i < rgb.length; i++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
        rgb[i] = seed >>> 24;
      }
      image = add(
        stream(deflateSync(rgb), '/Type /XObject /Subtype /Image /Width 128 /Height 128 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode'),
      );
    }
    const lines = Array.from(
      { length: 30 },
      (_, line) => `BT /F1 12 Tf 50 ${740 - line * 18} Td (Book page ${page} line ${line + 1}: a measured result with readable text.) Tj ET`,
    );
    if (images) lines.push('q 100 0 0 100 480 50 cm /Im1 Do Q');
    const contents = add(stream(Buffer.from(lines.join('\n'))));
    kids.push(
      add(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> ${image ? `/XObject << /Im1 ${image} 0 R >>` : ''} >> /Contents ${contents} 0 R >>`,
      ),
    );
  }
  objects[1] = Buffer.from(`<< /Type /Pages /Kids [${kids.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageCount} >>`);
  const chunks = [Buffer.from('%PDF-1.4\n')];
  const offsets = [0];
  let length = chunks[0].length;
  for (const [index, object] of objects.entries()) {
    offsets.push(length);
    const chunk = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`), object, Buffer.from('\nendobj\n')]);
    chunks.push(chunk);
    length += chunk.length;
  }
  chunks.push(
    Buffer.from(
      `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
        .slice(1)
        .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
        .join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF`,
    ),
  );
  return Buffer.concat(chunks);
}
