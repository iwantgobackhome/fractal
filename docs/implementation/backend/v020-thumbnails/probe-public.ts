import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { parseHTML } from 'linkedom';
import { fetchPublicArticle, fetchPublicImage, figureImageCandidates, articleImageCandidates, imageDimensions } from '../../../../packages/hub/src/feed/images';

const root = resolve('docs/implementation/backend/v020-thumbnails/data');
mkdirSync(root, { recursive: true });
for (const [kind, url] of [
  ['paper', 'https://arxiv.org/html/2609.40325v1'],
  ['news', 'https://news.mit.edu/2024/ai-generates-high-quality-images-30-times-faster-single-step-0321'],
] as const) {
  try {
    const page = await fetchPublicArticle(url);
    writeFileSync(join(root, `${kind}.html`), page.html);
    const candidates = kind === 'paper' ? figureImageCandidates(page.html, page.url) : articleImageCandidates(page.html, page.url);
    const { document } = parseHTML(page.html);
    const order = [...document.querySelectorAll('img')].map((img, index) => ({
      index,
      src: img.getAttribute('src'),
      alt: img.getAttribute('alt'),
      context: img.parentElement?.outerHTML.slice(0, 400),
    }));
    const image = candidates[0] ? await fetchPublicImage(candidates[0]) : null;
    if (image) writeFileSync(join(root, `${kind}.image`), image.body);
    const evidence = {
      kind,
      source: url,
      finalURL: page.url,
      title: document.querySelector('title')?.textContent,
      candidates,
      order: order.slice(0, 15),
      image: image && {
        source: candidates[0],
        finalURL: image.url,
        contentType: image.contentType,
        bytes: image.body.length,
        sha256: createHash('sha256').update(image.body).digest('hex'),
        dimensions: imageDimensions(image.body, image.contentType),
      },
    };
    writeFileSync(join(root, `${kind}.json`), JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify(evidence));
  } catch (error) {
    console.log(JSON.stringify({ kind, error: String(error) }));
    process.exitCode = 1;
  }
}
