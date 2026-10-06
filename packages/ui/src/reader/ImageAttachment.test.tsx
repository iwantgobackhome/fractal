import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ImageAttachmentChip } from './ImageAttachment';
describe('image attachment chip', () => {
  it('shows a compact figure label and physical page, without page text', () => {
    const html = renderToStaticMarkup(
      <ImageAttachmentChip paperKey="paper" attachment={{ page: 5, bbox: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 }, kind: 'figure', label: '그림 3' }} />,
    );
    expect(html).toContain('image-attachment-chip');
    expect(html).toContain('그림 3 · p.5');
    expect(html.length).toBeLessThan(500);
  });
});
