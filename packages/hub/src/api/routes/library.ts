import type { IncomingMessage } from 'node:http';
import { createHash } from 'node:crypto';
import { collectionSchema, libraryPatchSchema, tagSchema } from '@fractal/shared';
import { ingestPdf, ingestUrl } from '../../ingest/index';
import { exportLibrary, markdown } from '../../export/index';
import { searchLibrary } from '../../library/search';
import { body, json, jsonBody, parseRequest, type Result, type LibraryRouteContext as RouteContext } from './types';
import { invalidInput } from '../../store/errors';
import { unsupportedMedia } from '../errors';

function pdfBytes(raw:Buffer,type:string):Buffer {
  const media=type.split(';')[0]?.trim().toLowerCase();
  if(media==='application/pdf')return raw;
  if(media!=='multipart/form-data')throw unsupportedMedia('PDF 파일만 올릴 수 있습니다.');
  const boundary=/boundary=(?:"([^"]+)"|([^;]+))/i.exec(type)?.[1]??/boundary=([^;]+)/i.exec(type)?.[1];if(!boundary)throw invalidInput('업로드 형식이 올바르지 않습니다.');
  const marker=Buffer.from(`--${boundary}`);let pos=raw.indexOf(marker);
  while(pos>=0){const start=raw.indexOf(Buffer.from('\r\n\r\n'),pos);if(start<0)break;const end=raw.indexOf(Buffer.from(`\r\n--${boundary}`),start+4);if(end<0)break;const candidate=raw.subarray(start+4,end);if(candidate.subarray(0,1024).includes(Buffer.from('%PDF-')))return candidate;pos=raw.indexOf(marker,end+2);}
  throw invalidInput('올바른 PDF 파일을 올려 주세요.');
}
export async function handleLibrary(method:string,segments:string[],request:IncomingMessage,ctx:RouteContext):Promise<Result|undefined>{
  const s=segments;if(s[0]!=='api')return undefined;
  if(s[1]==='library'){
    if(s.length===2&&method==='GET')return json(ctx.store.listLibrary());
    if(s[2]==='search'&&method==='GET'){const url=new URL(request.url??'/', 'http://localhost');return json(searchLibrary(url.searchParams.get('q')??'',{limit:Number(url.searchParams.get('limit')??20),store:ctx.store}));}
    if(s[2]==='export'&&method==='GET'){const url=new URL(request.url??'/', 'http://localhost');const format=url.searchParams.get('format')==='csl-json'?'csl-json':'bibtex';const keys=url.searchParams.getAll('key');const data=exportLibrary(ctx.store,format,keys.length?keys:undefined);return {kind:'bytes',status:200,body:Buffer.from(data),contentType:format==='bibtex'?'application/x-bibtex; charset=utf-8':'application/vnd.citationstyles.csl+json; charset=utf-8'};}
    if(s[2]==='tags'&&s.length===3&&method==='GET')return json([...new Set([...ctx.store.listLibrary().flatMap(r=>r.tags),...(ctx.store.db.prepare('SELECT name FROM tags').all() as Array<{name:string}>).map(r=>r.name)])].sort());
    if(s[2]==='tags'&&s.length===3&&method==='POST'){const tag=parseRequest(tagSchema,await jsonBody(request));ctx.store.db.prepare('INSERT OR IGNORE INTO tags VALUES(?)').run(tag.name);return json(tag,201);}
    if(s[2]==='tags'&&s.length===4&&method==='PATCH'){const old=decodeURIComponent(s[3]!);const tag=parseRequest(tagSchema,await jsonBody(request));ctx.store.db.prepare('UPDATE tags SET name=? WHERE name=?').run(tag.name,old);for(const r of ctx.store.listLibrary())if(r.tags.includes(old))ctx.store.patchLibrary(r.paperKey,{tags:r.tags.map(t=>t===old?tag.name:t)});return json(tag);}
    if(s[2]==='tags'&&s.length===4&&method==='DELETE'){const name=decodeURIComponent(s[3]!);ctx.store.db.prepare('DELETE FROM tags WHERE name=?').run(name);for(const r of ctx.store.listLibrary())if(r.tags.includes(name))ctx.store.patchLibrary(r.paperKey,{tags:r.tags.filter(t=>t!==name)});return json({deleted:true});}
    if(s[2]==='collections'&&s.length===3&&method==='GET')return json(ctx.store.db.prepare('SELECT id,name FROM collections ORDER BY name').all());
    if(s[2]==='collections'&&s.length===3&&method==='POST'){const c=parseRequest(collectionSchema,await jsonBody(request));ctx.store.db.prepare('INSERT INTO collections VALUES(?,?)').run(c.id,c.name);return json(c,201);}
    if(s[2]==='collections'&&s.length===4&&method==='PATCH'){const update=await jsonBody(request);const name=String(update.name??'').trim();if(!name)throw invalidInput('컬렉션 이름을 입력해 주세요.');ctx.store.db.prepare('UPDATE collections SET name=? WHERE id=?').run(name,s[3]);return json({id:s[3],name});}
    if(s[2]==='collections'&&s.length===4&&method==='DELETE'){ctx.store.db.prepare('DELETE FROM collections WHERE id=?').run(s[3]);for(const r of ctx.store.listLibrary())if(r.collections.includes(s[3]!))ctx.store.patchLibrary(r.paperKey,{collections:r.collections.filter(id=>id!==s[3])});return json({deleted:true});}
    if(s.length===3&&method==='GET')return json(ctx.store.getLibrary(s[2]!)??null);
    if(s.length===3&&method==='PATCH')return json(ctx.store.patchLibrary(s[2]!,parseRequest(libraryPatchSchema,await jsonBody(request))));
    if(s.length===3&&method==='DELETE')return json(ctx.store.deletePaper(s[2]!));
  }
  if(s[1]==='papers'&&s[2]==='upload'&&method==='POST'){const type=String(request.headers['content-type']??'');const media=type.split(';')[0]?.trim().toLowerCase();if(media!=='application/pdf'&&media!=='multipart/form-data')throw unsupportedMedia('PDF 파일만 올릴 수 있습니다.');const max=media==='multipart/form-data'?101*1024*1024:100*1024*1024;const raw=await body(request,max,'100MB보다 큰 PDF는 올릴 수 없습니다.');const pdf=pdfBytes(raw,type);return json({paper:await ingestPdf(ctx.store,pdf,undefined,ctx.fetcher)},201);}
  if (s[1] === 'papers' && s[2] === 'open' && method === 'POST') {
    const input = String((await jsonBody(request)).input ?? '');
    if (!input.trim()) throw invalidInput('논문 주소 또는 DOI를 입력해 주세요.');
    const stored = /^[A-Za-z0-9._-]{1,200}$/.test(input) ? ctx.store.getPaper(input) : null;
    return json({ paper: stored ?? await ingestUrl(ctx.store, input, ctx.acquirer, ctx.fetcher) });
  }
  if(s[1]==='papers'&&s.length===4&&s[3]==='pdf'&&method==='GET'){
    const bytes=ctx.store.getPdf(s[2]!);if(!bytes)return undefined;const sha=createHash('sha256').update(bytes).digest('hex');const etag=`"${sha}"`;
    if(request.headers['if-none-match']===etag)return {kind:'bytes',status:304,body:Buffer.alloc(0),contentType:'application/pdf',headers:{etag,'accept-ranges':'bytes'}};
    const range=request.headers['if-range'] === undefined || request.headers['if-range'] === etag
      ? request.headers.range
      : undefined;
    let from=0,to=bytes.length-1,status=200;
    if(typeof range==='string'){const m=/^bytes=(\d*)-(\d*)$/.exec(range);if(!m)return {kind:'bytes',status:416,body:Buffer.alloc(0),contentType:'application/pdf',headers:{etag,'content-range':`bytes */${bytes.length}`}};if(m[1])from=Number(m[1]);if(m[2])to=Number(m[2]);if(!m[1]&&m[2]){from=Math.max(0,bytes.length-Number(m[2]));to=bytes.length-1;}if(from>to||to>=bytes.length)return {kind:'bytes',status:416,body:Buffer.alloc(0),contentType:'application/pdf',headers:{etag,'content-range':`bytes */${bytes.length}`}};status=206;}
    return {kind:'bytes',status,body:bytes.subarray(from,to+1),contentType:'application/pdf',headers:{etag,'accept-ranges':'bytes',...(status===206?{'content-range':`bytes ${from}-${to}/${bytes.length}`}:{})}};
  }
  if(s[1]==='papers'&&s.length===5&&s[3]==='export'&&method==='GET'){const record=ctx.store.getLibrary(s[2]!);if(!record)return undefined;const format=s[4];const aiNotes=ctx.store.getConversation(s[2]!)?.messages.filter(m=>m.role==='assistant'&&m.status==='completed').map(m=>m.text)??[];const data=format==='markdown'?markdown(record,ctx.store.listAnnotations(s[2]!),ctx.store.listHighlights(s[2]!),aiNotes):format==='bibtex'||format==='csl-json'?exportLibrary(ctx.store,format,[s[2]!] ):null;if(data===null)return undefined;return {kind:'bytes',status:200,body:Buffer.from(data),contentType:format==='markdown'?'text/markdown; charset=utf-8':format==='bibtex'?'application/x-bibtex; charset=utf-8':'application/vnd.citationstyles.csl+json; charset=utf-8'};}
  return undefined;
}
