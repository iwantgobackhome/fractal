import { createHash } from 'node:crypto';
import type { Paper } from '@fractal/shared';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { extractPdf, inferTitle } from '../pdf/index';
import type { SqlitePaperStore } from '../store/sqlite';
import type { PaperAcquirer } from '../api/index';
import { appError, invalidInput } from '../store/errors';
import { tooLarge } from '../api/routes/types';

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export interface ResolvedMetadata { title:string|null; authors:string[]; year:number|null; venue:string|null; doi:string|null; arxivId:string|null; abstract:string|null; pdfUrl:string|null; url:string|null }
export async function resolveDoi(doi:string, fetcher:typeof fetch=fetch, email=process.env.FRACTAL_CONTACT_EMAIL):Promise<ResolvedMetadata> {
  try {doi=decodeURIComponent(doi.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i,'').replace(/^doi:/i,'')).trim().toLowerCase();}
  catch {throw invalidInput('DOI 형식이 올바르지 않습니다.');}
  if (!/^10\.\d{4,9}\/\S+$/.test(doi)) throw invalidInput('DOI 형식이 올바르지 않습니다.');
  const headers:HeadersInit=email?{'User-Agent':`Fractal/0.1 (mailto:${email})`}:{};
  let work:Record<string,unknown>;
  try {
    const cross=await fetcher(`https://api.crossref.org/works/${encodeURIComponent(doi)}`,{headers});
    if(!cross.ok)throw new Error(`Crossref HTTP ${cross.status}`);
    work=(await cross.json() as {message:Record<string,unknown>}).message;
    if(!work||typeof work!=='object')throw new Error('Crossref response missing message');
  } catch {throw appError('NETWORK','Crossref에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.',true);}
  const names=Array.isArray(work.author)?work.author as Array<{given?:string;family?:string}>:[];
  const dates=(work.published as { 'date-parts'?:number[][] }|undefined)?.['date-parts'];
  let pdfUrl:null|string=null;
  if(email){try {const unpay=await fetcher(`https://api.unpaywall.org/v2/${encodeURIComponent(doi)}?email=${encodeURIComponent(email)}`,{headers});if(!unpay.ok)throw new Error(`Unpaywall HTTP ${unpay.status}`);const data=await unpay.json() as {best_oa_location?:{url_for_pdf?:string}};pdfUrl=data.best_oa_location?.url_for_pdf??null;}catch{throw appError('NETWORK','Unpaywall에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.',true);}}
  return {title:Array.isArray(work.title)?String(work.title[0]??''):null,authors:names.map(n=>[n.given,n.family].filter(Boolean).join(' ')),year:dates?.[0]?.[0]??null,venue:Array.isArray(work['container-title'])?String(work['container-title'][0]??''):null,doi,arxivId:null,abstract:typeof work.abstract==='string'?work.abstract:null,pdfUrl,url:typeof work.URL==='string'?work.URL:null};
}
/** Inspect PDF info and the largest first-page text runs before extraction. */
export async function metadataFromPdf(bytes:Buffer):Promise<Pick<ResolvedMetadata,'title'|'doi'|'arxivId'>> {
  const task=getDocument({data:new Uint8Array(bytes),useSystemFonts:true});
  try {const doc=await task.promise;const info=await doc.getMetadata().catch(()=>null);const fields=info?.info as Record<string,unknown>|undefined;const candidates=[String(fields?.Title??''),String(fields?.Subject??'')];
    const page=await doc.getPage(1);const content=await page.getTextContent();const items=content.items.filter((i):i is typeof i & {str:string;transform:number[]}=>'str' in i && 'transform' in i);
    const text=items.map(i=>i.str).join(' ');candidates.push(text);
    const doi=candidates.join(' ').match(/10\.\d{4,9}\/[\w.()/:;-]+/i)?.[0]?.replace(/[.;]$/,'')??null;
    const arxivId=candidates.join(' ').match(/(?:arxiv:\s*|arxiv\.org\/abs\/)(\d{4}\.\d{4,5}(?:v\d+)?)/i)?.[1]??null;
    const ranked=items.filter(i=>i.str.trim().length>5).sort((a,b)=>Math.abs(b.transform[0]??0)-Math.abs(a.transform[0]??0));
    return {title:String(fields?.Title??'').trim()||ranked.slice(0,3).map(i=>i.str.trim()).join(' ').slice(0,300)||null,doi,arxivId};
  } finally {await task.destroy();}
}
export async function ingestPdf(store:SqlitePaperStore,bytes:Buffer,sourceUrl='upload://local',fetcher:typeof fetch=fetch):Promise<Paper> {
  if(bytes.length>100*1024*1024)throw tooLarge('100MB보다 큰 PDF는 올릴 수 없습니다.');
  if(!bytes.subarray(0,1024).includes(Buffer.from('%PDF-')))throw invalidInput('올바른 PDF 파일을 올려 주세요.');
  const hash=sha(bytes);
  let found:Awaited<ReturnType<typeof metadataFromPdf>>;
  try {found=await metadataFromPdf(bytes);}catch{throw invalidInput('PDF 파일을 읽을 수 없습니다. 다른 PDF를 올려 주세요.');}
  const metadata=found.doi?await resolveDoi(found.doi,fetcher):null;
  const duplicate=store.findDuplicate(found.doi,found.arxivId,hash);
  if(duplicate){const existing=store.getPaper(duplicate)!;if(!store.getPdf(duplicate))store.savePdf(duplicate,bytes);store.patchLibrary(duplicate,{doi:found.doi??metadata?.doi??undefined,arxivId:found.arxivId??undefined,title:metadata?.title??found.title??undefined,year:metadata?.year??undefined,venue:metadata?.venue??undefined,abstract:metadata?.abstract??undefined});return existing;}
  const paperKey=`pdf-${sha(Buffer.from(sourceUrl))}-${hash}`;
  const extracted=await extractPdf(bytes,paperKey);const now=new Date().toISOString();
  const paper:Paper={paperKey,sourceKind:'publication',arxivId:null,version:null,title:metadata?.title??found.title??inferTitle(extracted.blocks),authors:metadata?.authors??[],sourceUrl:'https://local.fractal.invalid/upload/'+hash,pdfSha256:hash,pageCount:extracted.coverage.totalPages,extractionVersion:extracted.extractionVersion,status:extracted.coverage.textPages===0?'unsupported':extracted.coverage.unsupportedPages.length?'partial':'ready',coverage:extracted.coverage,createdAt:now};
  store.savePaper(paper,bytes);store.saveBlocks(paperKey,extracted.blocks);store.patchLibrary(paperKey,{doi:found.doi??metadata?.doi??undefined,arxivId:found.arxivId??undefined,year:metadata?.year??undefined,venue:metadata?.venue??undefined,abstract:metadata?.abstract??undefined});return paper;
}
export async function ingestUrl(store:SqlitePaperStore,input:string,acquirer:PaperAcquirer,fetcher:typeof fetch=fetch):Promise<Paper> {
  if(/^10\./.test(input)||/^doi:/i.test(input)||/^https?:\/\/(?:dx\.)?doi\.org\//i.test(input)){
    const meta=await resolveDoi(input,fetcher);if(!meta.pdfUrl)throw invalidInput('이 DOI에서 무료로 공개된 PDF를 찾지 못했습니다. PDF 파일을 직접 올려 주세요.');
    const result=await ingestUrl(store,meta.pdfUrl,acquirer,fetcher);store.patchLibrary(result.paperKey,{doi:meta.doi,title:meta.title,authors:meta.authors.map(name=>{const parts=name.split(/\s+/);return {given:parts.slice(0,-1).join(' '),family:parts.at(-1)??name};}),year:meta.year,venue:meta.venue,abstract:meta.abstract});return result;
  }
  const resolved=await acquirer.resolve(input);const duplicate=store.findDuplicate(null,resolved.arxivId,resolved.pdfSha256);if(duplicate)return store.getPaper(duplicate)!;
  const acquired=await acquirer.acquire(resolved.paperKey,input);const same=store.findDuplicate(null,acquired.paper.arxivId,acquired.paper.pdfSha256);if(same)return store.getPaper(same)!;
  store.savePaper(acquired.paper,acquired.pdf);store.saveBlocks(acquired.paper.paperKey,acquired.blocks);return acquired.paper;
}
