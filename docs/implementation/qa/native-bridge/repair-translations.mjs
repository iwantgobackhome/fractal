// Repair only active disposable QA preferences through the accepted real route.
// Do not restart server, alter native sources or fabricate an Android snapshot.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
const owned = 'docs/implementation/qa/native-bridge';
const d = JSON.parse(readFileSync(owned + '/runtime/D-private.json'));
const e = JSON.parse(readFileSync(owned + '/runtime/E-private.json'));
const headers = { Authorization: `Bearer ${d.deviceToken}`, 'Content-Type': 'application/json' };
async function data(path, options = {}) {
  const response = await fetch(d.baseUrl + path, { headers, ...options });
  assert.equal(response.status, 200);
  return (await response.json()).data;
}
const beforePrefs = await data('/api/preferences');
const beforeSnapshot = await data('/api/papers/D-reader-catalog');
const beforeHistory = (await data('/api/papers/D-reader-catalog/history')).history;
const afterPrefs = await data('/api/preferences', { method: 'PUT', body: JSON.stringify({ ...beforePrefs, translationLanguage: 'en' }) });
const afterSnapshot = await data('/api/papers/D-reader-catalog');
const afterHistory = (await data('/api/papers/D-reader-catalog/history')).history;
assert(afterSnapshot.translations.length > 0);
assert(afterSnapshot.translations.every(t => t.status === 'completed' && t.promptVersion === 'paperread-v1-en'));
assert.deepEqual(beforeHistory, afterHistory, 'Preferences repair must preserve D history');
const eResponse = await fetch(e.baseUrl + '/api/papers/qa-reader-catalog', { headers: { Authorization: `Bearer ${e.deviceToken}` } });
assert.equal(eResponse.status, 200);
const eSnapshot = (await eResponse.json()).data;
assert(eSnapshot.translations.length > 0);
const evidence = { cause: 'Harness seeded English promptVersion while inherited translationLanguage was Korean',
  productionDefect: false, serverRestarted: false, androidFabrication: false, method: 'PUT /api/preferences through accepted paired HTTP',
  beforePreferences: beforePrefs, afterPreferences: afterPrefs, beforeDTranslationCount: beforeSnapshot.translations.length,
  afterDTranslationCount: afterSnapshot.translations.length, dBlockCount: afterSnapshot.blocks.length,
  completedPromptVersions: [...new Set(afterSnapshot.translations.map(t => t.promptVersion))],
  dHistoryCount: afterHistory.length, dHistoryByteIdentical: JSON.stringify(beforeHistory) === JSON.stringify(afterHistory),
  afterETranslationCount: eSnapshot.translations.length,
  exampleDTranslation: afterSnapshot.translations[0], captured: new Date().toISOString() };
writeFileSync(owned + '/evidence/translation-repair.json', JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify({ repaired: true, beforeDTranslationCount: evidence.beforeDTranslationCount, afterDTranslationCount: evidence.afterDTranslationCount,
  afterETranslationCount: evidence.afterETranslationCount, dHistoryPreserved: evidence.dHistoryByteIdentical, serverRestarted: false }));
