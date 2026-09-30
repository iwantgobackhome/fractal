// Validate newly published QA controls using E's fixture only; no native lifecycle claim.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
const owned = 'docs/implementation/qa/native-bridge';
const connection = JSON.parse(readFileSync(owned + '/runtime/E-private.json'));
const headers = { Authorization: `Bearer ${connection.deviceToken}`, 'Content-Type': 'application/json' };
const state = async () => (await (await fetch('http://127.0.0.1:6175/E/state')).json()).data;
const result = [];
for (const mode of ['success', 'error']) {
  const flightId = `E-FLIGHT-harness-${mode}`;
  const response = await fetch(connection.baseUrl + '/api/papers/qa-reader-catalog/ask', { method: 'POST', headers,
    body: JSON.stringify({ question: `${flightId} QA_WAIT ${mode === 'error' ? 'QA_ERROR' : ''}`, page: 2, modelId: 'gpt-6-sol', requestId: flightId }) });
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  const initial = await reader.read();
  assert(initial.value);
  let before;
  for (let n = 0; n < 50; n++) {
    before = await state();
    if (before.flights.some(f => f.id === flightId && f.status === 'waiting')) break;
    await new Promise(r => setTimeout(r, 20));
  }
  assert(before.flights.some(f => f.id === flightId && f.status === 'waiting'));
  const release = await fetch('http://127.0.0.1:6175/E/release', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ flightId }) });
  assert.equal(release.status, 200); await release.arrayBuffer();
  const chunks = [initial.value];
  while (true) { const chunk = await reader.read(); if (chunk.done) break; chunks.push(chunk.value); }
  const raw = Buffer.concat(chunks).toString();
  const after = await state();
  const history = after.history.find(h => h.requestId === flightId);
  assert.equal(history.status, mode === 'success' ? 'completed' : 'failed');
  if (mode === 'error') assert.equal(history.error.code, 'NETWORK');
  result.push({ mode, flightId, waitingBeforeRelease: true, http: response.status, status: history.status, errorCode: history.error?.code ?? null,
    sseEvents: raw.split('\n').filter(l => l.startsWith('event:')), owner: 'E', nativeExecuted: false });
}
writeFileSync(owned + '/evidence/provider-smoke.json', JSON.stringify(result, null, 2) + '\n');
console.log('E-only deterministic delayed success/error control smoke passed');
