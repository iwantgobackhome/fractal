import { useEffect, useState } from 'react';
import type { ImageAttachment } from '@fractal/shared';
import { loadPdf } from '../lib/pdf';

export function cropPageCanvas(source: HTMLCanvasElement, box: ImageAttachment['bbox']): string | undefined {
  if (!source.width || !source.height) return;
  const width = Math.max(1, Math.round(source.width * box.width)),
    height = Math.max(1, Math.round(source.height * box.height));
  const scale = Math.min(1, 1600 / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  canvas.getContext('2d')?.drawImage(source, source.width * box.x, source.height * box.y, width, height, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png').split(',')[1];
}

/** Render from the PDF, including when the original page has scrolled out of the viewport. */
export async function attachmentPng(paperKey: string, attachment: ImageAttachment): Promise<string | undefined> {
  const source = document.querySelector<HTMLCanvasElement>(`[data-testid="pdf-body"] .pdf-page[data-page="${attachment.page}"] canvas`);
  if (source?.width) return cropPageCanvas(source, attachment.bbox);
  const doc = await loadPdf(`/api/papers/${encodeURIComponent(paperKey)}/pdf`);
  try {
    const page = await doc.getPage(attachment.page),
      size = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(3, 1600 / Math.max(size.width * attachment.bbox.width, size.height * attachment.bbox.height)) });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport }).promise;
    return cropPageCanvas(canvas, attachment.bbox);
  } finally {
    await doc.loadingTask.destroy();
  }
}

export function ImageAttachmentChip({ paperKey, attachment }: { paperKey: string; attachment: ImageAttachment }) {
  const [png, setPng] = useState<string>();
  useEffect(() => {
    let alive = true;
    void attachmentPng(paperKey, attachment)
      .then((data) => {
        if (alive) setPng(data);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [paperKey, attachment.page, attachment.bbox.x, attachment.bbox.y, attachment.bbox.width, attachment.bbox.height]);
  return (
    <span className="research-image-attachment" data-testid="image-attachment-chip">
      {png ? <img src={`data:image/png;base64,${png}`} alt="" /> : <span aria-hidden="true">📎</span>}
      <span>
        {attachment.label} · p.{attachment.page}
      </span>
    </span>
  );
}
