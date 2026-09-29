import { z } from 'zod';
import type { Job, Translation } from './ai';

export interface Coverage { totalPages:number; textPages:number; unsupportedPages:number[] }
export interface Paper { paperKey:string; sourceKind?:'arxiv'|'publication'; arxivId:string|null; version:number|null; title:string|null; authors:string[]; sourceUrl:string; pdfSha256:string|null; pageCount:number|null; extractionVersion:string|null; status:'fetching'|'extracting'|'ready'|'partial'|'unsupported'|'failed'; coverage:Coverage|null; createdAt:string }
export interface Region { page:number; x:number; y:number; width:number; height:number }
export interface Block { blockId:string; paperKey:string; order:number; kind:'heading'|'paragraph'|'caption'|'equation'|'figure'|'table'|'reference'|'unsupported'; sourceText:string; sourceHash:string; regions:Region[]; alignment:'exact'|'uncertain'; translatable:boolean; fontFamily:'serif'|'sans'; fontWeight:'normal'|'bold'; fontSize:number; pageOrdinal:number }
export interface PaperListResult { papers: Paper[] }
export interface Snapshot { paper:Paper; blocks:Block[]; translations:Translation[]; job:Job|null }

export const regionSchema = z.object({ page: z.number().int().positive(), x: z.number().finite(), y: z.number().finite(), width: z.number().finite(), height: z.number().finite() });
// TODO(library): define persisted library request schemas when the library API is expanded.
export const libraryPlaceholderSchema = z.object({});
