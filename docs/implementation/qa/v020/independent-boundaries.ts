import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { articleImageCandidates, figureImageCandidates, imageDimensions, suitableImageUrl } from '../../../../packages/hub/src/feed/images';
import { publicGet } from '../../../../packages/hub/src/publication/network';
import { startHub } from '../../../../packages/hub/src/main';

const output = resolve('docs/implementation/qa/v020/data');
mkdirSync(output, { recursive: true });
const sha = (body: Buffer) => createHash('sha256').update(body).digest('hex');
const evidence = JSON.parse(readFileSync('docs/implementation/backend/v020-thumbnails/live-evidence.json', 'utf8'));
const backendData = 'C:/Users/Home/orca/workspaces/fractal/fractal-v020-thumbnails-backend/docs/implementation/backend/v020-thumbnails/data';
const result: Record<string, unknown> = {
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  capturedAt: new Date().toISOString(),
  scope: 'independent archived actual public byte/HTML checks plus controlled network boundaries and actual isolated Hub API; no live provider aggregation or desktop package claim',
};
const images = [];
for (const expected of evidence.proof.images) {
  const body = readFileSync(join(backendData, `${expected.kind}.image`));
  const served = readFileSync(join(backendData, `${expected.kind}.served.image`));
  assert.equal(sha(body), expected.sha256);
  assert.equal(sha(served), expected.sha256);
  assert.equal(body.length, expected.byteLength);
  assert.deepEqual(imageDimensions(body, 'image/png'), { width: expected.image.width, height: expected.image.height });
  assert.equal(`/api/feed/images/${sha(Buffer.from(expected.source))}`, expected.image.url);
  const html = readFileSync(join(backendData, `${expected.kind}.html`), 'utf8');
  const pageUrl = expected.kind === 'paper' ? 'https://arxiv.org/html/2609.40325v1' : expected.article;
  const candidates = expected.kind === 'paper' ? figureImageCandidates(html, pageUrl) : articleImageCandidates(html, pageUrl);
  assert.equal(candidates[0], expected.source);
  images.push({ kind: expected.kind, source: expected.source, sha256: sha(body), archivedServedSha256: sha(served), bytes: body.length, route: expected.image.url, candidates });
}
result.publicArchivedImages = images;

const page = 'https://publisher.example/paper/one';
const exclusions = `<figure><figcaption>Equation 1</figcaption><img src="/equation.png"></figure>
<figure class="supplement"><figcaption>Figure S1</figcaption><img src="/s1.png"></figure>
<figure><figcaption>Table 1</figcaption><img src="/table.png"></figure>
<figure><figcaption>Figure 1</figcaption><picture><source srcset="/first-small.png 400w, /first-large.png 1200w"><img src="/placeholder.png"></picture></figure>
<figure><figcaption>Figure 2</figcaption><img src="/later.png"></figure>`;
assert.deepEqual(figureImageCandidates(exclusions, page), ['https://publisher.example/first-large.png', 'https://publisher.example/first-small.png', 'https://publisher.example/later.png']);
for (const bad of ['http://publisher.example/image.png', '/logo.png', '/figure.svg', '/paper.pdf', 'https://user:secret@publisher.example/a.png', 'https://127.0.0.1/a.png']) assert.equal(suitableImageUrl(bad, page), null);

let bodyReads = 0;
await assert.rejects(publicGet(page, {
  lookup: async () => [{ address: '93.184.215.14', family: 4 }],
  acceptedContentTypes: ['text/html'],
  request: async () => ({ status: 200, headers: { 'content-type': 'application/pdf' }, body: { async *[Symbol.asyncIterator]() { bodyReads++; yield Buffer.alloc(1024); } } }),
}), /Unsupported response content type/);
assert.equal(bodyReads, 0);
let requests = 0;
await assert.rejects(publicGet(page, {
  lookup: async (host) => [{ address: host === 'publisher.example' ? '93.184.215.14' : '127.0.0.1', family: 4 }],
  request: async () => { requests++; return { status: 302, headers: { location: 'https://other.example/private' }, body: { async *[Symbol.asyncIterator]() {} } }; },
}));
assert.equal(requests, 1, 'redirect must be rejected before contacting private destination');
const abort = new AbortController();
const stalled = publicGet(page, { lookup: () => new Promise(() => {}), signal: abort.signal });
abort.abort();
await assert.rejects(stalled);
result.controlledBoundaries = { exclusionAndFigureVariantOrder: 'pass', pdfBodyNeverRead: 'pass', privateRedirectNotContacted: 'pass', stalledDnsCancellation: 'pass' };

const profile = join(output, `hub-${Date.now()}`);
process.env.PAPERREAD_DATA = join(profile, 'legacy');
const hub = await startHub({ dataDirectory: profile, port: 0, allowRealCli: false, startBackground: false, log() {} });
try {
  const response = await fetch(hub.url + '/api/papers');
  assert.equal(response.status, 200);
  const payload = await response.json() as { data: { papers: unknown[] }; papers?: unknown[] };
  assert.ok(Array.isArray(payload.data.papers));
  assert.equal(payload.papers, undefined);
  result.actualHubApi = { status: response.status, envelope: payload, oldPackagedSmokeExpression: Array.isArray(payload.papers), correctedExpression: Array.isArray(payload.data.papers) };
} finally { await hub.close(); }
result.cleanup = { hubClosed: true, isolatedProfile: profile, persistentHelperStarted: false, userOrPeerResourcesChanged: false };
const json = JSON.stringify(result, null, 2) + '\n';
writeFileSync(join(output, 'boundary-evidence.json'), json);
console.log(json);
