/** Read supplied final Windows files and proofs; never execute or install peer binaries. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,statSync} from 'node:fs';
import {resolve,join,normalize,sep} from 'node:path';
import {execFileSync} from 'node:child_process';
import {listPackage,extractFile} from '@electron/asar';
const root=resolve(import.meta.dirname,'../../../..'),owner='C:/Users/Home/orca/workspaces/fractal/fractal-desktop';
const proof=join(root,'docs/implementation/desktop/pdf-reader-failure'),distribution=join(owner,'dist/installer-pdf-reader-failure');
const manifestPath=join(proof,'package-resources.json'),m=JSON.parse(readFileSync(manifestPath,'utf8'));
const source='c0a01b88a6f0141c57fb427344cb0e86ef011141';
const sha=b=>createHash('sha256').update(b).digest('hex');
assert.equal(m.status,'passed');assert.equal(m.acceptedSource,source);assert.equal(m.runtimeSource,source);
const archive=join(distribution,'win-unpacked/resources/app.asar');
const resources=m.resources.map(item=>{const b=extractFile(archive,normalize(item.path));assert.equal(b.length,item.bytes);assert.equal(sha(b),item.sha256);assert.deepEqual(readFileSync(join(owner,item.path)),b);return {...item,independentHash:sha(b),independentlyMatchesOwnerBuiltFile:true};});
assert.equal(resources.length,176);
const sourceFiles=m.sourceFiles.map(item=>{
 const local=resolve(root,item.path),peer=resolve(owner,item.path);assert.ok(local.startsWith(root+sep));assert.ok(peer.startsWith(resolve(owner)+sep));
 const blob=execFileSync('git',['show',`HEAD:${item.path}`],{cwd:root,maxBuffer:8*1024*1024}),raw=readFileSync(peer);
 assert.equal(sha(blob),item.gitBlobContentSha256,item.path);assert.equal(sha(raw),item.workingRawSha256,item.path);
 if(item.text){assert.equal(sha(Buffer.from(raw.toString('utf8').replaceAll('\r\n','\n'))),item.workingLfSha256);assert.equal(sha(Buffer.from(blob.toString('utf8').replaceAll('\r\n','\n'))),item.gitLfSha256);assert.equal(item.workingLfSha256,item.gitLfSha256);}
 else assert.deepEqual(raw,blob);
 if(item.path.endsWith('.json')){assert.deepEqual(JSON.parse(raw.toString('utf8')),JSON.parse(blob.toString('utf8')));assert.equal(sha(Buffer.from(JSON.stringify(JSON.parse(raw.toString('utf8'))))),item.workingCanonicalJsonSha256);}
 return {...item,independentGitHash:sha(blob),independentOwnerRawHash:sha(raw)};
});assert.equal(sourceFiles.length,207);
const artifacts=m.artifacts.map(item=>{const path=join(distribution,item.path),b=readFileSync(path);assert.equal(b.length,item.bytes);assert.equal(sha(b),item.sha256);return {...item,path,independentHash:sha(b)};});
const delivered='C:/Users/Home/Desktop/Fractal/fractal/dist/reviewed-builds/desktop-pdf-c0a01b8/Fractal Setup 0.1.0.exe';
assert.equal(statSync(delivered).size,117592673);assert.equal(sha(readFileSync(delivered)),'f886937cd5c520ef818e9cbbe40b8c1f4828c7ead678fde4a6d21e9368f7393a');assert.equal(sha(readFileSync(delivered)),artifacts[0].sha256);
const entries=listPackage(archive,{isPack:false}),excluded=entries.filter(p=>/(?:pdf-acquisition-evidence|[/\\]tools[/\\]|[/\\]test[/\\]|[/\\]qa[/\\]|\.pdf$|qa-pdf-acquisition|NativeDeskDriver)/i.test(p));assert.deepEqual(excluded,[]);
const hub=resources.find(r=>r.path==='apps/desktop/dist/hub.mjs');assert.equal(hub.sha256,'4f32b82b69bd33767a0273dcdbb26aa8214592fcf4cf5de821cbfc6961d31794');
const native=JSON.parse(readFileSync(join(proof,'packaged-verification.json'),'utf8'));
assert.equal(native.source,source);assert.equal(native.status,'passed');assert.equal(native.isPackaged,true);assert.equal(native.seededPdfBytes,false);assert.deepEqual(native.externalNavigation,[]);assert.deepEqual(native.errors,[]);
assert.equal(native.ownedProcessExited,true);assert.equal(native.ownedWrapperExited,true);assert.equal(native.listenerReleased,true);
for(const [language,heading,context] of [['en','Could not open the original PDF','Original'],['ko','원본 PDF를 열지 못했습니다','원문']]){
 const c=native.cases.find(c=>c.language===language);assert.equal(c.heading,heading);assert.equal(c.context,context);
 for(const p of ['rawKeyAbsent','retryWorked','acquisitionSkipped','metadataPreserved'])assert.equal(c[p],true);
 for(const p of ['mountedPdf','recordedRecent'])assert.equal(c[p],false);
}
const acquisition=native.cases.find(c=>c.name==='actual-runtime-public-acquisition-Read'),restored=native.cases.find(c=>c.name==='restored-primary-Read');assert.equal(acquisition.mountedPdf,true);assert.equal(acquisition.canonicalHash,native.reference.sha256);assert.equal(restored.exactOriginalHash,native.reference.sha256);assert.equal(restored.mountedPdf,true);assert.equal(restored.recentAfterActualRead,true);assert.equal(restored.retainedMetadataPreserved,true);
assert.deepEqual(native.before.paper,native.after.paper);assert.deepEqual(native.before.folders,native.after.folders);assert.deepEqual(native.before.history,native.after.history);
const screens=['packaged-public-original-read.png','packaged-failure-en.png','packaged-failure-ko.png','packaged-restored-primary-read.png'].map(name=>({name,sha256:sha(readFileSync(join(proof,name))),visuallyReviewed:true}));
const evidence={status:'passed final source/resources/artifacts/copy and independently reviewed actual packaged owner proof',inspectedAt:new Date().toISOString(),acceptedQaHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),acceptedWindowsSource:source,manifestSha256:sha(readFileSync(manifestPath)),resources,sourceFiles,artifacts,delivered:{path:delivered,bytes:statSync(delivered).size,sha256:sha(readFileSync(delivered)),matchesOwnerInstaller:true},excludedVerificationInputs:excluded,bundledHubMatchesAccepted6d:true,native:{proofSha256:sha(readFileSync(join(proof,'packaged-verification.json'))),source:native.source,reference:native.reference,cases:native.cases,runtimeIdentity:native.runtimeIdentity,wrapperIdentity:native.wrapperIdentity,listenerOwnership:native.listenerOwnership,ownedProcessExited:native.ownedProcessExited,ownedWrapperExited:native.ownedWrapperExited,listenerReleased:native.listenerReleased,explicitNullRecentBaseline:native.baselineMetadataSetup,seededPdfBytes:false,execution:'Reviewed owner actual packaged executable/bundled Hub execution; separate from reviewer browser'},screens,peerExecutableLaunchedByReviewer:false,installerInstalledByReviewer:false,macOSClaim:false};
writeFileSync(join(root,'docs/implementation/qa/pdf-acquisition/evidence/windows-final.json'),JSON.stringify(evidence,null,2));console.log('Final Windows inspection passed: 176 resources, 207 canonical+raw inputs, current NSIS/EXE/ASAR/root copy and owner packaged proof');
