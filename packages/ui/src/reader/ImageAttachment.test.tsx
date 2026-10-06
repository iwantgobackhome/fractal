import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ImageAttachmentChip, cropPageCanvas } from './ImageAttachment';
describe('image attachment chip', () => {
  it('caps crop dimensions and uses JPEG when PNG exceeds the transport limit', () => {
    const drawImage = vi.fn();
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage }),
      toDataURL: vi.fn((type: string) => (type === 'image/png' ? 'data:image/png;base64,' + 'A'.repeat(2_000_004) : 'data:image/jpeg;base64,/9j/small')),
    };
    vi.stubGlobal('document', { createElement: () => canvas });
    try {
      expect(cropPageCanvas({ width: 4000, height: 2000 } as HTMLCanvasElement, { x: 0, y: 0, width: 1, height: 1 })).toBe('/9j/small');
      expect([canvas.width, canvas.height]).toEqual([1600, 800]);
      expect(canvas.toDataURL).toHaveBeenCalledWith('image/jpeg', 0.85);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('shows a compact figure label and physical page, without page text', () => {
    const html = renderToStaticMarkup(
      <ImageAttachmentChip paperKey="paper" attachment={{ page: 5, bbox: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 }, kind: 'figure', label: '그림 3' }} />,
    );
    expect(html).toContain('image-attachment-chip');
    expect(html).toContain('그림 3 · p.5');
    expect(html.length).toBeLessThan(500);
  });
});
