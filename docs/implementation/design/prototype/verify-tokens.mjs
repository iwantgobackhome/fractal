import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir=path.dirname(fileURLToPath(import.meta.url));
const repo=path.resolve(dir,'../../../..');
const tokenPath='packages/shared/tokens/tokens.json';
const current=JSON.parse(await readFile(path.join(repo,tokenPath),'utf8'));
const before=JSON.parse(execFileSync('git',['show','HEAD:'+tokenPath],{cwd:repo,encoding:'utf8'}));
const cssPath=path.join(repo,'packages/ui/src/design/tokens.css');
const ktPath=path.join(repo,'packages/shared/tokens/generated/FractalTokens.kt');
const css=await readFile(cssPath,'utf8');
const kt=await readFile(ktPath,'utf8');
execFileSync(process.execPath,[path.join(repo,'scripts/gen-tokens.mjs')],{cwd:repo,stdio:'ignore'});
if(css!==await readFile(cssPath,'utf8')||kt!==await readFile(ktPath,'utf8'))throw new Error('Generated tokens differ from checked-in generation');
const immutable=['font','size','space','radius','motion'];
for(const key of immutable)if(JSON.stringify(before[key])!==JSON.stringify(current[key]))throw new Error('Unexpected scalar/font change: '+key);
const sameNames=Object.keys(before.color.light).join(',')===Object.keys(current.color.light).join(',');
if(!sameNames)throw new Error('Token names changed');
function luminance(hex){const rgb=hex.slice(1).match(/../g).map(v=>parseInt(v,16)/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4);return .2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2];}
function contrast(a,b){const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
const checks=[];
for(const [theme,t] of Object.entries(current.color)){
  for(const background of ['paper','surface']){
    for(const foreground of ['ink','inkSoft','muted','accent']){
      const ratio=contrast(t[foreground],t[background]);checks.push({theme,foreground,background,ratio:Number(ratio.toFixed(2)),minimum:4.5,passed:ratio>=4.5});
    }
    const ratio=contrast(t.focus,t[background]);checks.push({theme,foreground:'focus',background,ratio:Number(ratio.toFixed(2)),minimum:3,passed:ratio>=3});
  }
  const ratio=contrast(t.accentInk,t.accent);checks.push({theme,foreground:'accentInk',background:'accent',ratio:Number(ratio.toFixed(2)),minimum:4.5,passed:ratio>=4.5});
}
const report={generatedAt:new Date().toISOString(),generatedParity:true,unchangedScalarGroups:immutable,backwardCompatibleNames:sameNames,checks};
await writeFile(path.resolve(dir,'../renders/token-checks.json'),JSON.stringify(report,null,2)+'\n');
for(const check of checks)process.stdout.write(`${check.passed?'PASS':'FAIL'} ${check.theme} ${check.foreground}/${check.background}: ${check.ratio}\n`);
if(checks.some(c=>!c.passed))throw new Error('Token contrast requirement failed');
