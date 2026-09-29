import type { IncomingMessage } from 'node:http';
import { annotationSchema } from '@fractal/shared';
import { json, jsonBody, parseRequest, type Result, type LibraryRouteContext as RouteContext } from './types';
import { invalidInput } from '../../store/errors';
export async function handleAnnotations(method:string,s:string[],request:IncomingMessage,ctx:RouteContext):Promise<Result|undefined>{
  if(s[0]!=='api'||s[1]!=='papers'||s[3]!=='annotations')return undefined;
  if(s.length===4&&method==='GET')return json(ctx.store.listAnnotations(s[2]!));
  if(s.length===4&&method==='POST'){const annotation=parseRequest(annotationSchema,await jsonBody(request));if(annotation.paperKey!==s[2])throw invalidInput('논문 식별자가 일치하지 않습니다.');return json(ctx.store.upsertAnnotation(annotation),201);}
  if(s.length===5&&method==='GET'){const a=ctx.store.getAnnotation(s[4]!);return json(a?.paperKey===s[2]?a:null);}
  if(s.length===5&&method==='DELETE'){const old=ctx.store.getAnnotation(s[4]!);if(!old||old.paperKey!==s[2])return json({deleted:false});return json(ctx.store.upsertAnnotation({...old,deleted:true,updatedAt:new Date().toISOString(),deviceId:'hub'}));}
  return undefined;
}
