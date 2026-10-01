/** Inspect coordinator-supplied immutable Windows artifacts; never launch the peer executable. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,statSync} from 'node:fs';
import {resolve,join,normalize,sep} from 'node:path';
import {execFileSync} from 'node:child_process';
import {listPackage,extractFile} from '@electron/asar';
const root=resolve(import.meta.dirname,'../../../..');
const owner='C:/Users/Home/orca/workspaces/fractal/fractal-desktop';
const manifestPath=join(owner,'dist/pdf-acquisition-evidence/package-resources.json');
const manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
const archive=join(owner,'dist/installer-pdf-acquisition/win-unpacked/resources/app.asar');
const delivered='C:/Users/Home/Desktop/Fractal/fractal/dist/reviewed-builds/desktop-pdf-51149ad/Fractal Setup 0.1.0.exe';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const safeSource=path=>{const absolute=resolve(root,path);assert.ok(absolute.startsWith(root+sep));return absolute;};
assert.equal(manifest.acceptedSource,'51149adbc5d0cee77252d1e9372e272623d3f1a8');assert.equal(manifest.status,'passed');
const resources=manifest.resources.map(item=>{const bytes=extractFile(archive,normalize(item.path));assert.equal(bytes.length,item.bytes);assert.equal(sha(bytes),item.sha256);return {...item,independentShippedHash:sha(bytes)};});
const sourceFiles=manifest.sourceFiles.map(item=>{
  const actual=sha(readFileSync(safeSource(item.path))),blob=execFileSync('git',['show',`HEAD:${item.path}`],{cwd:root,maxBuffer:8*1024*1024}),canonical=sha(blob);
  const text=/\.(?:json|ts|tsx|css|js|mjs|cjs|svg)$/.test(item.path),lf=text?blob.toString('utf8').replaceAll('\r\n','\n'):null;
  const lfHash=lf===null?canonical:sha(Buffer.from(lf)),crlfHash=lf===null?canonical:sha(Buffer.from(lf.replaceAll('\n','\r\n')));
  const rawOrEndingMatch=[actual,canonical,lfHash,crlfHash].includes(item.sha256);
  let jsonFormattingOnlyDifference=false;
  if(!rawOrEndingMatch&&item.path==='package.json'){
    const ownerBytes=readFileSync(join(owner,item.path));assert.equal(sha(ownerBytes),item.sha256);
    assert.deepEqual(JSON.parse(ownerBytes.toString('utf8')),JSON.parse(blob.toString('utf8')));jsonFormattingOnlyDifference=true;
  }
  const matchesAcceptedSource=rawOrEndingMatch||jsonFormattingOnlyDifference;
  return {...item,independentAcceptedSourceHash:actual,acceptedGitBlobHash:canonical,lineEndingOnlyDifference:actual!==item.sha256&&rawOrEndingMatch,jsonFormattingOnlyDifference,matchesAcceptedSource};
});
const mismatches=sourceFiles.filter(item=>!item.matchesAcceptedSource);assert.deepEqual(mismatches,[],'shipped build manifest matches own supplied accepted production source');
const artifacts=manifest.artifacts.map(item=>{const bytes=readFileSync(item.path);assert.equal(sha(bytes),item.sha256);assert.equal(bytes.length,item.bytes);return {...item,independentHash:sha(bytes)};});
const deliveredHash=sha(readFileSync(delivered));assert.equal(deliveredHash,'4183b52a77e767755b04816783c6fbfb02fd47e70173d8ab231dfdcd94add97f');assert.equal(statSync(delivered).size,117592923);assert.equal(artifacts[0].independentHash,deliveredHash);
const entries=listPackage(archive,{isPack:false});const excluded=entries.filter(path=>/(?:pdf-acquisition-evidence|[/\\]tools[/\\]|[/\\]test[/\\]fixtures[/\\]|\.pdf$|qa-pdf-acquisition|NativeDeskDriver)/i.test(path));assert.deepEqual(excluded,[]);
const evidence={source:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),inspectedAt:new Date().toISOString(),status:'passed artifact inspection; superseded by pending cached GET repair, not final acceptance',manifestPath,manifestHash:sha(readFileSync(manifestPath)),declaredBuildSource:manifest.acceptedSource,resourceCount:resources.length,sourceCount:sourceFiles.length,resources,sourceFiles,artifacts,delivered:{path:delivered,bytes:statSync(delivered).size,sha256:deliveredHash,matchesOwnerInstaller:true},excludedVerificationInputs:excluded,peerExecutableLaunched:false,installerInstalled:false,nativeProof:'Final committed current native dossier and saved packaged proof remain pending coordinator supply'};
writeFileSync(join(root,'docs/implementation/qa/pdf-acquisition/evidence/windows-resources.json'),JSON.stringify(evidence,null,2));console.log(`Independent Windows resources/source/artifacts/copy passed: ${resources.length}/${sourceFiles.length}`);
