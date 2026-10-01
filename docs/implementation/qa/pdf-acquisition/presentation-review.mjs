/** Bind read-only supplied bilingual owner proof to the accepted two-line presentation correction. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {resolve,join} from 'node:path';
const root=resolve(import.meta.dirname,'../../../..'),proof=join(root,'docs/implementation/desktop/pdf-reader-failure');
const source='c0a01b88a6f0141c57fb427344cb0e86ef011141';
const sha=b=>createHash('sha256').update(b).digest('hex');
const e=JSON.parse(readFileSync(join(proof,'browser-verification.json'),'utf8'));
const blob=ref=>execFileSync('git',['show',`${ref}:packages/ui/src/App.tsx`],{cwd:root});
assert.deepEqual(blob('HEAD'),blob(source));assert.equal(e.status,'passed');assert.equal(e.seededPdfBytes,false);assert.deepEqual(e.externalNavigation,[]);assert.deepEqual(e.errors,[]);
assert.equal(e.ownedBrowserExited,true);assert.equal(e.listenerReleased,true);
for(const [language,heading,context] of [['en','Could not open the original PDF','Original'],['ko','원본 PDF를 열지 못했습니다','원문']]){
 const c=e.cases.find(c=>c.language===language);assert.equal(c.heading,heading);assert.equal(c.context,context);
 for(const name of ['rawKeyAbsent','retryWorked','acquisitionSkipped','metadataPreserved'])assert.equal(c[name],true);
 for(const name of ['mountedPdf','recordedRecent'])assert.equal(c[name],false);
 assert.ok(c.display.length<=240);
}
const restored=e.cases.find(c=>c.name==='restored-primary-Read');assert.equal(restored.mountedPdf,true);assert.equal(restored.recentAfterActualRead,true);assert.equal(restored.retainedMetadataPreserved,true);assert.equal(restored.exactOriginalHash,e.reference.sha256);
const evidence={reviewedAt:new Date().toISOString(),acceptedQaHead:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),acceptedWindowsSource:source,status:'QA-PDF-2 source and actual bilingual owner browser proof closed; fresh final package evidence remains pending',sourceAppGitBlobSha256:sha(blob('HEAD')),ownerExecution:'Actual built UI/Hub/public scholarly bytes, independent read-only review; reviewer did not run this owner browser',ownerRecordedParent:e.source,parentVsAccepted:'Two presentation lines in working tree tested, then bound by clean c0a01b8',proofSha256:sha(readFileSync(join(proof,'browser-verification.json'))),cases:e.cases,reference:e.reference,screens:['browser-failure-en.png','browser-failure-ko.png'].map(name=>({name,sha256:sha(readFileSync(join(proof,name))),visuallyReviewed:true})),ownedBrowserExited:e.ownedBrowserExited,listenerReleased:e.listenerReleased,seededPdfBytes:e.seededPdfBytes,reviewerPeerRuntimeOperated:false};
writeFileSync(join(root,'docs/implementation/qa/pdf-acquisition/evidence/presentation-review.json'),JSON.stringify(evidence,null,2));console.log('Accepted bilingual presentation source/proof reviewed; fresh final package remains separate');
